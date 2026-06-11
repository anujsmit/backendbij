import { Request, Response } from "express";
import { db } from "../db";
import { users, employeeProfiles } from "../db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../services/auditLog";
import {
    PERMISSION_CATALOG,
    ROLE_DEFINITIONS,
    ALL_PERMISSIONS,
    STAFF_ROLES,
    StaffRole,
    effectivePermissions,
} from "../lib/permissions";

/** The logged-in admin's identity + effective permissions (drives the UI). */
export const getMe = async (req: Request, res: Response) => {
    try {
        const id = req.user?.id;
        if (!id) return res.status(401).json({ success: false, message: "Not authenticated" });

        const user = await db.query.users.findFirst({ where: eq(users.id, id) });
        // Tolerate a missing employee_profiles table (migration not run yet) —
        // treat as no profile => full access (legacy admin behaviour).
        let profile: typeof employeeProfiles.$inferSelect | undefined;
        try {
            profile = await db.query.employeeProfiles.findFirst({ where: eq(employeeProfiles.userId, id) });
        } catch {
            profile = undefined;
        }

        const permissions = effectivePermissions(
            profile?.staffRole ?? null,
            (profile?.permissions as string[] | undefined) ?? null
        );

        // avatar_url is read via raw SQL (intentionally NOT in the Drizzle users
        // schema) so a missing column / unrun migration can never break the many
        // user/auth queries that select all columns.
        let avatarUrl: string | null = null;
        try {
            const rows = await db.execute(sql`SELECT avatar_url FROM users WHERE id = ${id} LIMIT 1`);
            avatarUrl = (rows as unknown as Array<{ avatar_url: string | null }>)[0]?.avatar_url ?? null;
        } catch { avatarUrl = null; }

        return res.json({
            success: true,
            me: {
                id,
                fullName: user?.fullName ?? "",
                phoneNumber: user?.phoneNumber ?? "",
                staffRole: profile?.staffRole ?? "super_admin", // legacy admin => super
                designation: profile?.designation ?? null,
                avatarUrl,
                permissions,
            },
        });
    } catch (error) {
        console.error("getMe error:", error);
        return res.status(500).json({ success: false, message: "Failed to load profile" });
    }
};

/** Self-service: the logged-in admin updates their OWN name / designation.
 *  No special permission — any authenticated admin can edit their own profile.
 *  Phone (sign-in identity) and role/permissions are intentionally NOT editable here. */
