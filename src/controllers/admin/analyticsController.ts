// backend/src/controllers/admin/analyticsController.ts
import { Request, Response } from "express";
import { db } from "../../db";
import { 
    serviceRequests, 
    userAccounts,        // ✅ Changed from users (customers)
    mistriAccounts,      // ✅ Changed from users (mistris)
    mistriProfiles 
} from "../../db/schema";
import { and, gte, lte, eq, count, sql, desc } from "drizzle-orm";

function strParam(v: unknown): string {
    return Array.isArray(v) ? String(v[0]) : String(v ?? "");
}

function parseDate(v: unknown): Date | null {
    const s = strParam(v);
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

function num(v: unknown): number {
    return parseFloat(String(v ?? "0")) || 0;
}

const DAY = 86_400_000;

// ============================================
// GET ANALYTICS
// ============================================

export const getAnalytics = async (req: Request, res: Response) => {
    try {
        const to = parseDate(req.query.to) ?? new Date();
        const from = parseDate(req.query.from) ?? new Date(to.getTime() - 30 * DAY);
        const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
        const unit = spanDays <= 92 ? "day" : "month";
        const fmt = unit === "day" ? "YYYY-MM-DD" : "YYYY-MM";
        const step = unit === "day" ? "1 day" : "1 month";

        const inRange = and(gte(serviceRequests.createdAt, from), lte(serviceRequests.createdAt, to));

        const [
            [statusAgg],
            [timingAgg],
            [revenueAgg],
            [custAgg],
            [provAgg],
            repeatRows,
            byServiceRows,
            trendRows,
            hourRows,
            weekdayRows,
            topProviderRows,
        ] = await Promise.all([
            // Status aggregation
            db.select({
                total: count(),
                completed: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'completed')`,
                canceled: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'canceled')`,
                pending: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'pending')`,
                assigned: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'assigned')`,
                assignedEver: sql<string>`count(*) FILTER (WHERE ${serviceRequests.assignedAt} IS NOT NULL)`,
            }).from(serviceRequests).where(inRange),

            // Timing aggregation
            db.select({
                acceptSec: sql<string>`avg(EXTRACT(EPOCH FROM (${serviceRequests.assignedAt} - ${serviceRequests.createdAt}))) FILTER (WHERE ${serviceRequests.assignedAt} IS NOT NULL)`,
                durSec: sql<string>`avg(EXTRACT(EPOCH FROM (${serviceRequests.completedAt} - ${serviceRequests.startedWorkAt}))) FILTER (WHERE ${serviceRequests.completedAt} IS NOT NULL AND ${serviceRequests.startedWorkAt} IS NOT NULL)`,
            }).from(serviceRequests).where(inRange),

            // Revenue aggregation
            db.select({
                revenue: sql<string>`COALESCE(SUM(${serviceRequests.paymentAmount}) FILTER (WHERE ${serviceRequests.status} = 'completed'), 0)`,
                completedPaid: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'completed' AND ${serviceRequests.paidAt} IS NOT NULL)`,
            }).from(serviceRequests).where(inRange),

            // ✅ New customers from userAccounts
            db.select({ c: count() })
                .from(userAccounts)
                .where(and(
                    eq(userAccounts.accountType, "user"),
                    gte(userAccounts.createdAt, from),
                    lte(userAccounts.createdAt, to)
                )),

            // ✅ New providers from mistriAccounts
            db.select({ c: count() })
                .from(mistriAccounts)
                .where(and(
                    eq(mistriAccounts.accountType, "mistri"),
                    gte(mistriAccounts.createdAt, from),
                    lte(mistriAccounts.createdAt, to)
                )),

            // Repeat customers: of customers active in range, how many are lifetime repeaters (>1 request)
            db.execute(sql`
                SELECT count(*) FILTER (WHERE total > 1) AS repeat, count(*) AS active
                FROM (
                    SELECT customer_id, count(*) AS total
                    FROM service_requests
                    WHERE customer_id IN (
                        SELECT DISTINCT customer_id FROM service_requests
                        WHERE created_at BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz
                    )
                    GROUP BY customer_id
                ) t
            `),

            // By service type
            db.select({
                type: serviceRequests.type,
                requests: count(),
                completed: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'completed')`,
                revenue: sql<string>`COALESCE(SUM(${serviceRequests.paymentAmount}) FILTER (WHERE ${serviceRequests.status} = 'completed'), 0)`,
            }).from(serviceRequests).where(inRange).groupBy(serviceRequests.type),

            // Trend data
            db.execute(sql`
                WITH buckets AS (
                    SELECT to_char(d, ${fmt}) AS b
                    FROM generate_series(
                        date_trunc(${unit}, ${from.toISOString()}::timestamptz AT TIME ZONE 'Asia/Kathmandu'),
                        date_trunc(${unit}, ${to.toISOString()}::timestamptz AT TIME ZONE 'Asia/Kathmandu'),
                        ${step}::interval
                    ) d
                ),
                cr AS (
                    SELECT to_char(created_at AT TIME ZONE 'Asia/Kathmandu', ${fmt}) AS b, count(*) AS c
                    FROM service_requests WHERE created_at BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz GROUP BY 1
                ),
                cp AS (
                    SELECT to_char(completed_at AT TIME ZONE 'Asia/Kathmandu', ${fmt}) AS b, count(*) AS c
                    FROM service_requests WHERE status = 'completed' AND completed_at BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz GROUP BY 1
                )
                SELECT buckets.b AS bucket, COALESCE(cr.c, 0)::int AS created, COALESCE(cp.c, 0)::int AS completed
                FROM buckets LEFT JOIN cr ON cr.b = buckets.b LEFT JOIN cp ON cp.b = buckets.b
                ORDER BY buckets.b
            `),

            // Hourly distribution
            db.execute(sql`
                SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kathmandu')::int AS hour, count(*)::int AS c
                FROM service_requests WHERE created_at BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz GROUP BY 1
            `),

            // Weekday distribution
            db.execute(sql`
                SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Kathmandu')::int AS dow, count(*)::int AS c
                FROM service_requests WHERE created_at BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz GROUP BY 1
            `),

            // ✅ Top providers using mistriAccounts
            db.select({
                mistriId: serviceRequests.assignedMistriId,
                name: mistriAccounts.fullName,
                serviceId: mistriProfiles.serviceId,
                completed: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'completed')`,
                revenue: sql<string>`COALESCE(SUM(${serviceRequests.paymentAmount}) FILTER (WHERE ${serviceRequests.status} = 'completed'), 0)`,
                rating: mistriProfiles.averageRating,
            })
            .from(serviceRequests)
            .innerJoin(mistriAccounts, eq(mistriAccounts.id, serviceRequests.assignedMistriId))
            .leftJoin(mistriProfiles, eq(mistriProfiles.mistriId, serviceRequests.assignedMistriId))
            .where(inRange)
            .groupBy(
                serviceRequests.assignedMistriId, 
                mistriAccounts.fullName, 
                mistriProfiles.serviceId, 
                mistriProfiles.averageRating
            )
            .orderBy(desc(sql`count(*) FILTER (WHERE ${serviceRequests.status} = 'completed')`))
            .limit(6),
        ]);

        // ============================================
        // PROCESS RESULTS
        // ============================================

        const total = num(statusAgg?.total);
        const completed = num(statusAgg?.completed);
        const canceled = num(statusAgg?.canceled);
        const assignedEver = num(statusAgg?.assignedEver);
        const revenue = num(revenueAgg?.revenue);

        const repeatRow = (repeatRows as unknown as Array<{ repeat: string; active: string }>)[0];
        const repeatActive = num(repeatRow?.active);
        const repeatCount = num(repeatRow?.repeat);

        const trend = {
            unit,
            series: (trendRows as unknown as Array<{ bucket: string; created: number; completed: number }>)
                .map((r) => ({ bucket: r.bucket, created: Number(r.created), completed: Number(r.completed) })),
        };

        const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
        (hourRows as unknown as Array<{ hour: number; c: number }>).forEach((r) => {
            if (r.hour >= 0 && r.hour < 24) hours[r.hour].count = Number(r.c);
        });

        const weekday = Array.from({ length: 7 }, (_, d) => ({ dow: d, count: 0 }));
        (weekdayRows as unknown as Array<{ dow: number; c: number }>).forEach((r) => {
            if (r.dow >= 0 && r.dow < 7) weekday[r.dow].count = Number(r.c);
        });

        const byService = (byServiceRows as Array<{ type: string; requests: number; completed: string; revenue: string }>)
            .map((r) => ({
                type: r.type,
                requests: Number(r.requests),
                completed: num(r.completed),
                revenue: num(r.revenue),
            }))
            .sort((a, b) => b.requests - a.requests);

        const topProviders = (topProviderRows as Array<{ 
            mistriId: string; 
            name: string; 
            serviceId: number | null; 
            completed: string; 
            revenue: string; 
            rating: string | null 
        }>)
            .map((r) => ({
                mistriId: r.mistriId,
                name: r.name,
                serviceId: r.serviceId,
                completed: num(r.completed),
                revenue: num(r.revenue),
                rating: r.rating ? num(r.rating) : null,
            }));

        // ============================================
        // RESPONSE
        // ============================================

        return res.json({
            success: true,
            analytics: {
                range: { from: from.toISOString(), to: to.toISOString(), unit },
                kpis: {
                    totalRequests: total,
                    completed,
                    canceled,
                    completionRate: total ? (completed / total) * 100 : 0,
                    cancellationRate: total ? (canceled / total) * 100 : 0,
                    avgAcceptMinutes: timingAgg?.acceptSec ? num(timingAgg.acceptSec) / 60 : 0,
                    avgJobDurationMinutes: timingAgg?.durSec ? num(timingAgg.durSec) / 60 : 0,
                    revenue,
                    avgJobValue: completed ? revenue / completed : 0,
                    newCustomers: num(custAgg?.c),
                    newProviders: num(provAgg?.c),
                    repeatCustomerRate: repeatActive ? (repeatCount / repeatActive) * 100 : 0,
                },
                funnel: { 
                    created: total, 
                    assigned: assignedEver, 
                    completed 
                },
                trend,
                byService,
                hours,
                weekday,
                topProviders,
            },
        });
    } catch (error) {
        console.error("Error building analytics:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Failed to build analytics" 
        });
    }
};

// ============================================
// GET ANALYTICS SUMMARY (Quick KPIs)
// ============================================

export const getAnalyticsSummary = async (req: Request, res: Response) => {
    try {
        const days = parseInt(req.query.days as string) || 30;
        const from = new Date(Date.now() - days * DAY);
        const to = new Date();

        const [
            totalRequests,
            completedRequests,
            totalRevenue,
            activeCustomers,
            activeMistris,
            avgRating,
        ] = await Promise.all([
            db.select({ count: count() }).from(serviceRequests),
            db.select({ count: count() }).from(serviceRequests).where(eq(serviceRequests.status, "completed")),
            db.select({ total: sql<string>`COALESCE(SUM(${serviceRequests.paymentAmount}), 0)` })
                .from(serviceRequests)
                .where(eq(serviceRequests.status, "completed")),
            db.select({ count: count() })
                .from(userAccounts)
                .where(and(
                    eq(userAccounts.accountType, "user"),
                    gte(userAccounts.createdAt, from)
                )),
            db.select({ count: count() })
                .from(mistriAccounts)
                .where(and(
                    eq(mistriAccounts.accountType, "mistri"),
                    gte(mistriAccounts.createdAt, from)
                )),
            db.select({ average: sql<string>`COALESCE(AVG(${mistriProfiles.averageRating}), 0)` })
                .from(mistriProfiles)
                .where(eq(mistriProfiles.approvalStatus, "approved")),
        ]);

        return res.json({
            success: true,
            summary: {
                totalRequests: Number(totalRequests[0]?.count || 0),
                completedRequests: Number(completedRequests[0]?.count || 0),
                completionRate: totalRequests[0]?.count 
                    ? (Number(completedRequests[0]?.count || 0) / Number(totalRequests[0]?.count || 0)) * 100 
                    : 0,
                totalRevenue: parseFloat(totalRevenue[0]?.total || "0"),
                activeCustomers: Number(activeCustomers[0]?.count || 0),
                activeMistris: Number(activeMistris[0]?.count || 0),
                averageMistriRating: parseFloat(avgRating[0]?.average || "0"),
                period: {
                    from: from.toISOString(),
                    to: to.toISOString(),
                    days,
                }
            }
        });
    } catch (error) {
        console.error("Error fetching analytics summary:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch analytics summary"
        });
    }
};

// ============================================
// GET CUSTOMER ANALYTICS
// ============================================

export const getCustomerAnalytics = async (req: Request, res: Response) => {
    try {
        const customerId = req.params.customerId;

        if (!customerId) {
            return res.status(400).json({
                success: false,
                message: "Customer ID is required"
            });
        }

        // Get customer from userAccounts
        const customer = await db.query.userAccounts.findFirst({
            where: eq(userAccounts.id, customerId)
        });

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: "Customer not found"
            });
        }

        // Get order history
        const orders = await db
            .select({
                id: serviceRequests.id,
                type: serviceRequests.type,
                status: serviceRequests.status,
                address: serviceRequests.address,
                paymentAmount: serviceRequests.paymentAmount,
                createdAt: serviceRequests.createdAt,
                completedAt: serviceRequests.completedAt,
            })
            .from(serviceRequests)
            .where(eq(serviceRequests.customerId, customerId))
            .orderBy(desc(serviceRequests.createdAt))
            .limit(50);

        // Get stats
        const [stats] = await db
            .select({
                total: count(),
                completed: sql<number>`count(*) filter (where ${serviceRequests.status} = 'completed')`,
                canceled: sql<number>`count(*) filter (where ${serviceRequests.status} = 'canceled')`,
                totalSpent: sql<string>`coalesce(sum(${serviceRequests.paymentAmount}) filter (where ${serviceRequests.status} = 'completed'), 0)`,
                avgSpent: sql<string>`coalesce(avg(${serviceRequests.paymentAmount}) filter (where ${serviceRequests.status} = 'completed'), 0)`,
                lastOrderAt: sql<string | null>`max(${serviceRequests.createdAt})`,
            })
            .from(serviceRequests)
            .where(eq(serviceRequests.customerId, customerId));

        return res.json({
            success: true,
            customer: {
                id: customer.id,
                fullName: customer.fullName,
                phoneNumber: customer.phoneNumber,
                createdAt: customer.createdAt,
                isActive: customer.isActive,
                isVerified: customer.isVerified,
            },
            stats: {
                totalOrders: Number(stats?.total || 0),
                completedOrders: Number(stats?.completed || 0),
                canceledOrders: Number(stats?.canceled || 0),
                totalSpent: parseFloat(stats?.totalSpent || "0"),
                averageSpent: parseFloat(stats?.avgSpent || "0"),
                lastOrderAt: stats?.lastOrderAt || null,
            },
            recentOrders: orders.slice(0, 10),
        });
    } catch (error) {
        console.error("Error fetching customer analytics:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch customer analytics"
        });
    }
};

// ============================================
// GET MISTRI ANALYTICS
// ============================================

export const getMistriAnalytics = async (req: Request, res: Response) => {
    try {
        const mistriId = req.params.mistriId;

        if (!mistriId) {
            return res.status(400).json({
                success: false,
                message: "Mistri ID is required"
            });
        }

        // Get mistri from mistriAccounts
        const mistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.id, mistriId)
        });

        if (!mistri) {
            return res.status(404).json({
                success: false,
                message: "Mistri not found"
            });
        }

        // Get mistri profile
        const profile = await db.query.mistriProfiles.findFirst({
            where: eq(mistriProfiles.mistriId, mistriId)
        });

        // Get job history
        const jobs = await db
            .select({
                id: serviceRequests.id,
                type: serviceRequests.type,
                status: serviceRequests.status,
                address: serviceRequests.address,
                paymentAmount: serviceRequests.paymentAmount,
                createdAt: serviceRequests.createdAt,
                assignedAt: serviceRequests.assignedAt,
                completedAt: serviceRequests.completedAt,
                customerName: userAccounts.fullName,
            })
            .from(serviceRequests)
            .innerJoin(userAccounts, eq(serviceRequests.customerId, userAccounts.id))
            .where(eq(serviceRequests.assignedMistriId, mistriId))
            .orderBy(desc(serviceRequests.createdAt))
            .limit(50);

        // Get stats
        const [stats] = await db
            .select({
                total: count(),
                completed: sql<number>`count(*) filter (where ${serviceRequests.status} = 'completed')`,
                canceled: sql<number>`count(*) filter (where ${serviceRequests.status} = 'canceled')`,
                totalEarned: sql<string>`coalesce(sum(${serviceRequests.paymentAmount}) filter (where ${serviceRequests.status} = 'completed'), 0)`,
                avgEarned: sql<string>`coalesce(avg(${serviceRequests.paymentAmount}) filter (where ${serviceRequests.status} = 'completed'), 0)`,
                avgRating: sql<string>`coalesce(avg(${mistriProfiles.averageRating}), 0)`,
            })
            .from(serviceRequests)
            .where(eq(serviceRequests.assignedMistriId, mistriId));

        return res.json({
            success: true,
            mistri: {
                id: mistri.id,
                fullName: mistri.fullName,
                phoneNumber: mistri.phoneNumber,
                createdAt: mistri.createdAt,
                isActive: mistri.isActive,
                isVerified: mistri.isVerified,
                approvalStatus: profile?.approvalStatus || null,
                isAvailable: profile?.isAvailable || false,
                averageRating: parseFloat(profile?.averageRating || "0"),
                jobsCompleted: profile?.jobsCompleted || 0,
            },
            stats: {
                totalJobs: Number(stats?.total || 0),
                completedJobs: Number(stats?.completed || 0),
                canceledJobs: Number(stats?.canceled || 0),
                totalEarned: parseFloat(stats?.totalEarned || "0"),
                averageEarned: parseFloat(stats?.avgEarned || "0"),
                averageRating: parseFloat(stats?.avgRating || "0"),
                completionRate: stats?.total ? (Number(stats?.completed || 0) / Number(stats?.total || 0)) * 100 : 0,
            },
            recentJobs: jobs.slice(0, 10),
        });
    } catch (error) {
        console.error("Error fetching mistri analytics:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch mistri analytics"
        });
    }
};