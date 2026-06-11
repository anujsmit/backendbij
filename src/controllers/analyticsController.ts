import { Request, Response } from "express";
import { db } from "../db";
import { serviceRequests, users, mistriProfiles } from "../db/schema";
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

// GET /api/admin/analytics?from=&to= — operational + growth insights over a range.
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
            db.select({
                total: count(),
                completed: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'completed')`,
                canceled: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'canceled')`,
                pending: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'pending')`,
                assigned: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'assigned')`,
                assignedEver: sql<string>`count(*) FILTER (WHERE ${serviceRequests.assignedAt} IS NOT NULL)`,
            }).from(serviceRequests).where(inRange),

            db.select({
                acceptSec: sql<string>`avg(EXTRACT(EPOCH FROM (${serviceRequests.assignedAt} - ${serviceRequests.createdAt}))) FILTER (WHERE ${serviceRequests.assignedAt} IS NOT NULL)`,
                durSec: sql<string>`avg(EXTRACT(EPOCH FROM (${serviceRequests.completedAt} - ${serviceRequests.startedWorkAt}))) FILTER (WHERE ${serviceRequests.completedAt} IS NOT NULL AND ${serviceRequests.startedWorkAt} IS NOT NULL)`,
            }).from(serviceRequests).where(inRange),

            db.select({
                revenue: sql<string>`COALESCE(SUM(${serviceRequests.paymentAmount}) FILTER (WHERE ${serviceRequests.status} = 'completed'), 0)`,
                completedPaid: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'completed' AND ${serviceRequests.paidAt} IS NOT NULL)`,
            }).from(serviceRequests).where(inRange),

            db.select({ c: count() }).from(users)
                .where(and(eq(users.role, "user"), gte(users.createdAt, from), lte(users.createdAt, to))),

            db.select({ c: count() }).from(users)
                .where(and(eq(users.role, "mistri"), gte(users.createdAt, from), lte(users.createdAt, to))),

            // Repeat customers: of customers active in range, how many are lifetime repeaters (>1 request).
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

            db.select({
                type: serviceRequests.type,
                requests: count(),
                completed: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'completed')`,
                revenue: sql<string>`COALESCE(SUM(${serviceRequests.paymentAmount}) FILTER (WHERE ${serviceRequests.status} = 'completed'), 0)`,
            }).from(serviceRequests).where(inRange).groupBy(serviceRequests.type),

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

            db.execute(sql`
                SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kathmandu')::int AS hour, count(*)::int AS c
                FROM service_requests WHERE created_at BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz GROUP BY 1
            `),

            db.execute(sql`
                SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Kathmandu')::int AS dow, count(*)::int AS c
                FROM service_requests WHERE created_at BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz GROUP BY 1
            `),

            db.select({
                mistriId: serviceRequests.assignedMistriId,
                name: users.fullName,
                serviceId: mistriProfiles.serviceId,
                completed: sql<string>`count(*) FILTER (WHERE ${serviceRequests.status} = 'completed')`,
                revenue: sql<string>`COALESCE(SUM(${serviceRequests.paymentAmount}) FILTER (WHERE ${serviceRequests.status} = 'completed'), 0)`,
                rating: mistriProfiles.averageRating,
            }).from(serviceRequests)
                .innerJoin(users, eq(users.id, serviceRequests.assignedMistriId))
                .leftJoin(mistriProfiles, eq(mistriProfiles.userId, serviceRequests.assignedMistriId))
                .where(inRange)
                .groupBy(serviceRequests.assignedMistriId, users.fullName, mistriProfiles.serviceId, mistriProfiles.averageRating)
                .orderBy(desc(sql`count(*) FILTER (WHERE ${serviceRequests.status} = 'completed')`))
                .limit(6),
        ]);

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

        const topProviders = (topProviderRows as Array<{ mistriId: string; name: string; serviceId: number | null; completed: string; revenue: string; rating: string | null }>)
            .map((r) => ({
                mistriId: r.mistriId,
                name: r.name,
                serviceId: r.serviceId,
                completed: num(r.completed),
                revenue: num(r.revenue),
                rating: r.rating ? num(r.rating) : null,
            }));

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
                funnel: { created: total, assigned: assignedEver, completed },
                trend,
                byService,
                hours,
                weekday,
                topProviders,
            },
        });
    } catch (error) {
        console.error("Error building analytics:", error);
        return res.status(500).json({ success: false, message: "Failed to build analytics" });
    }
};