export const updateMe = async (req: Request, res: Response) => {
    try {
        const id = req.user?.id;
        if (!id) return res.status(401).json({ success: false, message: "Not authenticated" });

        const schema = z.object({
            fullName: z.string().trim().min(2, "Name is too short").max(255).optional(),
            designation: z.string().trim().max(100).optional().nullable(),
            avatarUrl: z.string().max(1000).nullable().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" });
        }
        const { fullName, designation, avatarUrl } = parsed.data;

        if (fullName !== undefined) {
            await db.update(users).set({ fullName }).where(eq(users.id, id));
        }
        if (designation !== undefined) {
            // designation lives on the employee profile (skip silently for legacy admins w/o one)
            try {
                const profile = await db.query.employeeProfiles.findFirst({ where: eq(employeeProfiles.userId, id) });
                if (profile) {
                    await db.update(employeeProfiles)
                        .set({ designation: designation || null, updatedAt: new Date() })
                        .where(eq(employeeProfiles.userId, id));
                }
            } catch { /* employee_profiles table may not exist yet */ }
        }

        // avatar_url via raw SQL (see getMe). Degrades gracefully if the column
        // isn't there yet so a photo upload before the migration just warns.
        let avatarWarning: string | undefined;
        if (avatarUrl !== undefined) {
            try {
                await db.execute(sql`UPDATE users SET avatar_url = ${avatarUrl} WHERE id = ${id}`);
            } catch {
                avatarWarning = "Photo couldn't be saved — the avatar DB migration hasn't been run yet.";
            }
        }

        return res.json({ success: true, message: "Profile updated", ...(avatarWarning ? { avatarWarning } : {}) });
    } catch (error) {
        console.error("updateMe error:", error);
        return res.status(500).json({ success: false, message: "Failed to update profile" });
    }
};

/** Role definitions + permission catalog for the Add/Edit Employee UI. */
export const getRolesMeta = async (_req: Request, res: Response) => {
    return res.json({
        success: true,
        roles: ROLE_DEFINITIONS,
        catalog: PERMISSION_CATALOG,
        allPermissions: ALL_PERMISSIONS,
    });
};

/** List all admin-panel employees (admin users + their RBAC profile). */
export const getEmployees = async (_req: Request, res: Response) => {
    try {
        const rows = await db
            .select({
                id: users.id,
                fullName: users.fullName,
                phoneNumber: users.phoneNumber,
                isActive: users.isActive,
                createdAt: users.createdAt,
                staffRole: employeeProfiles.staffRole,
                permissions: employeeProfiles.permissions,
                designation: employeeProfiles.designation,
                profileCreatedAt: employeeProfiles.createdAt,
            })
            .from(users)
            .leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
            .where(eq(users.role, "admin"))
            .orderBy(desc(users.createdAt));

        const employees = rows.map((r) => ({
            ...r,
            // Legacy admins (no profile) are effectively super admins.
            staffRole: r.staffRole ?? "super_admin",
            permissions: r.staffRole ? (r.permissions as string[]) : ["*"],
            isLegacy: !r.staffRole,
        }));

        return res.json({ success: true, employees });
    } catch (error) {
        // Most likely the employee_profiles table doesn't exist yet (migration
        // not run). Return a clean "setup required" state instead of a 500 so
        // the page can prompt to run the one-time migration.
        console.warn("getEmployees degraded (setup required?):", error instanceof Error ? error.message : error);
        return res.json({ success: true, employees: [], setupRequired: true });
    }
};

const createSchema = z.object({
    fullName: z.string().trim().min(2, "Name is too short"),
    phoneNumber: z.string().trim().min(7, "Invalid phone"),
    staffRole: z.enum(STAFF_ROLES as [string, ...string[]]),
    designation: z.string().trim().max(100).optional().nullable(),
    permissions: z.array(z.string()).optional(),
});

function resolvePermissions(staffRole: string, provided?: string[]): string[] {
    if (staffRole === "super_admin") return ["*"];
    if (Array.isArray(provided)) {
        // keep only known keys (or wildcard)
        return provided.filter((p) => p === "*" || ALL_PERMISSIONS.includes(p));
    }
    const def = ROLE_DEFINITIONS.find((r) => r.key === staffRole)?.defaultPermissions ?? [];
    return [...def];
}

/** Add an employee — creates (or upgrades) an admin user + RBAC profile. */
export const createEmployee = async (req: Request, res: Response) => {
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" });
        }
        const { fullName, staffRole, designation } = parsed.data;
        const cleanPhone = parsed.data.phoneNumber.replace(/\s+/g, "");
        const permissions = resolvePermissions(staffRole, parsed.data.permissions);

        const existing = await db.query.users.findFirst({ where: eq(users.phoneNumber, cleanPhone) });

        let targetUserId: string;

        if (existing) {
            if (existing.role && existing.role !== "admin") {
                return res.status(409).json({
                    success: false,
                    message: "This phone already belongs to a customer/mistri account.",
                });
            }
            const existingProfile = await db.query.employeeProfiles.findFirst({
                where: eq(employeeProfiles.userId, existing.id),
            });
            if (existingProfile) {
                return res.status(409).json({ success: false, message: "This person is already an employee." });
            }
            // Existing admin user without a profile (or being re-added) — attach profile + reactivate.
            await db.update(users)
                .set({ role: "admin", isActive: true, fullName })
                .where(eq(users.id, existing.id));
            targetUserId = existing.id;
        } else {
            const [created] = await db.insert(users).values({
                phoneNumber: cleanPhone,
                fullName,
                role: "admin",
                isActive: true,
                isOnboarded: true,
            }).returning();
            targetUserId = created.id;
        }

        await db.insert(employeeProfiles).values({
            userId: targetUserId,
            staffRole: staffRole as StaffRole,
            permissions,
            designation: designation || null,
            createdBy: req.user?.id ?? null,
        });

        await createAuditLog({
            entityType: "employee",
            entityId: targetUserId,
            action: "employee_create",
            performedBy: req.user!.id,
            performedByRole: "admin",
            newValue: { staffRole, permissions, designation },
        });

        return res.status(201).json({ success: true, message: "Employee added", userId: targetUserId });
    } catch (error) {
        console.error("createEmployee error:", error);
        return res.status(500).json({ success: false, message: "Failed to add employee" });
    }
};

