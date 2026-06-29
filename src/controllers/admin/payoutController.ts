import { Request, Response } from "express";
import { db } from "../../db";
import { 
    users,              // ✅ Unified users table (customers, mistris, admins)
    mistriProfiles, 
    serviceRequests, 
    payouts, 
    appSettings 
} from "../../db/schema";
import {
    and,
    eq,
    desc,
    sum,
    count,
    sql,
    isNull,
    isNotNull,
    gte,
    lte,
    SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createAuditLog } from "../../services/auditLog";
import { z } from "zod";

const COMMISSION_KEY = "commission_rate";
const DEFAULT_COMMISSION_RATE = 15; // %

function strParam(v: unknown): string {
    return Array.isArray(v) ? String(v[0]) : String(v ?? "");
}
function toNum(v: unknown): number {
    return parseFloat(String(v ?? "0")) || 0;
}
function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

async function getCommissionRate(): Promise<number> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, COMMISSION_KEY)).limit(1);
    const v = row ? parseFloat(row.value) : NaN;
    return isFinite(v) && v >= 0 && v <= 100 ? v : DEFAULT_COMMISSION_RATE;
}

// Eligible = completed, customer-paid (mistri holds the cash), not yet in a settlement.
function eligibleConds(): SQL[] {
    return [
        eq(serviceRequests.status, "completed"),
        isNotNull(serviceRequests.paidAt),
        isNull(serviceRequests.payoutId),
        isNotNull(serviceRequests.assignedMistriId),
    ];
}

// GET /api/admin/payouts/report — platform commission KPIs + 12-month trend.
export const getPayoutReport = async (req: Request, res: Response) => {
    try {
        const from = (() => { const d = new Date(strParam(req.query.from)); return isNaN(d.getTime()) ? null : d; })();
        const to = (() => { const d = new Date(strParam(req.query.to)); return isNaN(d.getTime()) ? null : d; })();

        const rate = await getCommissionRate();

        const grossConds: SQL[] = [eq(serviceRequests.status, "completed"), isNotNull(serviceRequests.paidAt)];
        if (from) grossConds.push(gte(serviceRequests.paidAt, from));
        if (to) grossConds.push(lte(serviceRequests.paidAt, to));

        const [
            [grossRow],
            [unsettledRow],
            [collectedRow],
            [pendingRow],
            [dueProvidersRow],
            trendRows,
        ] = await Promise.all([
            db.select({ gross: sum(serviceRequests.paymentAmount), jobs: count() })
                .from(serviceRequests).where(and(...grossConds)),
            db.select({ gross: sum(serviceRequests.paymentAmount), providers: sql<string>`count(distinct ${serviceRequests.assignedMistriId})` })
                .from(serviceRequests).where(and(...eligibleConds())),
            db.select({ total: sum(payouts.commissionAmount) }).from(payouts).where(eq(payouts.status, "collected")),
            db.select({ total: sum(payouts.commissionAmount) }).from(payouts).where(eq(payouts.status, "pending")),
            db.select({ n: sql<string>`count(distinct ${serviceRequests.assignedMistriId})` })
                .from(serviceRequests).where(and(...eligibleConds())),
            db.execute(sql`
                WITH months AS (
                    SELECT to_char(d, 'YYYY-MM') AS month
                    FROM generate_series(
                        date_trunc('month', (now() AT TIME ZONE 'Asia/Kathmandu')) - interval '11 months',
                        date_trunc('month', (now() AT TIME ZONE 'Asia/Kathmandu')),
                        interval '1 month'
                    ) AS d
                ),
                g AS (
                    SELECT to_char(paid_at AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM') AS month, SUM(payment_amount) AS total
                    FROM service_requests WHERE status='completed' AND paid_at IS NOT NULL GROUP BY 1
                ),
                c AS (
                    SELECT to_char(settled_at AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM') AS month, SUM(commission_amount) AS total
                    FROM payouts WHERE status='collected' AND settled_at IS NOT NULL GROUP BY 1
                )
                SELECT m.month, COALESCE(g.total,0)::text AS gross, COALESCE(c.total,0)::text AS collected
                FROM months m LEFT JOIN g ON g.month=m.month LEFT JOIN c ON c.month=m.month
                ORDER BY m.month
            `),
        ]);

        const grossPaid = toNum(grossRow?.gross);
        const unsettledGross = toNum(unsettledRow?.gross);
        const unsettledCommission = round2((unsettledGross * rate) / 100);
        const commissionCollected = toNum(collectedRow?.total);
        const commissionPending = toNum(pendingRow?.total);
        const outstandingCommission = round2(commissionPending + unsettledCommission);

        const monthlyTrend = (trendRows as unknown as Array<{ month: string; gross: string; collected: string }>)
            .map((r) => ({ month: r.month, gross: toNum(r.gross), collected: toNum(r.collected) }));

        return res.json({
            success: true,
            report: {
                commissionRate: rate,
                grossPaid,
                paidJobs: Number(grossRow?.jobs ?? 0),
                commissionCollected,
                commissionPending,
                unsettledGross,
                unsettledCommission,
                outstandingCommission,
                providersWithDues: Number(dueProvidersRow?.n ?? 0),
                monthlyTrend,
            },
        });
    } catch (error) {
        console.error("Error building payout report:", error);
        return res.status(500).json({ success: false, message: "Failed to build payout report" });
    }
};

