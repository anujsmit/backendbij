import { Request, Response } from "express";
import { db } from "../db";
import {
    users,
    mistriProfiles,
    serviceRequests,
    ratings,
    services,
    auditLogs,
    smsLogs,
} from "../db/schema";
import { eq, and, desc, ilike, or, count, sql, sum, SQL, gte, lte } from "drizzle-orm";
import { createAuditLog } from "../services/auditLog";
import { sendSms } from "../services/sms";
import { z } from "zod";

function strParam(v: unknown): string {
    return Array.isArray(v) ? String(v[0]) : String(v ?? '');
}

export const getAdminStats = async (_req: Request, res: Response) => {
    try {
        const results = await Promise.allSettled([
            db.select({ count: count() }).from(users),
            db.select({ count: count() }).from(users).where(eq(users.role, "mistri")),
            db.select({ count: count() }).from(users).where(eq(users.role, "user")),
            db.select({ count: count() }).from(serviceRequests).where(eq(serviceRequests.status, "pending")),
            db.select({ count: count() }).from(ratings).where(eq(ratings.isApproved, false)),
            db.select({ total: sum(serviceRequests.paymentAmount) })
                .from(serviceRequests)
                .where(eq(serviceRequests.status, "completed")),
            db.select({ count: count() }).from(smsLogs).where(eq(smsLogs.status, "success")),
        ]);

        const labels = [
            "totalUsers",
            "totalMistris",
            "totalCustomers",
            "pendingRequests",
            "pendingRatings",
            "totalRevenue",
            "totalSmsSent",
        ] as const;

        results.forEach((result, idx) => {
            if (result.status === "rejected") {
                console.error(`Admin stats query failed (${labels[idx]}):`, result.reason);
            }
        });

        const getCount = (idx: number): number => {
            const r = results[idx];
            if (r.status !== "fulfilled") return 0;
            const row = r.value?.[0] as { count?: string | number } | undefined;
            return Number(row?.count ?? 0);
        };

        const getRevenue = (idx: number): number => {
            const r = results[idx];
            if (r.status !== "fulfilled") return 0;
            const row = r.value?.[0] as { total?: string | number | null } | undefined;
            return parseFloat(String(row?.total ?? "0"));
        };

        return res.json({
            success: true,
            stats: {
                totalUsers: getCount(0),
                totalMistris: getCount(1),
                totalCustomers: getCount(2),
                pendingRequests: getCount(3),
                pendingRatings: getCount(4),
                totalRevenue: getRevenue(5),
                totalSmsSent: getCount(6),
            },
        });
    } catch (error) {
        console.error("Error fetching admin stats:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch stats" });
    }
};

export const getUsers = async (req: Request, res: Response) => {
    try {
        const role = strParam(req.query.role);
        const search = strParam(req.query.search);
        const pageNum = Math.max(1, parseInt(strParam(req.query.page) || "1"));
        const limitNum = Math.min(100, parseInt(strParam(req.query.limit) || "20"));
        const offset = (pageNum - 1) * limitNum;

        const conditions: SQL[] = [];
        if (role && ["user", "mistri", "admin"].includes(role)) {
            conditions.push(eq(users.role, role as "user" | "mistri" | "admin"));
        }
        if (search) {
            conditions.push(
                or(
                    ilike(users.fullName, `%${search}%`),
                    ilike(users.phoneNumber, `%${search}%`)
                )!
            );
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [rows, [{ total }]] = await Promise.all([
            db.select({
                id: users.id,
                fullName: users.fullName,
                phoneNumber: users.phoneNumber,
                role: users.role,
                isActive: users.isActive,
                isOnboarded: users.isOnboarded,
                createdAt: users.createdAt,
            })
                .from(users)
                .where(whereClause)
                .orderBy(desc(users.createdAt))
                .limit(limitNum)
                .offset(offset),
            db.select({ total: count() }).from(users).where(whereClause),
        ]);

        return res.json({
            success: true,
            users: rows,
            pagination: { page: pageNum, limit: limitNum, total: total },
        });
    } catch (error) {
        console.error("Error fetching users:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch users" });
    }
};