const updateSchema = z.object({
    fullName: z.string().trim().min(2).optional(),
    staffRole: z.enum(STAFF_ROLES as [string, ...string[]]).optional(),
    designation: z.string().trim().max(100).optional().nullable(),
    permissions: z.array(z.string()).optional(),
});

/** Edit an employee's name / role / permissions. */
export const updateEmployee = async (req: Request, res: Response) => {
    try {
        const userId = String(req.params.id);
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" });
        }

        const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
        if (!target || target.role !== "admin") {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        if (parsed.data.fullName) {
            await db.update(users).set({ fullName: parsed.data.fullName }).where(eq(users.id, userId));
        }

        const existingProfile = await db.query.employeeProfiles.findFirst({ where: eq(employeeProfiles.userId, userId) });
        const staffRole = parsed.data.staffRole ?? existingProfile?.staffRole ?? "support";
        const permissions = resolvePermissions(
            staffRole,
            parsed.data.permissions ?? (existingProfile?.permissions as string[] | undefined)
        );

        if (existingProfile) {
            await db.update(employeeProfiles)
                .set({
                    staffRole: staffRole as StaffRole,
                    permissions,
                    designation: parsed.data.designation !== undefined ? parsed.data.designation : existingProfile.designation,
                    updatedAt: new Date(),
                })
                .where(eq(employeeProfiles.userId, userId));
        } else {
            // Legacy admin gaining an explicit profile for the first time.
            await db.insert(employeeProfiles).values({
                userId,
                staffRole: staffRole as StaffRole,
                permissions,
                designation: parsed.data.designation || null,
                createdBy: req.user?.id ?? null,
            });
        }

        await createAuditLog({
            entityType: "employee",
            entityId: userId,
            action: "employee_update",
            performedBy: req.user!.id,
            performedByRole: "admin",
            newValue: { staffRole, permissions, designation: parsed.data.designation },
        });

        return res.json({ success: true, message: "Employee updated" });
    } catch (error) {
        console.error("updateEmployee error:", error);
        return res.status(500).json({ success: false, message: "Failed to update employee" });
    }
};

/** Suspend / reactivate an employee's panel access (blocks OTP login). */
export const toggleEmployeeActive = async (req: Request, res: Response) => {
    try {
        const userId = String(req.params.id);
        if (userId === req.user?.id) {
            return res.status(400).json({ success: false, message: "You can't change your own status." });
        }
        const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
        if (!target || target.role !== "admin") {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }
        const next = !target.isActive;
        await db.update(users).set({ isActive: next }).where(eq(users.id, userId));

        await createAuditLog({
            entityType: "employee",
            entityId: userId,
            action: "employee_toggle_active",
            performedBy: req.user!.id,
            performedByRole: "admin",
            oldValue: { isActive: target.isActive },
            newValue: { isActive: next },
        });

        return res.json({ success: true, message: next ? "Employee activated" : "Employee suspended", isActive: next });
    } catch (error) {
        console.error("toggleEmployeeActive error:", error);
        return res.status(500).json({ success: false, message: "Failed to update status" });
    }
};

/** Remove an employee's access: drop their RBAC profile + deactivate login.
 *  We never hard-delete the user row (it would cascade their audit history). */
export const removeEmployee = async (req: Request, res: Response) => {
    try {
        const userId = String(req.params.id);
        if (userId === req.user?.id) {
            return res.status(400).json({ success: false, message: "You can't remove yourself." });
        }
        const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
        if (!target || target.role !== "admin") {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        await db.delete(employeeProfiles).where(eq(employeeProfiles.userId, userId));
        await db.update(users).set({ isActive: false }).where(eq(users.id, userId));

        await createAuditLog({
            entityType: "employee",
            entityId: userId,
            action: "employee_remove",
            performedBy: req.user!.id,
            performedByRole: "admin",
        });

        return res.json({ success: true, message: "Employee removed" });
    } catch (error) {
        console.error("removeEmployee error:", error);
        return res.status(500).json({ success: false, message: "Failed to remove employee" });
    }
};
