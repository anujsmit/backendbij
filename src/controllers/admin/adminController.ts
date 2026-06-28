// backend/src/controllers/admin/adminController.ts
import { Request, Response } from "express";
import { db } from "../../db";
import {
    users,                    // ✅ Admin users only
    userAccounts,             // ✅ Customer accounts
    mistriAccounts,           // ✅ Mistri accounts
    mistriProfiles,
    serviceRequests,
    ratings,
    services,
    auditLogs,
    smsLogs,
} from "../../db/schema";
import { eq, and, desc, ilike, or, count, sql, sum, SQL, gte, lte, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createAuditLog } from "../../services/auditLog";
import { sendSms } from "../../services/sms";
import { createNotification } from "../notificationController";
import { shouldSendNotification } from "../../services/notificationPreferences";
import { stopDispatch } from "../../services/dispatch";
import { z } from "zod";

function strParam(v: unknown): string {
    return Array.isArray(v) ? String(v[0]) : String(v ?? '');
}

// ============================================
// MISTRI JOBS
// ============================================

export const getMistriJobs = async (req: Request, res: Response) => {
    try {
        const mistriId = req.params.id;
        const status = req.query.status as string;
        
        const conditions: SQL[] = [
            eq(serviceRequests.assignedMistriId, mistriId),
        ];
        
        if (status) {
            conditions.push(eq(serviceRequests.status, status as any));
        }
        
        const jobs = await db
            .select()
            .from(serviceRequests)
            .where(and(...conditions));
        
        return res.json({
            success: true,
            count: jobs.length,
            jobs,
        });
    } catch (error) {
        console.error("Error fetching mistri jobs:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch mistri jobs",
        });
    }
};

// ============================================
// ADMIN STATS
// ============================================

export const getAdminStats = async (_req: Request, res: Response) => {
    try {
        const results = await Promise.allSettled([
            db.select({ count: count() }).from(users),
            db.select({ count: count() }).from(mistriAccounts),
            db.select({ count: count() }).from(userAccounts),
            db.select({ count: count() }).from(serviceRequests).where(eq(serviceRequests.status, "pending")),
            db.select({ count: count() }).from(ratings).where(eq(ratings.isApproved, false)),
            db.select({ total: sum(serviceRequests.paymentAmount) })
                .from(serviceRequests)
                .where(eq(serviceRequests.status, "completed")),
            db.select({ count: count() }).from(smsLogs).where(eq(smsLogs.status, "success")),
        ]);

        const labels = [
            "totalAdmins",
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
                totalAdmins: getCount(0),
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

// ============================================
// GET USERS (Admin users only)
// ============================================

export const getUsers = async (req: Request, res: Response) => {
    try {
        const search = strParam(req.query.search);
        const pageNum = Math.max(1, parseInt(strParam(req.query.page) || "1"));
        const limitNum = Math.min(100, parseInt(strParam(req.query.limit) || "20"));
        const offset = (pageNum - 1) * limitNum;

        const conditions: SQL[] = [];
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

// ============================================
// GET USER BY ID (Admin user only)
// ============================================

export const getUserById = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        return res.json({ success: true, user });
    } catch (error) {
        console.error("Error fetching user:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch user" });
    }
};

// ============================================
// GET CUSTOMER DETAIL (From userAccounts)
// ============================================

export const getCustomerDetail = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const [customer] = await db.select().from(userAccounts).where(eq(userAccounts.id, id)).limit(1);
        if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

        const orders = await db
            .select({
                id: serviceRequests.id,
                type: serviceRequests.type,
                status: serviceRequests.status,
                address: serviceRequests.address,
                paymentAmount: serviceRequests.paymentAmount,
                unpaid: serviceRequests.unpaid,
                createdAt: serviceRequests.createdAt,
                completedAt: serviceRequests.completedAt,
            })
            .from(serviceRequests)
            .where(eq(serviceRequests.customerId, id))
            .orderBy(desc(serviceRequests.createdAt))
            .limit(50);

        const [agg] = await db
            .select({
                total: count(),
                completed: sql<number>`count(*) filter (where ${serviceRequests.status} = 'completed')`,
                canceled: sql<number>`count(*) filter (where ${serviceRequests.status} = 'canceled')`,
                ltv: sql<string>`coalesce(sum(${serviceRequests.paymentAmount}) filter (where ${serviceRequests.status} = 'completed'), 0)`,
                unpaid: sql<string>`coalesce(sum(${serviceRequests.paymentAmount}) filter (where ${serviceRequests.unpaid} = true), 0)`,
                lastOrderAt: sql<string | null>`max(${serviceRequests.createdAt})`,
            })
            .from(serviceRequests)
            .where(eq(serviceRequests.customerId, id));

        const [rg] = await db
            .select({ avg: sql<string | null>`avg(${ratings.rating})`, cnt: count() })
            .from(ratings)
            .where(eq(ratings.customerId, id));

        const addrRows = await db
            .selectDistinct({ address: serviceRequests.address })
            .from(serviceRequests)
            .where(eq(serviceRequests.customerId, id))
            .limit(20);
        const addresses = addrRows.map((a) => a.address).filter(Boolean);

        let isFlagged = false;
        let flagNote: string | null = null;
        try {
            const r = await db.execute(sql`SELECT is_flagged, flag_note FROM user_accounts WHERE id = ${id} LIMIT 1`);
            const row = (r as unknown as Array<{ is_flagged: boolean; flag_note: string | null }>)[0];
            isFlagged = !!row?.is_flagged;
            flagNote = row?.flag_note ?? null;
        } catch { /* columns may not exist yet */ }

        return res.json({
            success: true,
            customer: {
                id: customer.id,
                fullName: customer.fullName,
                phoneNumber: customer.phoneNumber,
                accountType: customer.accountType,
                isActive: customer.isActive,
                isOnboarded: customer.isOnboarded,
                createdAt: customer.createdAt,
                updatedAt: customer.updatedAt,
                defaultLocation: customer.defaultLocation,
                hasDeviceToken: !!customer.deviceToken,
            },
            stats: {
                totalOrders: Number(agg?.total ?? 0),
                completedOrders: Number(agg?.completed ?? 0),
                canceledOrders: Number(agg?.canceled ?? 0),
                lifetimeValue: parseFloat(String(agg?.ltv ?? "0")) || 0,
                unpaidAmount: parseFloat(String(agg?.unpaid ?? "0")) || 0,
                lastOrderAt: agg?.lastOrderAt ?? null,
                ratingsGiven: Number(rg?.cnt ?? 0),
                avgRatingGiven: rg?.avg ? parseFloat(String(rg.avg)) : null,
            },
            orders,
            addresses,
            flag: { isFlagged, flagNote },
        });
    } catch (error) {
        console.error("Error fetching customer detail:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch customer" });
    }
};