export const getUserById = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const [profile] = await db.select().from(mistriProfiles).where(eq(mistriProfiles.userId, id)).limit(1);

        return res.json({ success: true, user, mistriProfile: profile || null });
    } catch (error) {
        console.error("Error fetching user:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch user" });
    }
};

const updateUserSchema = z.object({
    fullName: z.string().min(1).optional(),
    role: z.enum(["user", "mistri", "admin"]).optional(),
});

export const updateUser = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = req.user!.id;
        const parsed = updateUserSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
        }

        const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "User not found" });

        const [updated] = await db.update(users).set({ ...parsed.data, updatedAt: new Date() }).where(eq(users.id, id)).returning();

        await createAuditLog({
            entityType: "user",
            entityId: id,
            action: "update",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { fullName: existing.fullName, role: existing.role },
            newValue: parsed.data,
        });

        return res.json({ success: true, user: updated });
    } catch (error) {
        console.error("Error updating user:", error);
        return res.status(500).json({ success: false, message: "Failed to update user" });
    }
};

export const toggleUserActive = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = req.user!.id;

        const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "User not found" });

        const newActive = !existing.isActive;
        const [updated] = await db.update(users).set({ isActive: newActive, updatedAt: new Date() }).where(eq(users.id, id)).returning();

        await createAuditLog({
            entityType: "user",
            entityId: id,
            action: newActive ? "activate" : "deactivate",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { isActive: existing.isActive },
            newValue: { isActive: newActive },
        });

        return res.json({ success: true, user: updated });
    } catch (error) {
        console.error("Error toggling user active status:", error);
        return res.status(500).json({ success: false, message: "Failed to update user" });
    }
};

export const getMistrisCounts = async (req: Request, res: Response) => {
    try {
        const search = strParam(req.query.search);
        const baseConditions: SQL[] = [eq(users.role, "mistri")];
        if (search) {
            baseConditions.push(
                or(
                    ilike(users.fullName, `%${search}%`),
                    ilike(users.phoneNumber, `%${search}%`)
                )!
            );
        }
        const baseWhere = and(...baseConditions);

        const countJoined = (extra?: SQL) =>
            db
                .select({ c: count() })
                .from(users)
                .leftJoin(mistriProfiles, eq(users.id, mistriProfiles.userId))
                .where(extra ? and(baseWhere, extra) : baseWhere);

        const [[{ c: all }], [{ c: pending }], [{ c: approved }], [{ c: rejected }]] = await Promise.all([
            countJoined(),
            countJoined(eq(mistriProfiles.approvalStatus, "pending")),
            countJoined(eq(mistriProfiles.approvalStatus, "approved")),
            countJoined(eq(mistriProfiles.approvalStatus, "rejected")),
        ]);

        return res.json({
            success: true,
            counts: { all, pending, approved, rejected },
        });
    } catch (error) {
        console.error("Error fetching mistri counts:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch mistri counts" });
    }
};

