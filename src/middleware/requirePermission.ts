import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { employeeProfiles } from "../db/schema";
import { eq } from "drizzle-orm";
import { effectivePermissions, hasPermission } from "../lib/permissions";

/**
 * Gate a route behind an RBAC permission key. Must run AFTER authenticate +
 * requireAdmin. An admin user with no employee profile is treated as full
 * access (legacy super-admin), so the original admin is never locked out.
 */
export const requirePermission = (key: string) => async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, message: "Authentication required" });
        }
        if (req.user.role !== "admin") {
            return res.status(403).json({ success: false, message: "Admin access required" });
        }

        const profile = await db.query.employeeProfiles.findFirst({
            where: eq(employeeProfiles.userId, req.user.id),
        });

        const perms = effectivePermissions(
            profile?.staffRole ?? null,
            (profile?.permissions as string[] | undefined) ?? null
        );

        if (hasPermission(perms, key)) return next();

        return res.status(403).json({ success: false, message: `Missing permission: ${key}` });
    } catch (error) {
        // Fail OPEN for an already-authenticated admin: if the employee_profiles
        // table doesn't exist yet (migration not run) or the DB hiccups, we
        // can't resolve fine-grained perms — fall back to legacy behaviour
        // (every admin has full access) rather than locking the panel.
        console.warn("Permission check degraded (allowing admin):", error instanceof Error ? error.message : error);
        return next();
    }
};