// ============================================
// FLAG / UNFLAG CUSTOMER
// ============================================

export const flagUser = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = (req as any).user?.userId;
        const schema = z.object({ isFlagged: z.boolean(), flagNote: z.string().max(500).optional().nullable() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" });
        }
        const { isFlagged, flagNote } = parsed.data;

        const [existing] = await db.select().from(userAccounts).where(eq(userAccounts.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Customer not found" });

        let warning: string | undefined;
        try {
            await db.execute(sql`UPDATE user_accounts SET is_flagged = ${isFlagged}, flag_note = ${flagNote ?? null} WHERE id = ${id}`);
        } catch {
            warning = "Flag couldn't be saved — the customer-flag migration hasn't been run yet.";
        }

        await createAuditLog({
            entityType: "user_account",
            entityId: id,
            action: isFlagged ? "flag" : "unflag",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            newValue: { isFlagged, flagNote: flagNote ?? null },
        });

        return res.json({ success: true, message: isFlagged ? "Customer flagged" : "Flag cleared", ...(warning ? { warning } : {}) });
    } catch (error) {
        console.error("Error flagging user:", error);
        return res.status(500).json({ success: false, message: "Failed to update flag" });
    }
};

// ============================================
// MESSAGE CUSTOMER
// ============================================

export const messageUser = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const schema = z.object({
            title: z.string().trim().max(120).optional(),
            message: z.string().trim().min(1, "Message is required").max(500),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" });
        }
        const { title, message } = parsed.data;

        const [customer] = await db.select().from(userAccounts).where(eq(userAccounts.id, id)).limit(1);
        if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

        await createNotification(id, title?.trim() || "Message from ServeX", message, "admin_message");

        return res.json({
            success: true,
            message: customer.deviceToken ? "Message sent" : "Saved to their in-app inbox (no device registered for push)",
        });
    } catch (error) {
        console.error("Error messaging user:", error);
        return res.status(500).json({ success: false, message: "Failed to send message" });
    }
};