export const getMistris = async (req: Request, res: Response) => {
    try {
        const search = strParam(req.query.search);
        const pageNum = Math.max(1, parseInt(strParam(req.query.page) || "1"));
        const limitNum = Math.min(100, parseInt(strParam(req.query.limit) || "20"));
        const offset = (pageNum - 1) * limitNum;

        const conditions: SQL[] = [eq(users.role, "mistri")];
        if (search) {
            conditions.push(
                or(
                    ilike(users.fullName, `%${search}%`),
                    ilike(users.phoneNumber, `%${search}%`)
                )!
            );
        }

        const approvalFilter = strParam(req.query.approvalStatus);

        if (approvalFilter && ["pending", "approved", "rejected"].includes(approvalFilter)) {
            conditions.push(eq(mistriProfiles.approvalStatus, approvalFilter as "pending" | "approved" | "rejected"));
        }

        const listBase = () =>
            db
                .select({
                    id: users.id,
                    fullName: users.fullName,
                    phoneNumber: users.phoneNumber,
                    isActive: users.isActive,
                    createdAt: users.createdAt,
                    serviceId: mistriProfiles.serviceId,
                    profilePhotoUrl: mistriProfiles.profilePhotoUrl,
                    isAvailable: mistriProfiles.isAvailable,
                    availabilityStatus: mistriProfiles.availabilityStatus,
                    isFeatured: mistriProfiles.isFeatured,
                    averageRating: mistriProfiles.averageRating,
                    jobsCompleted: mistriProfiles.jobsCompleted,
                    approvalStatus: mistriProfiles.approvalStatus,
                    approvalRejectionReason: mistriProfiles.approvalRejectionReason,
                    govtIdFrontUrl: mistriProfiles.govtIdFrontUrl,
                    govtIdBackUrl: mistriProfiles.govtIdBackUrl,
                    experienceLevel: mistriProfiles.experienceLevel,
                    govtIdType: mistriProfiles.govtIdType,
                })
                .from(users)
                .leftJoin(mistriProfiles, eq(users.id, mistriProfiles.userId))
                .where(and(...conditions));

        const [rows, [{ total }]] = await Promise.all([
            listBase().orderBy(desc(users.createdAt)).limit(limitNum).offset(offset),
            db
                .select({ total: count() })
                .from(users)
                .leftJoin(mistriProfiles, eq(users.id, mistriProfiles.userId))
                .where(and(...conditions)),
        ]);

        return res.json({
            success: true,
            mistris: rows,
            pagination: { page: pageNum, limit: limitNum, total: total },
        });
    } catch (error) {
        console.error("Error fetching mistris:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch mistris" });
    }
};