// GET /api/admin/payouts/providers — per-provider unsettled dues, ready to settle.
export const getPayoutProviders = async (_req: Request, res: Response) => {
    try {
        const rate = await getCommissionRate();

        // ✅ Use unified users table with accountType: "mistri"
        const rows = await db
            .select({
                mistriId: serviceRequests.assignedMistriId,
                jobs: count(),
                gross: sum(serviceRequests.paymentAmount),
                lastPaidAt: sql<string>`max(${serviceRequests.paidAt})`,
                fullName: users.fullName,                    // ✅ Changed from mistriAccounts to users
                phoneNumber: users.phoneNumber,              // ✅ Changed from mistriAccounts to users
                serviceId: mistriProfiles.serviceId,
                profilePhotoUrl: mistriProfiles.profilePhotoUrl,
            })
            .from(serviceRequests)
            .innerJoin(users, and(
                eq(users.id, serviceRequests.assignedMistriId),
                eq(users.accountType, "mistri")              // ✅ Only mistris
            ))
            .leftJoin(mistriProfiles, eq(mistriProfiles.mistriId, serviceRequests.assignedMistriId))
            .where(and(...eligibleConds()))
            .groupBy(
                serviceRequests.assignedMistriId,
                users.fullName,
                users.phoneNumber,
                mistriProfiles.serviceId,
                mistriProfiles.profilePhotoUrl
            )
            .orderBy(desc(sum(serviceRequests.paymentAmount)));

        const providers = rows.map((r) => {
            const gross = toNum(r.gross);
            const commission = round2((gross * rate) / 100);
            return {
                mistriId: r.mistriId,
                fullName: r.fullName,
                phoneNumber: r.phoneNumber,
                serviceId: r.serviceId,
                profilePhotoUrl: r.profilePhotoUrl,
                jobs: Number(r.jobs ?? 0),
                gross,
                commission,
                net: round2(gross - commission),
                lastPaidAt: r.lastPaidAt,
            };
        });

        return res.json({ success: true, commissionRate: rate, providers });
    } catch (error) {
        console.error("Error fetching payout providers:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch providers" });
    }
};

