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
import { eq, and, desc, ilike, or, count, sql, sum, SQL, gte, lte, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createAuditLog } from "../services/auditLog";
import { sendSms } from "../services/sms";
import { createNotification } from "./notificationController";
import { shouldSendNotification } from "../services/notificationPreferences";
import { stopDispatch } from "../services/dispatch";
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

/** Customer CRM: profile + order history + lifetime value + addresses + flag. */
export const getCustomerDetail = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!user) return res.status(404).json({ success: false, message: "Customer not found" });

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

        // flag fields via raw SQL (not in Drizzle schema) so a missing column / unrun
        // migration can never break user queries.
        let isFlagged = false;
        let flagNote: string | null = null;
        try {
            const r = await db.execute(sql`SELECT is_flagged, flag_note FROM users WHERE id = ${id} LIMIT 1`);
            const row = (r as unknown as Array<{ is_flagged: boolean; flag_note: string | null }>)[0];
            isFlagged = !!row?.is_flagged;
            flagNote = row?.flag_note ?? null;
        } catch { /* columns may not exist yet */ }

        return res.json({
            success: true,
            customer: {
                id: user.id,
                fullName: user.fullName,
                phoneNumber: user.phoneNumber,
                role: user.role,
                isActive: user.isActive,
                isOnboarded: user.isOnboarded,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
                defaultLocation: user.defaultLocation,
                hasDeviceToken: !!user.deviceToken,
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

/** Flag / unflag a customer (risk or VIP marker) with an optional note. */
export const flagUser = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = req.user!.id;
        const schema = z.object({ isFlagged: z.boolean(), flagNote: z.string().max(500).optional().nullable() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" });
        }
        const { isFlagged, flagNote } = parsed.data;

        const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Customer not found" });

        let warning: string | undefined;
        try {
            await db.execute(sql`UPDATE users SET is_flagged = ${isFlagged}, flag_note = ${flagNote ?? null} WHERE id = ${id}`);
        } catch {
            warning = "Flag couldn't be saved — the customer-flag migration (0030) hasn't been run yet.";
        }

        await createAuditLog({
            entityType: "user",
            entityId: id,
            action: isFlagged ? "flag" : "unflag",
            performedBy: adminId,
            performedByRole: "admin",
            newValue: { isFlagged, flagNote: flagNote ?? null },
        });

        return res.json({ success: true, message: isFlagged ? "Customer flagged" : "Flag cleared", ...(warning ? { warning } : {}) });
    } catch (error) {
        console.error("Error flagging user:", error);
        return res.status(500).json({ success: false, message: "Failed to update flag" });
    }
};

/** Send a quick message (push + in-app notification) to a customer. */
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

        const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!user) return res.status(404).json({ success: false, message: "Customer not found" });

        await createNotification(id, title?.trim() || "Message from ServeX", message, "admin_message");

        return res.json({
            success: true,
            message: user.deviceToken ? "Message sent" : "Saved to their in-app inbox (no device registered for push)",
        });
    } catch (error) {
        console.error("Error messaging user:", error);
        return res.status(500).json({ success: false, message: "Failed to send message" });
    }
};

