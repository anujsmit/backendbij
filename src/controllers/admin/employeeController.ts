// src/controllers/admin/employeeController.ts
import { Request, Response } from "express";
import { db } from "../../db";
import { users, employeeProfiles, userAccounts, mistriAccounts } from "../../db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../../services/auditLog";
import {
    PERMISSION_CATALOG,
    ROLE_DEFINITIONS,
    ALL_PERMISSIONS,
    STAFF_ROLES,
    StaffRole,
    effectivePermissions,
} from "../../lib/permissions";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

// ============================================
// GET CURRENT ADMIN PROFILE
// ============================================

export const getMe = async (req: Request, res: Response) => {
    try {
        const id = (req as any).user?.userId;
        if (!id) return res.status(401).json({ success: false, message: "Not authenticated" });

        const user = await db.query.users.findFirst({ where: eq(users.id, id) });
        
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
                staffRole: profile?.staffRole ?? "super_admin",
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

// ============================================
// UPDATE CURRENT ADMIN PROFILE
// ============================================

export const updateMe = async (req: Request, res: Response) => {
    try {
        const id = (req as any).user?.userId;
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
            try {
                const profile = await db.query.employeeProfiles.findFirst({ where: eq(employeeProfiles.userId, id) });
                if (profile) {
                    await db.update(employeeProfiles)
                        .set({ designation: designation || null, updatedAt: new Date() })
                        .where(eq(employeeProfiles.userId, id));
                }
            } catch { /* employee_profiles table may not exist yet */ }
        }

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

// ============================================
// GET ROLES METADATA
// ============================================

export const getRolesMeta = async (_req: Request, res: Response) => {
    return res.json({
        success: true,
        roles: ROLE_DEFINITIONS,
        catalog: PERMISSION_CATALOG,
        allPermissions: ALL_PERMISSIONS,
    });
};

// ============================================
// GET ALL EMPLOYEES
// ============================================

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
            staffRole: r.staffRole ?? "super_admin",
            permissions: r.staffRole ? (r.permissions as string[]) : ["*"],
            isLegacy: !r.staffRole,
        }));

        return res.json({ success: true, employees });
    } catch (error) {
        console.warn("getEmployees degraded (setup required?):", error instanceof Error ? error.message : error);
        return res.json({ success: true, employees: [], setupRequired: true });
    }
};

// ============================================
// CREATE EMPLOYEE
// ============================================

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
        return provided.filter((p) => p === "*" || ALL_PERMISSIONS.includes(p));
    }
    const def = ROLE_DEFINITIONS.find((r) => r.key === staffRole)?.defaultPermissions ?? [];
    return [...def];
}

export const createEmployee = async (req: Request, res: Response) => {
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" });
        }
        const { fullName, staffRole, designation } = parsed.data;
        const cleanPhone = parsed.data.phoneNumber.replace(/\s+/g, "");
        const permissions = resolvePermissions(staffRole, parsed.data.permissions);

        // Check if phone exists in any table
        const existingAdmin = await db.query.users.findFirst({ where: eq(users.phoneNumber, cleanPhone) });
        const existingUser = await db.query.userAccounts.findFirst({ where: eq(userAccounts.phoneNumber, cleanPhone) });
        const existingMistri = await db.query.mistriAccounts.findFirst({ where: eq(mistriAccounts.phoneNumber, cleanPhone) });

        let targetUserId: string;

        if (existingAdmin) {
            const existingProfile = await db.query.employeeProfiles.findFirst({
                where: eq(employeeProfiles.userId, existingAdmin.id),
            });
            if (existingProfile) {
                return res.status(409).json({ success: false, message: "This person is already an employee." });
            }
            await db.update(users)
                .set({ role: "admin", isActive: true, fullName })
                .where(eq(users.id, existingAdmin.id));
            targetUserId = existingAdmin.id;
        } else if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "This phone already belongs to a customer account. Please use a different number.",
            });
        } else if (existingMistri) {
            return res.status(409).json({
                success: false,
                message: "This phone already belongs to a mistri account. Please use a different number.",
            });
        } else {
            // ✅ Generate a random password for the new admin
            const randomPassword = Math.random().toString(36).slice(-8) + "Admin@123";
            const hashedPassword = await bcrypt.hash(randomPassword, SALT_ROUNDS);

            const [created] = await db.insert(users).values({
                phoneNumber: cleanPhone,
                fullName,
                role: "admin",
                isActive: true,
                isOnboarded: true,
                isVerified: true,
                passwordHash: hashedPassword, // ✅ Required field
            }).returning();
            targetUserId = created.id;
        }

        await db.insert(employeeProfiles).values({
            userId: targetUserId,
            staffRole: staffRole as StaffRole,
            permissions,
            designation: designation || null,
            createdBy: (req as any).user?.userId ?? null,
        });

        await createAuditLog({
            entityType: "employee",
            entityId: targetUserId,
            action: "employee_create",
            performedBy: (req as any).user?.userId || 'system',
            performedByRole: "admin",
            newValue: { staffRole, permissions, designation },
        });

        return res.status(201).json({ 
            success: true, 
            message: "Employee added", 
            userId: targetUserId 
        });
    } catch (error) {
        console.error("createEmployee error:", error);
        return res.status(500).json({ success: false, message: "Failed to add employee" });
    }
};

// ============================================
// UPDATE EMPLOYEE
// ============================================

const updateSchema = z.object({
    fullName: z.string().trim().min(2).optional(),
    staffRole: z.enum(STAFF_ROLES as [string, ...string[]]).optional(),
    designation: z.string().trim().max(100).optional().nullable(),
    permissions: z.array(z.string()).optional(),
});

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
            await db.insert(employeeProfiles).values({
                userId,
                staffRole: staffRole as StaffRole,
                permissions,
                designation: parsed.data.designation || null,
                createdBy: (req as any).user?.userId ?? null,
            });
        }

        await createAuditLog({
            entityType: "employee",
            entityId: userId,
            action: "employee_update",
            performedBy: (req as any).user?.userId || 'system',
            performedByRole: "admin",
            newValue: { staffRole, permissions, designation: parsed.data.designation },
        });

        return res.json({ success: true, message: "Employee updated" });
    } catch (error) {
        console.error("updateEmployee error:", error);
        return res.status(500).json({ success: false, message: "Failed to update employee" });
    }
};

// ============================================
// TOGGLE EMPLOYEE ACTIVE
// ============================================

export const toggleEmployeeActive = async (req: Request, res: Response) => {
    try {
        const userId = String(req.params.id);
        const currentUserId = (req as any).user?.userId;
        
        if (userId === currentUserId) {
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
            performedBy: (req as any).user?.userId || 'system',
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

// ============================================
// REMOVE EMPLOYEE
// ============================================

export const removeEmployee = async (req: Request, res: Response) => {
    try {
        const userId = String(req.params.id);
        const currentUserId = (req as any).user?.userId;
        
        if (userId === currentUserId) {
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
            performedBy: (req as any).user?.userId || 'system',
            performedByRole: "admin",
        });

        return res.json({ success: true, message: "Employee removed" });
    } catch (error) {
        console.error("removeEmployee error:", error);
        return res.status(500).json({ success: false, message: "Failed to remove employee" });
    }
};