// GET /api/admin/payouts — settlement history.
export const getPayouts = async (req: Request, res: Response) => {
    try {
        const status = strParam(req.query.status);
        const mistriId = strParam(req.query.mistriId);
        const page = Math.max(1, parseInt(strParam(req.query.page) || "1"));
        const limit = Math.min(100, Math.max(1, parseInt(strParam(req.query.limit) || "25")));
        const offset = (page - 1) * limit;

        const conds: SQL[] = [];
        if (status === "pending" || status === "collected") conds.push(eq(payouts.status, status));
        if (mistriId) conds.push(eq(payouts.mistriId, mistriId));
        const where = conds.length ? and(...conds) : undefined;

        // ✅ Use unified users table alias
        const mistri = alias(users, "mistri_user");
        const [rows, [agg]] = await Promise.all([
            db.select({
                id: payouts.id,
                mistriId: payouts.mistriId,
                mistriName: mistri.fullName,
                mistriPhone: mistri.phoneNumber,
                jobsCount: payouts.jobsCount,
                grossAmount: payouts.grossAmount,
                commissionRate: payouts.commissionRate,
                commissionAmount: payouts.commissionAmount,
                netAmount: payouts.netAmount,
                status: payouts.status,
                note: payouts.note,
                periodEnd: payouts.periodEnd,
                settledAt: payouts.settledAt,
                createdAt: payouts.createdAt,
            })
                .from(payouts)
                .leftJoin(mistri, and(
                    eq(payouts.mistriId, mistri.id),
                    eq(mistri.accountType, "mistri")
                ))
                .where(where)
                .orderBy(desc(payouts.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ total: count() }).from(payouts).where(where),
        ]);

        return res.json({ success: true, payouts: rows, total: Number(agg?.total ?? 0), page, limit });
    } catch (error) {
        console.error("Error fetching payouts:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch payouts" });
    }
};

const settleSchema = z.object({
    mistriId: z.string().uuid(),
    note: z.string().trim().max(1000).optional().nullable(),
});

// POST /api/admin/payouts/settle — batch a provider's unsettled jobs into a settlement.
export const settleProvider = async (req: Request, res: Response) => {
    try {
        const parsed = settleSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid data" });
        }
        const { mistriId, note } = parsed.data;
        const rate = await getCommissionRate();
        const adminId = (req as any).user?.userId;

        // ✅ Use unified users table with accountType: "mistri"
        const [provider] = await db
            .select()
            .from(users)
            .where(and(eq(users.id, mistriId), eq(users.accountType, "mistri")))
            .limit(1);
        
        if (!provider) {
            return res.status(404).json({ success: false, message: "Provider not found" });
        }

        const NO_JOBS = "NO_ELIGIBLE_JOBS";
        let payoutId = "";

        try {
            await db.transaction(async (tx) => {
                // 1) Create the settlement shell so jobs can FK to it.
                const [shell] = await tx.insert(payouts).values({
                    mistriId,
                    jobsCount: 0,
                    grossAmount: "0",
                    commissionRate: String(rate),
                    commissionAmount: "0",
                    netAmount: "0",
                    status: "pending",
                    note: note?.trim() || null,
                    createdBy: adminId,
                }).returning({ id: payouts.id });
                payoutId = shell.id;

                // 2) Atomically claim this provider's eligible jobs (race-safe).
                const claimed = await tx
                    .update(serviceRequests)
                    .set({ payoutId })
                    .where(and(eq(serviceRequests.assignedMistriId, mistriId), ...eligibleConds()))
                    .returning({ amount: serviceRequests.paymentAmount, paidAt: serviceRequests.paidAt });

                if (claimed.length === 0) {
                    throw new Error(NO_JOBS);
                }

                const gross = round2(claimed.reduce((s, j) => s + toNum(j.amount), 0));
                const commission = round2((gross * rate) / 100);
                const net = round2(gross - commission);
                const periodEnd = claimed
                    .map((j) => j.paidAt)
                    .filter(Boolean)
                    .sort()
                    .pop() as Date | null;

                // 3) Backfill the real totals.
                await tx.update(payouts).set({
                    jobsCount: claimed.length,
                    grossAmount: String(gross),
                    commissionAmount: String(commission),
                    netAmount: String(net),
                    periodEnd: periodEnd ?? null,
                }).where(eq(payouts.id, payoutId));
            });
        } catch (txErr: any) {
            if (txErr?.message === NO_JOBS) {
                return res.status(400).json({ success: false, message: "No unsettled jobs for this provider" });
            }
            throw txErr;
        }

        const [payout] = await db.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1);

        await createAuditLog({
            entityType: "payout",
            entityId: payoutId,
            action: "settle_create",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            newValue: { mistriId, jobsCount: payout?.jobsCount, commissionAmount: payout?.commissionAmount, commissionRate: rate },
        });

        return res.status(201).json({ success: true, payout });
    } catch (error) {
        console.error("Error settling provider:", error);
        return res.status(500).json({ success: false, message: "Failed to settle provider" });
    }
};