// ============================================
// GLOBAL SEARCH
// ============================================

export const getGlobalSearch = async (req: Request, res: Response) => {
    try {
        const q = strParam(req.query.q).trim();
        if (q.length < 2) {
            return res.json({ success: true, customers: [], mistris: [], requests: [] });
        }
        const like = `%${q}%`;

        const customerRows = await db
            .select({ id: userAccounts.id, fullName: userAccounts.fullName, phoneNumber: userAccounts.phoneNumber, accountType: userAccounts.accountType })
            .from(userAccounts)
            .where(or(ilike(userAccounts.fullName, like), ilike(userAccounts.phoneNumber, like)))
            .orderBy(desc(userAccounts.createdAt))
            .limit(8);

        const mistriRows = await db
            .select({ id: mistriAccounts.id, fullName: mistriAccounts.fullName, phoneNumber: mistriAccounts.phoneNumber, accountType: mistriAccounts.accountType })
            .from(mistriAccounts)
            .where(or(ilike(mistriAccounts.fullName, like), ilike(mistriAccounts.phoneNumber, like)))
            .orderBy(desc(mistriAccounts.createdAt))
            .limit(8);

        const customers = customerRows.slice(0, 6);
        const mistris = mistriRows.slice(0, 6);

        const cust = alias(userAccounts, "search_cust");
        const requests = await db
            .select({
                id: serviceRequests.id,
                type: serviceRequests.type,
                status: serviceRequests.status,
                address: serviceRequests.address,
                customerName: cust.fullName,
            })
            .from(serviceRequests)
            .leftJoin(cust, eq(serviceRequests.customerId, cust.id))
            .where(or(ilike(serviceRequests.address, like), sql`${serviceRequests.id}::text ilike ${like}`))
            .orderBy(desc(serviceRequests.createdAt))
            .limit(6);

        return res.json({ success: true, customers, mistris, requests });
    } catch (error) {
        console.error("Global search error:", error);
        return res.status(500).json({ success: false, message: "Search failed" });
    }
};

// ============================================
// UPDATE ADMIN USER
// ============================================

const updateUserSchema = z.object({
    fullName: z.string().min(1).optional(),
});

export const updateUser = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = (req as any).user?.userId;
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
            performedBy: adminId || 'system',
            performedByRole: "admin",
            oldValue: { fullName: existing.fullName },
            newValue: parsed.data,
        });

        return res.json({ success: true, user: updated });
    } catch (error) {
        console.error("Error updating user:", error);
        return res.status(500).json({ success: false, message: "Failed to update user" });
    }
};

// ============================================
// TOGGLE ADMIN USER ACTIVE
// ============================================