export const toggleMistriFeatured = async (req: Request, res: Response) => {
    try {
        const userId = req.params.userId as string;
        const adminId = req.user!.id;

        const [existing] = await db.select().from(mistriProfiles).where(eq(mistriProfiles.userId, userId)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Mistri profile not found" });

        const newFeatured = !existing.isFeatured;
        const [updated] = await db.update(mistriProfiles).set({ isFeatured: newFeatured }).where(eq(mistriProfiles.userId, userId)).returning();

        await createAuditLog({
            entityType: "mistri_profile",
            entityId: userId,
            action: "toggle_featured",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { isFeatured: existing.isFeatured },
            newValue: { isFeatured: newFeatured },
        });

        return res.json({ success: true, profile: updated });
    } catch (error) {
        console.error("Error toggling mistri featured:", error);
        return res.status(500).json({ success: false, message: "Failed to update mistri" });
    }
};

export const updateMistriService = async (req: Request, res: Response) => {
    try {
        const userId = req.params.userId as string;
        const adminId = req.user!.id;
        const { serviceId } = req.body;

        if (!serviceId || isNaN(parseInt(serviceId))) {
            return res.status(400).json({ success: false, message: "Valid serviceId required" });
        }

        const [existing] = await db.select().from(mistriProfiles).where(eq(mistriProfiles.userId, userId)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Mistri profile not found" });

        const [updated] = await db.update(mistriProfiles).set({ serviceId: parseInt(serviceId) }).where(eq(mistriProfiles.userId, userId)).returning();

        await createAuditLog({
            entityType: "mistri_profile",
            entityId: userId,
            action: "update_service",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { serviceId: existing.serviceId },
            newValue: { serviceId: parseInt(serviceId) },
        });

        return res.json({ success: true, profile: updated });
    } catch (error) {
        console.error("Error updating mistri service:", error);
        return res.status(500).json({ success: false, message: "Failed to update mistri" });
    }
};

export const approveMistri = async (req: Request, res: Response) => {
    try {
        const userId = req.params.userId as string;
        const adminId = req.user!.id;

        const [existing] = await db.select().from(mistriProfiles).where(eq(mistriProfiles.userId, userId)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Mistri profile not found" });

        const [updated] = await db.update(mistriProfiles)
            .set({ approvalStatus: "approved", approvalRejectionReason: null })
            .where(eq(mistriProfiles.userId, userId))
            .returning();

        await createAuditLog({
            entityType: "mistri_profile",
            entityId: userId,
            action: "approve",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { approvalStatus: existing.approvalStatus },
            newValue: { approvalStatus: "approved" },
        });

        const mistriUser = await db.query.users.findFirst({
            where: eq(users.id, userId),
        });
        if (mistriUser?.phoneNumber) {
            const first = mistriUser.fullName?.trim()?.split(/\s+/)[0];
            const greeting = first ? `Hi ${first}, ` : "Hi, ";
            const text = `SERVEX: ${greeting}your ServeX Mistri account is approved. Open the app to receive service requests.`;
            try {
                await sendSms(mistriUser.phoneNumber, text, "mistri_approved");
            } catch (smsError) {
                console.error("Failed to send mistri approval SMS:", smsError);
            }
        }

        return res.json({ success: true, profile: updated });
    } catch (error) {
        console.error("Error approving mistri:", error);
        return res.status(500).json({ success: false, message: "Failed to approve mistri" });
    }
};

export const rejectMistri = async (req: Request, res: Response) => {
    try {
        const userId = req.params.userId as string;
        const adminId = req.user!.id;
        const { reason } = req.body;

        const [existing] = await db.select().from(mistriProfiles).where(eq(mistriProfiles.userId, userId)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Mistri profile not found" });

        const [updated] = await db.update(mistriProfiles)
            .set({
                approvalStatus: "rejected",
                approvalRejectionReason: reason || null,
            })
            .where(eq(mistriProfiles.userId, userId))
            .returning();

        await createAuditLog({
            entityType: "mistri_profile",
            entityId: userId,
            action: "reject",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { approvalStatus: existing.approvalStatus },
            newValue: { approvalStatus: "rejected", reason: reason || null },
        });

        return res.json({ success: true, profile: updated });
    } catch (error) {
        console.error("Error rejecting mistri:", error);
        return res.status(500).json({ success: false, message: "Failed to reject mistri" });
    }
};

export const getAdminServiceRequests = async (req: Request, res: Response) => {
    try {
        const status = strParam(req.query.status);
        const pageNum = Math.max(1, parseInt(strParam(req.query.page) || "1"));
        const limitNum = Math.min(100, parseInt(strParam(req.query.limit) || "20"));
        const offset = (pageNum - 1) * limitNum;

        const conditions: SQL[] = [];
        if (status && ["pending", "assigned", "canceled", "completed"].includes(status)) {
            conditions.push(eq(serviceRequests.status, status as "pending" | "assigned" | "canceled" | "completed"));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [rows, [{ total }]] = await Promise.all([
            db.select({
                id: serviceRequests.id,
                type: serviceRequests.type,
                status: serviceRequests.status,
                address: serviceRequests.address,
                paymentAmount: serviceRequests.paymentAmount,
                unpaid: serviceRequests.unpaid,
                createdAt: serviceRequests.createdAt,
                completedAt: serviceRequests.completedAt,
                customerName: users.fullName,
                customerId: serviceRequests.customerId,
            })
                .from(serviceRequests)
                .innerJoin(users, eq(serviceRequests.customerId, users.id))
                .where(whereClause)
                .orderBy(desc(serviceRequests.createdAt))
                .limit(limitNum)
                .offset(offset),
            db.select({ total: count() }).from(serviceRequests).where(whereClause),
        ]);

        return res.json({
            success: true,
            requests: rows,
            pagination: { page: pageNum, limit: limitNum, total: total },
        });
    } catch (error) {
        console.error("Error fetching service requests:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch service requests" });
    }
};

export const getAuditLogs = async (req: Request, res: Response) => {
    try {
        const entityType = strParam(req.query.entityType);
        const pageNum = Math.max(1, parseInt(strParam(req.query.page) || "1"));
        const limitNum = Math.min(200, parseInt(strParam(req.query.limit) || "50"));
        const offset = (pageNum - 1) * limitNum;

        const conditions: SQL[] = [];
        if (entityType) {
            conditions.push(eq(auditLogs.entityType, entityType));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [rows, [{ total }]] = await Promise.all([
            db.select({
                id: auditLogs.id,
                entityType: auditLogs.entityType,
                entityId: auditLogs.entityId,
                action: auditLogs.action,
                performedByRole: auditLogs.performedByRole,
                oldValue: auditLogs.oldValue,
                newValue: auditLogs.newValue,
                metadata: auditLogs.metadata,
                createdAt: auditLogs.createdAt,
                performedByName: users.fullName,
            })
                .from(auditLogs)
                .leftJoin(users, eq(auditLogs.performedBy, users.id))
                .where(whereClause)
                .orderBy(desc(auditLogs.createdAt))
                .limit(limitNum)
                .offset(offset),
            db.select({ total: count() }).from(auditLogs).where(whereClause),
        ]);

        return res.json({
            success: true,
            logs: rows,
            pagination: { page: pageNum, limit: limitNum, total: total },
        });
    } catch (error) {
        console.error("Error fetching audit logs:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch audit logs" });
    }
};

const SMS_TYPES = [
    "otp_login",
    "otp_phone_change",
    "otp_account_deletion",
    "otp_admin",
    "service_accepted",
    "service_completed",
    "mistri_approved",
] as const;

export const getSmsStats = async (_req: Request, res: Response) => {
    try {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const [totalRow, todayRow, monthRow, failedRow, byTypeRows] = await Promise.all([
            db.select({ count: count() }).from(smsLogs).where(eq(smsLogs.status, "success")),
            db.select({ count: count() }).from(smsLogs).where(
                and(eq(smsLogs.status, "success"), gte(smsLogs.createdAt, startOfToday))
            ),
            db.select({ count: count() }).from(smsLogs).where(
                and(eq(smsLogs.status, "success"), gte(smsLogs.createdAt, startOfMonth))
            ),
            db.select({ count: count() }).from(smsLogs).where(eq(smsLogs.status, "failed")),
            db.select({ type: smsLogs.type, count: count() })
                .from(smsLogs)
                .where(eq(smsLogs.status, "success"))
                .groupBy(smsLogs.type),
        ]);

        const byType = Object.fromEntries(SMS_TYPES.map((t) => [t, 0]));
        for (const row of byTypeRows) {
            byType[row.type] = Number(row.count);
        }

        return res.json({
            success: true,
            stats: {
                total: Number(totalRow[0]?.count ?? 0),
                today: Number(todayRow[0]?.count ?? 0),
                thisMonth: Number(monthRow[0]?.count ?? 0),
                failed: Number(failedRow[0]?.count ?? 0),
                byType,
            },
        });
    } catch (error) {
        console.error("Error fetching SMS stats:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch SMS stats" });
    }
};

export const getSmsLogs = async (req: Request, res: Response) => {
    try {
        const type = strParam(req.query.type);
        const status = strParam(req.query.status);
        const from = strParam(req.query.from);
        const to = strParam(req.query.to);
        const pageNum = Math.max(1, parseInt(strParam(req.query.page) || "1"));
        const limitNum = Math.min(200, parseInt(strParam(req.query.limit) || "50"));
        const offset = (pageNum - 1) * limitNum;

        const conditions: SQL[] = [];
        if (type && SMS_TYPES.includes(type as typeof SMS_TYPES[number])) {
            conditions.push(eq(smsLogs.type, type as typeof SMS_TYPES[number]));
        }
        if (status && ["success", "failed"].includes(status)) {
            conditions.push(eq(smsLogs.status, status));
        }
        if (from) {
            conditions.push(gte(smsLogs.createdAt, new Date(from)));
        }
        if (to) {
            conditions.push(lte(smsLogs.createdAt, new Date(to)));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [rows, [{ total }]] = await Promise.all([
            db.select().from(smsLogs).where(whereClause).orderBy(desc(smsLogs.createdAt)).limit(limitNum).offset(offset),
            db.select({ total: count() }).from(smsLogs).where(whereClause),
        ]);

        return res.json({
            success: true,
            logs: rows,
            pagination: { page: pageNum, limit: limitNum, total: Number(total) },
        });
    } catch (error) {
        console.error("Error fetching SMS logs:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch SMS logs" });
    }
};