// PATCH /api/admin/payouts/:id/collect — mark commission as collected.
export const collectPayout = async (req: Request, res: Response) => {
    try {
        const id = strParam(req.params.id);
        const [existing] = await db.select().from(payouts).where(eq(payouts.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Settlement not found" });
        if (existing.status === "collected") {
            return res.status(400).json({ success: false, message: "Already collected" });
        }

        const [updated] = await db.update(payouts)
            .set({ status: "collected", settledAt: new Date() })
            .where(eq(payouts.id, id))
            .returning();

        await createAuditLog({
            entityType: "payout",
            entityId: id,
            action: "collect",
            performedBy: (req as any).user?.userId || 'system',
            performedByRole: "admin",
            oldValue: { status: existing.status },
            newValue: { status: "collected" },
        });

        return res.json({ success: true, payout: updated });
    } catch (error) {
        console.error("Error collecting payout:", error);
        return res.status(500).json({ success: false, message: "Failed to collect payout" });
    }
};

// PATCH /api/admin/payouts/:id/revert — undo a pending settlement (releases its jobs).
export const revertPayout = async (req: Request, res: Response) => {
    try {
        const id = strParam(req.params.id);
        const [existing] = await db.select().from(payouts).where(eq(payouts.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Settlement not found" });
        if (existing.status === "collected") {
            return res.status(400).json({ success: false, message: "Collected settlements can't be reverted" });
        }

        await db.transaction(async (tx) => {
            await tx.update(serviceRequests).set({ payoutId: null }).where(eq(serviceRequests.payoutId, id));
            await tx.delete(payouts).where(eq(payouts.id, id));
        });

        await createAuditLog({
            entityType: "payout",
            entityId: id,
            action: "revert",
            performedBy: (req as any).user?.userId || 'system',
            performedByRole: "admin",
            oldValue: { mistriId: existing.mistriId, jobsCount: existing.jobsCount, commissionAmount: existing.commissionAmount },
        });

        return res.json({ success: true, message: "Settlement reverted; jobs released" });
    } catch (error) {
        console.error("Error reverting payout:", error);
        return res.status(500).json({ success: false, message: "Failed to revert payout" });
    }
};

const configSchema = z.object({
    commissionRate: z.coerce.number().min(0).max(100),
});

// PATCH /api/admin/payouts/config — set the platform commission rate.
export const updatePayoutConfig = async (req: Request, res: Response) => {
    try {
        const parsed = configSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: "Commission rate must be between 0 and 100" });
        }
        const rate = round2(parsed.data.commissionRate);

        await db.insert(appSettings)
            .values({ key: COMMISSION_KEY, value: String(rate), updatedAt: new Date() })
            .onConflictDoUpdate({ target: appSettings.key, set: { value: String(rate), updatedAt: new Date() } });

        await createAuditLog({
            entityType: "app_settings",
            entityId: COMMISSION_KEY,
            action: "update",
            performedBy: (req as any).user?.userId || 'system',
            performedByRole: "admin",
            newValue: { commissionRate: rate },
        });

        return res.json({ success: true, commissionRate: rate });
    } catch (error) {
        console.error("Error updating payout config:", error);
        return res.status(500).json({ success: false, message: "Failed to update commission rate" });
    }
};