/** Global admin search (Cmd-K): customers + providers + recent requests. */
export const getGlobalSearch = async (req: Request, res: Response) => {
    try {
        const q = strParam(req.query.q).trim();
        if (q.length < 2) {
            return res.json({ success: true, customers: [], providers: [], requests: [] });
        }
        const like = `%${q}%`;

        const userRows = await db
            .select({ id: users.id, fullName: users.fullName, phoneNumber: users.phoneNumber, role: users.role })
            .from(users)
            .where(or(ilike(users.fullName, like), ilike(users.phoneNumber, like)))
            .orderBy(desc(users.createdAt))
            .limit(16);

        const customers = userRows.filter((u) => u.role === "user").slice(0, 6);
        const providers = userRows.filter((u) => u.role === "mistri").slice(0, 6);

        const cust = alias(users, "search_cust");
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

        return res.json({ success: true, customers, providers, requests });
    } catch (error) {
        console.error("Global search error:", error);
        return res.status(500).json({ success: false, message: "Search failed" });
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

// POST /api/admin/mistris — admin manually onboards a service provider (no app
// signup / OTP / ID-upload). Creates a fresh mistri, or upgrades an existing
// plain customer who has no provider profile yet.
export const createMistri = async (req: Request, res: Response) => {
    try {
        const parsed = createMistriSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid data" });
        }
        const v = parsed.data;
        const adminId = req.user!.id;

        // Service category must exist (1 = plumber, 2 = electrician, ...).
        const [svc] = await db.select().from(services).where(eq(services.id, v.serviceId)).limit(1);
        if (!svc) {
            return res.status(400).json({ success: false, message: "Invalid service category" });
        }

        // Phone uniqueness / upgrade rules.
        const [existingUser] = await db.select().from(users).where(eq(users.phoneNumber, v.phoneNumber)).limit(1);
        if (existingUser) {
            if (existingUser.role === "admin") {
                return res.status(409).json({ success: false, message: "This phone number belongs to an admin account" });
            }
            const [existingProfile] = await db.select().from(mistriProfiles).where(eq(mistriProfiles.userId, existingUser.id)).limit(1);
            if (existingProfile) {
                return res.status(409).json({ success: false, message: "This phone number is already registered as a ServeX provider" });
            }
        }

        const approvalStatus = v.approvalStatus ?? "approved";
        const isActive = v.isActive ?? true;
        const now = new Date();
        const mode: "created" | "upgraded" = existingUser ? "upgraded" : "created";
        let userId = "";

        await db.transaction(async (tx) => {
            if (existingUser) {
                await tx.update(users).set({
                    role: "mistri",
                    fullName: v.fullName,
                    isActive,
                    isOnboarded: true,
                    onboardingCompletedAt: existingUser.onboardingCompletedAt ?? now,
                    roleSelectedAt: existingUser.roleSelectedAt ?? now,
                    updatedAt: now,
                }).where(eq(users.id, existingUser.id));
                userId = existingUser.id;
            } else {
                const [u] = await tx.insert(users).values({
                    phoneNumber: v.phoneNumber,
                    fullName: v.fullName,
                    role: "mistri",
                    isActive,
                    isOnboarded: true,
                    onboardingCompletedAt: now,
                    roleSelectedAt: now,
                }).returning();
                userId = u.id;
            }

            await tx.insert(mistriProfiles).values({
                userId,
                serviceId: v.serviceId,
                bio: v.bio?.trim() || null,
                experienceLevel: v.experienceLevel ?? null,
                approvalStatus,
                isFeatured: v.isFeatured ?? false,
            });
        });

        await createAuditLog({
            entityType: "mistri_profile",
            entityId: userId,
            action: "admin_create",
            performedBy: adminId,
            performedByRole: "admin",
            newValue: { fullName: v.fullName, phoneNumber: v.phoneNumber, serviceId: v.serviceId, approvalStatus, mode },
        });

        // Optional welcome SMS — only when the account is active + approved.
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
            mode,
            userId,
            message: mode === "upgraded"
                ? "Existing user upgraded to a ServeX provider"
                : "ServeX provider created",
        });
    } catch (error: any) {
        if (error?.code === "23505") {
            return res.status(409).json({ success: false, message: "This phone number is already registered" });
        }
        console.error("Error creating mistri:", error);
        return res.status(500).json({ success: false, message: "Failed to create ServeX provider" });
    }
};

const createUserSchema = z.object({
    fullName: z.string().trim().min(2, "Name is too short").max(255),
    phoneNumber: z
        .string()
        .trim()
        .transform((s) => s.replace(/\s+/g, ""))
        .pipe(z.string().regex(/^\d{10}$/, "Phone number must be 10 digits")),
    isActive: z.boolean().optional(),
});

