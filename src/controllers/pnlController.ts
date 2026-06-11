import { Request, Response } from "express";
import { db } from "../db";
import { payouts, expenses, serviceRequests } from "../db/schema";
import { and, eq, gte, lte, sum, count, sql, desc, isNotNull } from "drizzle-orm";

function strParam(v: unknown): string {
    return Array.isArray(v) ? String(v[0]) : String(v ?? "");
}
function parseDate(v: unknown): Date | null {
    const s = strParam(v);
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}
function toNum(v: unknown): number {
    return parseFloat(String(v ?? "0")) || 0;
}
function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

// GET /api/admin/pnl?from=&to= — profit & loss statement.
// Income = commission COLLECTED (cash basis) · Expenses = operating expenses by
// category · Net profit = income − expenses. GMV + pending commission are memos.
export const getPnlStatement = async (req: Request, res: Response) => {
    try {
        const to = parseDate(req.query.to) ?? new Date();
        const from = parseDate(req.query.from) ?? new Date(to.getFullYear(), 0, 1);

        const [
            [incomeRow],
            [pendingRow],
            [gmvRow],
            [expenseRow],
            byCategoryRows,
            monthlyRows,
        ] = await Promise.all([
            // Commission actually collected within the period (by settledAt).
            db.select({ total: sum(payouts.commissionAmount) }).from(payouts)
                .where(and(
                    eq(payouts.status, "collected"),
                    isNotNull(payouts.settledAt),
                    gte(payouts.settledAt, from),
                    lte(payouts.settledAt, to),
                )),
            // Commission settled but not yet collected (memo — money still owed in).
            db.select({ total: sum(payouts.commissionAmount) }).from(payouts)
                .where(eq(payouts.status, "pending")),
            // Gross job value processed (GMV memo) — total customer spend in period.
            db.select({ total: sum(serviceRequests.paymentAmount) }).from(serviceRequests)
                .where(and(
                    eq(serviceRequests.status, "completed"),
                    isNotNull(serviceRequests.paidAt),
                    gte(serviceRequests.paidAt, from),
                    lte(serviceRequests.paidAt, to),
                )),
            // Operating expenses in period.
            db.select({ total: sum(expenses.amount), count: count() }).from(expenses)
                .where(and(gte(expenses.incurredAt, from), lte(expenses.incurredAt, to))),
            // Expenses grouped by category.
            db.select({ category: expenses.category, total: sum(expenses.amount), count: count() }).from(expenses)
                .where(and(gte(expenses.incurredAt, from), lte(expenses.incurredAt, to)))
                .groupBy(expenses.category)
                .orderBy(desc(sum(expenses.amount))),
            // Monthly income vs expenses across the range (NPT months, gap-filled).
            db.execute(sql`
                WITH months AS (
                    SELECT to_char(d, 'YYYY-MM') AS m
                    FROM generate_series(
                        date_trunc('month', ${from.toISOString()}::timestamptz AT TIME ZONE 'Asia/Kathmandu'),
                        date_trunc('month', ${to.toISOString()}::timestamptz AT TIME ZONE 'Asia/Kathmandu'),
                        '1 month'::interval
                    ) d
                ),
                inc AS (
                    SELECT to_char(settled_at AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM') AS m, SUM(commission_amount) AS t
                    FROM payouts WHERE status = 'collected' AND settled_at IS NOT NULL GROUP BY 1
                ),
                exp AS (
                    SELECT to_char(incurred_at AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM') AS m, SUM(amount) AS t
                    FROM expenses GROUP BY 1
                )
                SELECT months.m AS month, COALESCE(inc.t, 0)::text AS income, COALESCE(exp.t, 0)::text AS expenses
                FROM months LEFT JOIN inc ON inc.m = months.m LEFT JOIN exp ON exp.m = months.m
                ORDER BY months.m
            `),
        ]);

        const income = toNum(incomeRow?.total);
        const totalExpenses = toNum(expenseRow?.total);
        const netProfit = round2(income - totalExpenses);
        const margin = income > 0 ? (netProfit / income) * 100 : 0;

        const byCategory = (byCategoryRows as Array<{ category: string; total: string; count: number }>).map((r) => ({
            category: r.category,
            total: toNum(r.total),
            count: Number(r.count ?? 0),
        }));

        const monthly = (monthlyRows as unknown as Array<{ month: string; income: string; expenses: string }>).map((r) => {
            const inc = toNum(r.income);
            const exp = toNum(r.expenses);
            return { month: r.month, income: inc, expenses: exp, profit: round2(inc - exp) };
        });

        return res.json({
            success: true,
            pnl: {
                range: { from: from.toISOString(), to: to.toISOString() },
                income: { commissionCollected: income, totalIncome: income },
                expenses: { byCategory, total: totalExpenses, count: Number(expenseRow?.count ?? 0) },
                netProfit,
                margin,
                memo: {
                    grossJobValue: toNum(gmvRow?.total),
                    commissionPending: toNum(pendingRow?.total),
                },
                monthly,
            },
        });
    } catch (error) {
        console.error("Error building P&L:", error);
        return res.status(500).json({ success: false, message: "Failed to build P&L statement" });
    }
};