export const toggleUserActive = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = (req as any).user?.userId;

        const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "User not found" });

        const newActive = !existing.isActive;
        const [updated] = await db.update(users).set({ isActive: newActive, updatedAt: new Date() }).where(eq(users.id, id)).returning();

        await createAuditLog({
            entityType: "user",
            entityId: id,
            action: newActive ? "activate" : "deactivate",
            performedBy: adminId || 'system',
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

// ============================================
// GET MISTRI COUNTS
// ============================================

export const getMistrisCounts = async (req: Request, res: Response) => {
    try {
        const search = strParam(req.query.search);
        const baseConditions: SQL[] = [eq(mistriAccounts.accountType, "mistri")];
        if (search) {
            baseConditions.push(
                or(
                    ilike(mistriAccounts.fullName, `%${search}%`),
                    ilike(mistriAccounts.phoneNumber, `%${search}%`)
                )!
            );
        }
        const baseWhere = and(...baseConditions);

        const countJoined = (extra?: SQL) =>
            db
                .select({ c: count() })
                .from(mistriAccounts)
                .leftJoin(mistriProfiles, eq(mistriAccounts.id, mistriProfiles.mistriId))
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

// ============================================
// GET MISTRIS
// ============================================

export const getMistris = async (req: Request, res: Response) => {
    try {
        const search = strParam(req.query.search);
        const pageNum = Math.max(1, parseInt(strParam(req.query.page) || "1"));
        const limitNum = Math.min(100, parseInt(strParam(req.query.limit) || "20"));
        const offset = (pageNum - 1) * limitNum;

        const conditions: SQL[] = [eq(mistriAccounts.accountType, "mistri")];
        if (search) {
            conditions.push(
                or(
                    ilike(mistriAccounts.fullName, `%${search}%`),
                    ilike(mistriAccounts.phoneNumber, `%${search}%`)
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
                    id: mistriAccounts.id,
                    fullName: mistriAccounts.fullName,
                    phoneNumber: mistriAccounts.phoneNumber,
                    isActive: mistriAccounts.isActive,
                    createdAt: mistriAccounts.createdAt,
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
                .from(mistriAccounts)
                .leftJoin(mistriProfiles, eq(mistriAccounts.id, mistriProfiles.mistriId))
                .where(and(...conditions));

        const [rows, [{ total }]] = await Promise.all([
            listBase().orderBy(desc(mistriAccounts.createdAt)).limit(limitNum).offset(offset),
            db
                .select({ total: count() })
                .from(mistriAccounts)
                .leftJoin(mistriProfiles, eq(mistriAccounts.id, mistriProfiles.mistriId))
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

// ============================================
// TOGGLE MISTRI FEATURED
// ============================================

export const toggleMistriFeatured = async (req: Request, res: Response) => {
    try {
        const mistriId = req.params.userId as string;
        const adminId = (req as any).user?.userId;

        const [existing] = await db.select().from(mistriProfiles).where(eq(mistriProfiles.mistriId, mistriId)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Mistri profile not found" });

        const newFeatured = !existing.isFeatured;
        const [updated] = await db.update(mistriProfiles).set({ isFeatured: newFeatured }).where(eq(mistriProfiles.mistriId, mistriId)).returning();

        await createAuditLog({
            entityType: "mistri_profile",
            entityId: mistriId,
            action: "toggle_featured",
            performedBy: adminId || 'system',
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

// ============================================
// UPDATE MISTRI SERVICE
// ============================================

export const updateMistriService = async (req: Request, res: Response) => {
    try {
        const mistriId = req.params.userId as string;
        const adminId = (req as any).user?.userId;
        const { serviceId } = req.body;

        if (!serviceId || isNaN(parseInt(serviceId))) {
            return res.status(400).json({ success: false, message: "Valid serviceId required" });
        }

        const [existing] = await db.select().from(mistriProfiles).where(eq(mistriProfiles.mistriId, mistriId)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Mistri profile not found" });

        const [updated] = await db.update(mistriProfiles).set({ serviceId: parseInt(serviceId) }).where(eq(mistriProfiles.mistriId, mistriId)).returning();

        await createAuditLog({
            entityType: "mistri_profile",
            entityId: mistriId,
            action: "update_service",
            performedBy: adminId || 'system',
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

// ============================================
// APPROVE MISTRI
// ============================================

export const approveMistri = async (req: Request, res: Response) => {
    try {
        const mistriId = req.params.userId as string;
        const adminId = (req as any).user?.userId;

        const [existing] = await db.select().from(mistriProfiles).where(eq(mistriProfiles.mistriId, mistriId)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Mistri profile not found" });

        const [updated] = await db.update(mistriProfiles)
            .set({ approvalStatus: "approved", approvalRejectionReason: null })
            .where(eq(mistriProfiles.mistriId, mistriId))
            .returning();

        await createAuditLog({
            entityType: "mistri_profile",
            entityId: mistriId,
            action: "approve",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            oldValue: { approvalStatus: existing.approvalStatus },
            newValue: { approvalStatus: "approved" },
        });

        const mistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.id, mistriId),
        });
        if (mistri?.phoneNumber) {
            const first = mistri.fullName?.trim()?.split(/\s+/)[0];
            const greeting = first ? `Hi ${first}, ` : "Hi, ";
            const text = `SERVEX: ${greeting}your ServeX Mistri account is approved. Open the app to receive service requests.`;
            try {
                await sendSms(mistri.phoneNumber, text, "mistri_approved");
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

// ============================================
// REJECT MISTRI
// ============================================

export const rejectMistri = async (req: Request, res: Response) => {
    try {
        const mistriId = req.params.userId as string;
        const adminId = (req as any).user?.userId;
        const { reason } = req.body;

        const [existing] = await db.select().from(mistriProfiles).where(eq(mistriProfiles.mistriId, mistriId)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Mistri profile not found" });

        const [updated] = await db.update(mistriProfiles)
            .set({
                approvalStatus: "rejected",
                approvalRejectionReason: reason || null,
            })
            .where(eq(mistriProfiles.mistriId, mistriId))
            .returning();

        await createAuditLog({
            entityType: "mistri_profile",
            entityId: mistriId,
            action: "reject",
            performedBy: adminId || 'system',
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

// ============================================
// CREATE MISTRI (Admin manual onboard)
// ============================================

const VALID_EXPERIENCE = ["less_than_1", "1_to_3", "3_plus"] as const;

const createMistriSchema = z.object({
    fullName: z.string().trim().min(2, "Name is too short").max(255),
    phoneNumber: z
        .string()
        .trim()
        .transform((s) => s.replace(/\s+/g, ""))
        .pipe(z.string().regex(/^\d{10}$/, "Phone number must be 10 digits")),
    serviceId: z.coerce.number().int().positive(),
    experienceLevel: z.enum(VALID_EXPERIENCE).optional().nullable(),
    bio: z.string().trim().max(1000).optional().nullable(),
    approvalStatus: z.enum(["pending", "approved", "rejected"]).optional(),
    isFeatured: z.boolean().optional(),
    isActive: z.boolean().optional(),
    notify: z.boolean().optional(),
});

export const createMistri = async (req: Request, res: Response) => {
    try {
        const parsed = createMistriSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid data" });
        }
        const v = parsed.data;
        const adminId = (req as any).user?.userId;

        const [svc] = await db.select().from(services).where(eq(services.id, v.serviceId)).limit(1);
        if (!svc) {
            return res.status(400).json({ success: false, message: "Invalid service category" });
        }

        const [existingAdmin] = await db.select().from(users).where(eq(users.phoneNumber, v.phoneNumber)).limit(1);
        if (existingAdmin) {
            return res.status(409).json({ success: false, message: "This phone number belongs to an admin account" });
        }

        const [existingUser] = await db.select().from(userAccounts).where(eq(userAccounts.phoneNumber, v.phoneNumber)).limit(1);
        if (existingUser) {
            return res.status(409).json({ success: false, message: "This phone number is already registered as a customer" });
        }

        const [existingMistri] = await db.select().from(mistriAccounts).where(eq(mistriAccounts.phoneNumber, v.phoneNumber)).limit(1);
        if (existingMistri) {
            const [existingProfile] = await db.select().from(mistriProfiles).where(eq(mistriProfiles.mistriId, existingMistri.id)).limit(1);
            if (existingProfile) {
                return res.status(409).json({ success: false, message: "This phone number is already registered as a ServeX provider" });
            }
        }

        const approvalStatus = v.approvalStatus ?? "approved";
        const isActive = v.isActive ?? true;
        const now = new Date();
        let mistriId = "";

        await db.transaction(async (tx) => {
            const [newMistri] = await tx.insert(mistriAccounts).values({
                phoneNumber: v.phoneNumber,
                fullName: v.fullName,
                accountType: "mistri",
                isActive,
                isOnboarded: true,
                onboardingCompletedAt: now,
                passwordHash: "",
            }).returning();
            mistriId = newMistri.id;

            await tx.insert(mistriProfiles).values({
                mistriId: newMistri.id,
                serviceId: v.serviceId,
                bio: v.bio?.trim() || null,
                experienceLevel: v.experienceLevel ?? null,
                approvalStatus,
                isFeatured: v.isFeatured ?? false,
            });
        });

        await createAuditLog({
            entityType: "mistri_account",
            entityId: mistriId,
            action: "admin_create",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            newValue: { fullName: v.fullName, phoneNumber: v.phoneNumber, serviceId: v.serviceId, approvalStatus },
        });

        if (v.notify && approvalStatus === "approved" && isActive) {
            const first = v.fullName.trim().split(/\s+/)[0];
            const text = `SERVEX: Hi ${first}, your ServeX Mistri account has been created and approved. Download the ServeX app and log in with this number to start receiving service requests.`;
            try {
                await sendSms(v.phoneNumber, text, "mistri_approved");
            } catch (smsError) {
                console.error("Failed to send mistri welcome SMS:", smsError);
            }
        }

        return res.status(201).json({
            success: true,
            mistriId,
            message: "ServeX provider created successfully",
        });
    } catch (error: any) {
        if (error?.code === "23505") {
            return res.status(409).json({ success: false, message: "This phone number is already registered" });
        }
        console.error("Error creating mistri:", error);
        return res.status(500).json({ success: false, message: "Failed to create ServeX provider" });
    }
};

// ============================================
// CREATE USER (Admin manual onboard)
// ============================================

const createUserSchema = z.object({
    fullName: z.string().trim().min(2, "Name is too short").max(255),
    phoneNumber: z
        .string()
        .trim()
        .transform((s) => s.replace(/\s+/g, ""))
        .pipe(z.string().regex(/^\d{10}$/, "Phone number must be 10 digits")),
    isActive: z.boolean().optional(),
});

export const createUser = async (req: Request, res: Response) => {
    try {
        const parsed = createUserSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid data" });
        }
        const v = parsed.data;
        const adminId = (req as any).user?.userId;

        const [existingAdmin] = await db.select().from(users).where(eq(users.phoneNumber, v.phoneNumber)).limit(1);
        if (existingAdmin) {
            return res.status(409).json({ success: false, message: "This phone number belongs to an admin account" });
        }

        const [existingUser] = await db.select().from(userAccounts).where(eq(userAccounts.phoneNumber, v.phoneNumber)).limit(1);
        if (existingUser) {
            return res.status(409).json({ success: false, message: "This phone number is already registered as a customer" });
        }

        const [existingMistri] = await db.select().from(mistriAccounts).where(eq(mistriAccounts.phoneNumber, v.phoneNumber)).limit(1);
        if (existingMistri) {
            return res.status(409).json({ success: false, message: "This phone number is already registered as a mistri" });
        }

        const now = new Date();
        const [created] = await db.insert(userAccounts).values({
            phoneNumber: v.phoneNumber,
            fullName: v.fullName,
            accountType: "user",
            isActive: v.isActive ?? true,
            isOnboarded: false,
            passwordHash: "",
        }).returning();

        await createAuditLog({
            entityType: "user_account",
            entityId: created.id,
            action: "admin_create",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            newValue: { fullName: created.fullName, phoneNumber: created.phoneNumber, accountType: "user" },
        });

        return res.status(201).json({ success: true, user: created });
    } catch (error: any) {
        if (error?.code === "23505") {
            return res.status(409).json({ success: false, message: "This phone number is already registered" });
        }
        console.error("Error creating user:", error);
        return res.status(500).json({ success: false, message: "Failed to create user" });
    }
};

// ============================================
// GET ADMIN SERVICE REQUESTS
// ============================================

export const getAdminServiceRequests = async (req: Request, res: Response) => {
    try {
        const status = strParam(req.query.status);
        const tab = strParam(req.query.tab);
        const search = strParam(req.query.search);
        const pageNum = Math.max(1, parseInt(strParam(req.query.page) || "1"));
        const limitNum = Math.min(100, parseInt(strParam(req.query.limit) || "20"));
        const offset = (pageNum - 1) * limitNum;

        const mistriUser = alias(mistriAccounts, "mistri_user");

        const conditions: SQL[] = [];
        if (status && ["pending", "assigned", "canceled", "completed"].includes(status)) {
            conditions.push(eq(serviceRequests.status, status as "pending" | "assigned" | "canceled" | "completed"));
        }
        if (tab === "running") {
            conditions.push(eq(serviceRequests.status, "assigned"));
        }
        if (tab === "unpaid") {
            conditions.push(eq(serviceRequests.unpaid, true));
        }
        if (search) {
            conditions.push(
                or(
                    ilike(userAccounts.fullName, `%${search}%`),
                    ilike(serviceRequests.address, `%${search}%`),
                    ilike(userAccounts.phoneNumber, `%${search}%`)
                )!
            );
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [rows, [{ total }]] = await Promise.all([
            db.select({
                id: serviceRequests.id,
                type: serviceRequests.type,
                status: serviceRequests.status,
                address: serviceRequests.address,
                lat: serviceRequests.lat,
                lng: serviceRequests.lng,
                paymentAmount: serviceRequests.paymentAmount,
                unpaid: serviceRequests.unpaid,
                customerNotes: serviceRequests.customerNotes,
                createdAt: serviceRequests.createdAt,
                assignedAt: serviceRequests.assignedAt,
                startedWorkAt: serviceRequests.startedWorkAt,
                completedAt: serviceRequests.completedAt,
                paidAt: serviceRequests.paidAt,
                customerName: userAccounts.fullName,
                customerPhone: userAccounts.phoneNumber,
                customerId: serviceRequests.customerId,
                assignedMistriId: serviceRequests.assignedMistriId,
                assignedMistriName: mistriUser.fullName,
                assignedMistriPhone: mistriUser.phoneNumber,
            })
                .from(serviceRequests)
                .innerJoin(userAccounts, eq(serviceRequests.customerId, userAccounts.id))
                .leftJoin(mistriUser, eq(serviceRequests.assignedMistriId, mistriUser.id))
                .where(whereClause)
                .orderBy(desc(serviceRequests.createdAt))
                .limit(limitNum)
                .offset(offset),
            db.select({ total: count() })
                .from(serviceRequests)
                .innerJoin(userAccounts, eq(serviceRequests.customerId, userAccounts.id))
                .where(whereClause),
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

// ============================================
// GET SERVICE REQUEST COUNTS
// ============================================

export const getServiceRequestCounts = async (_req: Request, res: Response) => {
    try {
        const [all, pending, assigned, completed, canceled, unpaid] = await Promise.all([
            db.select({ c: count() }).from(serviceRequests),
            db.select({ c: count() }).from(serviceRequests).where(eq(serviceRequests.status, "pending")),
            db.select({ c: count() }).from(serviceRequests).where(eq(serviceRequests.status, "assigned")),
            db.select({ c: count() }).from(serviceRequests).where(eq(serviceRequests.status, "completed")),
            db.select({ c: count() }).from(serviceRequests).where(eq(serviceRequests.status, "canceled")),
            db.select({ c: count() }).from(serviceRequests).where(eq(serviceRequests.unpaid, true)),
        ]);
        const n = (r: { c: number | string }[]) => Number(r?.[0]?.c ?? 0);
        return res.json({
            success: true,
            counts: {
                all: n(all),
                pending: n(pending),
                running: n(assigned),
                completed: n(completed),
                canceled: n(canceled),
                unpaid: n(unpaid),
            },
        });
    } catch (error) {
        console.error("Error fetching service request counts:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch counts" });
    }
};

// ============================================
// GET ASSIGNABLE MISTRIS
// ============================================

export const getAssignableMistris = async (req: Request, res: Response) => {
    try {
        const type = strParam(req.query.type);
        const search = strParam(req.query.search);

        const conditions: SQL[] = [
            eq(mistriAccounts.accountType, "mistri"),
            eq(mistriAccounts.isActive, true),
            eq(mistriProfiles.approvalStatus, "approved"),
        ];
        if (type) {
            conditions.push(eq(services.serviceName, type));
        }
        if (search) {
            conditions.push(
                or(
                    ilike(mistriAccounts.fullName, `%${search}%`),
                    ilike(mistriAccounts.phoneNumber, `%${search}%`)
                )!
            );
        }

        const rows = await db
            .select({
                id: mistriAccounts.id,
                fullName: mistriAccounts.fullName,
                phoneNumber: mistriAccounts.phoneNumber,
                serviceName: services.serviceName,
                profilePhotoUrl: mistriProfiles.profilePhotoUrl,
                availabilityStatus: mistriProfiles.availabilityStatus,
                isAvailable: mistriProfiles.isAvailable,
                averageRating: mistriProfiles.averageRating,
                jobsCompleted: mistriProfiles.jobsCompleted,
                experienceLevel: mistriProfiles.experienceLevel,
            })
            .from(mistriAccounts)
            .innerJoin(mistriProfiles, eq(mistriAccounts.id, mistriProfiles.mistriId))
            .innerJoin(services, eq(mistriProfiles.serviceId, services.id))
            .where(and(...conditions))
            .orderBy(desc(mistriProfiles.isAvailable), desc(mistriProfiles.averageRating), desc(mistriProfiles.jobsCompleted))
            .limit(100);

        return res.json({ success: true, mistris: rows });
    } catch (error) {
        console.error("Error fetching assignable mistris:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch mistris" });
    }
};

// ============================================
// ASSIGN SERVICE REQUEST (Admin)
// ============================================

export const assignServiceRequest = async (req: Request, res: Response) => {
    try {
        const adminId = (req as any).user?.userId;
        const adminRole = (req as any).user?.role || (req as any).accountType;
        const id = strParam(req.params.id);
        const mistriId = typeof req.body?.mistriId === "string" ? req.body.mistriId : "";
        const force = req.body?.force === true;

        if (!adminId || adminRole !== "admin") {
            return res.status(403).json({ success: false, message: "Admin access required" });
        }
        if (!mistriId) {
            return res.status(400).json({ success: false, message: "mistriId is required" });
        }

        const [reqRow] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1);
        if (!reqRow) {
            return res.status(404).json({ success: false, message: "Service request not found" });
        }
        if (reqRow.status === "completed" || reqRow.status === "canceled") {
            return res.status(400).json({ success: false, message: `Cannot assign a ${reqRow.status} request` });
        }

        const [mistri] = await db
            .select({
                id: mistriAccounts.id,
                fullName: mistriAccounts.fullName,
                phoneNumber: mistriAccounts.phoneNumber,
                approvalStatus: mistriProfiles.approvalStatus,
                serviceName: services.serviceName,
            })
            .from(mistriAccounts)
            .innerJoin(mistriProfiles, eq(mistriAccounts.id, mistriProfiles.mistriId))
            .innerJoin(services, eq(mistriProfiles.serviceId, services.id))
            .where(and(eq(mistriAccounts.id, mistriId), eq(mistriAccounts.accountType, "mistri")))
            .limit(1);

        if (!mistri) {
            return res.status(400).json({ success: false, message: "Invalid mistri" });
        }
        if (mistri.approvalStatus !== "approved") {
            return res.status(400).json({ success: false, message: "Mistri is not approved yet" });
        }

        const prevMistriId = reqRow.assignedMistriId;

        if (prevMistriId !== mistriId) {
            const activeJobs = await db
                .select({ id: serviceRequests.id })
                .from(serviceRequests)
                .where(and(
                    eq(serviceRequests.assignedMistriId, mistriId),
                    eq(serviceRequests.status, "assigned"),
                    ne(serviceRequests.id, id)
                ));
            if (activeJobs.length > 0 && !force) {
                return res.status(409).json({
                    success: false,
                    code: "MISTRI_BUSY",
                    message: `${mistri.fullName} already has an active job. Assign anyway?`,
                    activeJobId: activeJobs[0].id,
                });
            }
        }

        const [updated] = await db
            .update(serviceRequests)
            .set({
                status: "assigned",
                assignedMistriId: mistriId,
                assignedAt: reqRow.assignedAt ?? new Date(),
            })
            .where(eq(serviceRequests.id, id))
            .returning();

        stopDispatch(id);

        await db.update(mistriProfiles)
            .set({ availabilityStatus: "unavailable", isAvailable: false })
            .where(eq(mistriProfiles.mistriId, mistriId));

        if (prevMistriId && prevMistriId !== mistriId) {
            await db.update(mistriProfiles)
                .set({ availabilityStatus: "available", isAvailable: true })
                .where(eq(mistriProfiles.mistriId, prevMistriId));
            await createNotification(
                prevMistriId,
                "Job reassigned",
                `An admin reassigned the ${reqRow.type} job at ${reqRow.address} to another mistri.`,
                "request_reassigned",
                id
            );
        }

        await createNotification(
            reqRow.customerId,
            "Service Request Assigned",
            `${mistri.fullName} has been assigned to your ${reqRow.type} service request.`,
            "request_accepted",
            id
        );

        const customer = await db.query.userAccounts.findFirst({ where: eq(userAccounts.id, reqRow.customerId) });
        const shouldSendSms = await shouldSendNotification(reqRow.customerId, "request_accepted", "sms");
        if (customer?.phoneNumber && shouldSendSms) {
            try {
                await sendSms(
                    customer.phoneNumber,
                    `SERVEX: ${mistri.fullName} has been assigned to your ${reqRow.type} service request at ${reqRow.address}. Contact: ${mistri.phoneNumber || "N/A"}`,
                    "service_accepted"
                );
            } catch (smsError) {
                console.error("Failed to send assignment SMS:", smsError);
            }
        }

        await createNotification(
            mistriId,
            "New Job Assigned",
            `You've been assigned a ${reqRow.type} job at ${reqRow.address} by the ServeX team.`,
            "new_request",
            id
        );

        await createAuditLog({
            entityType: "service_request",
            entityId: id,
            action: "admin_assign",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            oldValue: { status: reqRow.status, assignedMistriId: prevMistriId },
            newValue: { status: "assigned", assignedMistriId: mistriId },
            metadata: { assignedBy: "admin", forced: force, reassigned: !!(prevMistriId && prevMistriId !== mistriId) },
        });

        return res.json({ success: true, message: "Mistri assigned", request: updated });
    } catch (error) {
        console.error("Error assigning service request:", error);
        return res.status(500).json({ success: false, message: "Failed to assign mistri" });
    }
};

// ============================================
// GET AUDIT LOGS
// ============================================

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

// ============================================
// GET SMS STATS
// ============================================

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

// ============================================
// GET SMS LOGS
// ============================================

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