// POST /api/admin/users — admin manually registers a customer account.
export const createUser = async (req: Request, res: Response) => {
    try {
        const parsed = createUserSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid data" });
        }
        const v = parsed.data;

        const [existing] = await db.select().from(users).where(eq(users.phoneNumber, v.phoneNumber)).limit(1);
        if (existing) {
            return res.status(409).json({ success: false, message: "This phone number is already registered" });
        }

        const now = new Date();
        const [created] = await db.insert(users).values({
            phoneNumber: v.phoneNumber,
            fullName: v.fullName,
            role: "user",
            isActive: v.isActive ?? true,
            roleSelectedAt: now,
        }).returning();

        await createAuditLog({
            entityType: "user",
            entityId: created.id,
            action: "admin_create",
            performedBy: req.user!.id,
            performedByRole: "admin",
            newValue: { fullName: created.fullName, phoneNumber: created.phoneNumber, role: "user" },
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

export const getAdminServiceRequests = async (req: Request, res: Response) => {
    try {
        const status = strParam(req.query.status);
        const tab = strParam(req.query.tab); // "running" | "unpaid" — convenience filters
        const search = strParam(req.query.search);
        const pageNum = Math.max(1, parseInt(strParam(req.query.page) || "1"));
        const limitNum = Math.min(100, parseInt(strParam(req.query.limit) || "20"));
        const offset = (pageNum - 1) * limitNum;

        const mistriUser = alias(users, "mistri_user");

        const conditions: SQL[] = [];
        if (status && ["pending", "assigned", "canceled", "completed"].includes(status)) {
            conditions.push(eq(serviceRequests.status, status as "pending" | "assigned" | "canceled" | "completed"));
        }
        // "running" = assigned (a mistri is actively on it)
        if (tab === "running") {
            conditions.push(eq(serviceRequests.status, "assigned"));
        }
        // "unpaid" = money at risk (job done but not paid)
        if (tab === "unpaid") {
            conditions.push(eq(serviceRequests.unpaid, true));
        }
        if (search) {
            conditions.push(
                or(
                    ilike(users.fullName, `%${search}%`),
                    ilike(serviceRequests.address, `%${search}%`),
                    ilike(users.phoneNumber, `%${search}%`)
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
                customerName: users.fullName,
                customerPhone: users.phoneNumber,
                customerId: serviceRequests.customerId,
                assignedMistriId: serviceRequests.assignedMistriId,
                assignedMistriName: mistriUser.fullName,
                assignedMistriPhone: mistriUser.phoneNumber,
            })
                .from(serviceRequests)
                .innerJoin(users, eq(serviceRequests.customerId, users.id))
                .leftJoin(mistriUser, eq(serviceRequests.assignedMistriId, mistriUser.id))
                .where(whereClause)
                .orderBy(desc(serviceRequests.createdAt))
                .limit(limitNum)
                .offset(offset),
            db.select({ total: count() })
                .from(serviceRequests)
                .innerJoin(users, eq(serviceRequests.customerId, users.id))
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

/**
 * Per-tab counts for the service-request ops console (All / Pending /
 * Running / Completed / Canceled / Unpaid). One round-trip.
 */
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

/**
 * Approved mistris that can be manually assigned to a request. Optional
 * ?type=<serviceName> narrows to mistris of that trade. Ordered so the
 * best candidates (available, higher-rated, more experienced) surface first.
 */
export const getAssignableMistris = async (req: Request, res: Response) => {
    try {
        const type = strParam(req.query.type);
        const search = strParam(req.query.search);

        const conditions: SQL[] = [
            eq(users.role, "mistri"),
            eq(users.isActive, true),
            eq(mistriProfiles.approvalStatus, "approved"),
        ];
        if (type) {
            conditions.push(eq(services.serviceName, type));
        }
        if (search) {
            conditions.push(
                or(
                    ilike(users.fullName, `%${search}%`),
                    ilike(users.phoneNumber, `%${search}%`)
                )!
            );
        }

        const rows = await db
            .select({
                id: users.id,
                fullName: users.fullName,
                phoneNumber: users.phoneNumber,
                serviceName: services.serviceName,
                profilePhotoUrl: mistriProfiles.profilePhotoUrl,
                availabilityStatus: mistriProfiles.availabilityStatus,
                isAvailable: mistriProfiles.isAvailable,
                averageRating: mistriProfiles.averageRating,
                jobsCompleted: mistriProfiles.jobsCompleted,
                experienceLevel: mistriProfiles.experienceLevel,
            })
            .from(users)
            .innerJoin(mistriProfiles, eq(users.id, mistriProfiles.userId))
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

/**
 * Admin manually assigns (or reassigns) a mistri to a service request.
 * Mirrors the mistri-side accept flow: flips status -> assigned, stamps
 * assignedAt, marks the mistri busy, frees a previously-assigned mistri,
 * notifies both parties, and writes an audit log under the admin's id.
 * Blocks if the mistri already has an active job unless { force: true }.
 */
export const assignServiceRequest = async (req: Request, res: Response) => {
    try {
        const adminId = req.user?.id;
        const adminRole = req.user?.role;
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
                id: users.id,
                fullName: users.fullName,
                phoneNumber: users.phoneNumber,
                approvalStatus: mistriProfiles.approvalStatus,
                serviceName: services.serviceName,
            })
            .from(users)
            .innerJoin(mistriProfiles, eq(users.id, mistriProfiles.userId))
            .innerJoin(services, eq(mistriProfiles.serviceId, services.id))
            .where(and(eq(users.id, mistriId), eq(users.role, "mistri")))
            .limit(1);

        if (!mistri) {
            return res.status(400).json({ success: false, message: "Invalid mistri" });
        }
        if (mistri.approvalStatus !== "approved") {
            return res.status(400).json({ success: false, message: "Mistri is not approved yet" });
        }

        const prevMistriId = reqRow.assignedMistriId;

        // Guard the "one active job" invariant the mistri app relies on.
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

        // Admin took over — stop any in-flight sequential ping for this request.
        stopDispatch(id);

        // New mistri is now busy.
        await db.update(mistriProfiles)
            .set({ availabilityStatus: "unavailable", isAvailable: false })
            .where(eq(mistriProfiles.userId, mistriId));

        // Free the previously-assigned mistri (reassignment).
        if (prevMistriId && prevMistriId !== mistriId) {
            await db.update(mistriProfiles)
                .set({ availabilityStatus: "available", isAvailable: true })
                .where(eq(mistriProfiles.userId, prevMistriId));
            await createNotification(
                prevMistriId,
                "Job reassigned",
                `An admin reassigned the ${reqRow.type} job at ${reqRow.address} to another mistri.`,
                "request_reassigned",
                id
            );
        }

        // Notify the customer (same channel/type as a normal acceptance).
        await createNotification(
            reqRow.customerId,
            "Service Request Assigned",
            `${mistri.fullName} has been assigned to your ${reqRow.type} service request.`,
            "request_accepted",
            id
        );

        const customer = await db.query.users.findFirst({ where: eq(users.id, reqRow.customerId) });
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

        // Notify the assigned mistri (push).
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
            performedBy: adminId,
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
