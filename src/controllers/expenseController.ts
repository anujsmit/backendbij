import { Request, Response } from "express";
import { db } from "../db";
import { expenses, serviceRequests, users } from "../db/schema";
import {
    and,
    desc,
    eq,
    gte,
    lte,
    ilike,
    or,
    ne,
    isNotNull,
    count,
    sum,
    sql,
    SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createAuditLog } from "../services/auditLog";
import { z } from "zod";

/**
 * Curated expense categories. Validated here (and mirrored in the admin UI) so
 * reports stay clean without paying the cost of a Postgres enum migration.
 */
export const EXPENSE_CATEGORIES = [
    "salary",
    "marketing",
    "rent",
    "utilities",
    "sms",
    "transport",
    "equipment",
    "software",
    "maintenance",
    "commission",
    "refund",
    "tax",
    "misc",
] as const;

const PAYMENT_METHODS = ["cash", "bank", "wallet", "online", "other"] as const;

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

const upsertSchema = z.object({
    title: z.string().trim().min(1).max(255),
    category: z.enum(EXPENSE_CATEGORIES),
    amount: z.coerce.number().positive().max(99_999_999),
    paidTo: z.string().trim().max(255).optional().nullable(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional().nullable(),
    note: z.string().trim().max(2000).optional().nullable(),
    incurredAt: z.string().datetime({ offset: true }).optional().nullable(),
});

// GET /api/admin/expenses — paginated, filterable list + filtered totals
export const getExpenses = async (req: Request, res: Response) => {
    try {
        const search = strParam(req.query.search).trim();
        const category = strParam(req.query.category).trim();
        const from = parseDate(req.query.from);
        const to = parseDate(req.query.to);
        const page = Math.max(1, parseInt(strParam(req.query.page) || "1"));
        const limit = Math.min(200, Math.max(1, parseInt(strParam(req.query.limit) || "25")));
        const offset = (page - 1) * limit;

        const conditions: SQL[] = [];
        if (search) {
            conditions.push(
                or(
                    ilike(expenses.title, `%${search}%`),
                    ilike(expenses.paidTo, `%${search}%`),
                    ilike(expenses.note, `%${search}%`)
                )!
            );
        }
        if (category && (EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
            conditions.push(eq(expenses.category, category));
        }
        if (from) conditions.push(gte(expenses.incurredAt, from));
        if (to) conditions.push(lte(expenses.incurredAt, to));
        const whereClause = conditions.length ? and(...conditions) : undefined;

        const creator = alias(users, "creator");

        const [rows, [agg]] = await Promise.all([
            db
                .select({
                    id: expenses.id,
                    title: expenses.title,
                    category: expenses.category,
                    amount: expenses.amount,
                    paidTo: expenses.paidTo,
                    paymentMethod: expenses.paymentMethod,
                    note: expenses.note,
                    incurredAt: expenses.incurredAt,
                    createdAt: expenses.createdAt,
                    createdByName: creator.fullName,
                })
                .from(expenses)
                .leftJoin(creator, eq(expenses.createdBy, creator.id))
                .where(whereClause)
                .orderBy(desc(expenses.incurredAt), desc(expenses.createdAt))
                .limit(limit)
                .offset(offset),
            db
                .select({ total: count(), sumAmount: sum(expenses.amount) })
                .from(expenses)
                .where(whereClause),
        ]);

        return res.json({
            success: true,
            expenses: rows,
            total: Number(agg?.total ?? 0),
            sumAmount: toNum(agg?.sumAmount),
            page,
            limit,
            categories: EXPENSE_CATEGORIES,
        });
    } catch (error) {
        console.error("Error fetching expenses:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch expenses" });
    }
};

// GET /api/admin/expenses/report — KPIs + category breakdown + 12-month trend + top payees
export const getExpenseReport = async (req: Request, res: Response) => {
    try {
        const from = parseDate(req.query.from);
        const to = parseDate(req.query.to);

        const rangeConds: SQL[] = [];
        if (from) rangeConds.push(gte(expenses.incurredAt, from));
        if (to) rangeConds.push(lte(expenses.incurredAt, to));
        const rangeWhere = rangeConds.length ? and(...rangeConds) : undefined;

        const revConds: SQL[] = [eq(serviceRequests.status, "completed"), isNotNull(serviceRequests.completedAt)];
        if (from) revConds.push(gte(serviceRequests.completedAt, from));
        if (to) revConds.push(lte(serviceRequests.completedAt, to));

        const payeeConds: SQL[] = [...rangeConds, isNotNull(expenses.paidTo), ne(expenses.paidTo, "")];

        const [
            [totals],
            [revenueRow],
            byCategoryRows,
            largestRows,
            topPayeeRows,
            trendRows,
        ] = await Promise.all([
            db
                .select({ total: sum(expenses.amount), count: count() })
                .from(expenses)
                .where(rangeWhere),
            db
                .select({ total: sum(serviceRequests.paymentAmount) })
                .from(serviceRequests)
                .where(and(...revConds)),
            db
                .select({ category: expenses.category, total: sum(expenses.amount), count: count() })
                .from(expenses)
                .where(rangeWhere)
                .groupBy(expenses.category)
                .orderBy(desc(sum(expenses.amount))),
            db
                .select({ title: expenses.title, amount: expenses.amount, category: expenses.category })
                .from(expenses)
                .where(rangeWhere)
                .orderBy(desc(expenses.amount))
                .limit(1),
            db
                .select({ paidTo: expenses.paidTo, total: sum(expenses.amount), count: count() })
                .from(expenses)
                .where(and(...payeeConds))
                .groupBy(expenses.paidTo)
                .orderBy(desc(sum(expenses.amount)))
                .limit(5),
            // Last 12 NPT calendar months — expenses vs revenue, gap-filled via generate_series.
            db.execute(sql`
                WITH months AS (
                    SELECT to_char(d, 'YYYY-MM') AS month
                    FROM generate_series(
                        date_trunc('month', (now() AT TIME ZONE 'Asia/Kathmandu')) - interval '11 months',
                        date_trunc('month', (now() AT TIME ZONE 'Asia/Kathmandu')),
                        interval '1 month'
                    ) AS d
                ),
                exp AS (
                    SELECT to_char(incurred_at AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM') AS month, SUM(amount) AS total
                    FROM expenses GROUP BY 1
                ),
                rev AS (
                    SELECT to_char(completed_at AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM') AS month, SUM(payment_amount) AS total
                    FROM service_requests
                    WHERE status = 'completed' AND completed_at IS NOT NULL
                    GROUP BY 1
                )
                SELECT m.month,
                       COALESCE(exp.total, 0)::text AS expenses,
                       COALESCE(rev.total, 0)::text AS revenue
                FROM months m
                LEFT JOIN exp ON exp.month = m.month
                LEFT JOIN rev ON rev.month = m.month
                ORDER BY m.month
            `),
        ]);

        const totalExpenses = toNum(totals?.total);
        const expenseCount = Number(totals?.count ?? 0);
        const revenue = toNum(revenueRow?.total);

        const byCategory = byCategoryRows.map((r) => ({
            category: r.category,
            total: toNum(r.total),
            count: Number(r.count ?? 0),
        }));

        const trend = (trendRows as unknown as Array<{ month: string; expenses: string; revenue: string }>).map(
            (r) => ({ month: r.month, expenses: toNum(r.expenses), revenue: toNum(r.revenue) })
        );

        const topPayees = topPayeeRows.map((r) => ({
            paidTo: r.paidTo,
            total: toNum(r.total),
            count: Number(r.count ?? 0),
        }));

        const largest = largestRows[0]
            ? {
                  title: largestRows[0].title,
                  amount: toNum(largestRows[0].amount),
                  category: largestRows[0].category,
              }
            : null;

        return res.json({
            success: true,
            report: {
                range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
                totalExpenses,
                expenseCount,
                avgExpense: expenseCount ? totalExpenses / expenseCount : 0,
                revenue,
                netProfit: revenue - totalExpenses,
                largestExpense: largest,
                byCategory,
                monthlyTrend: trend,
                topPayees,
            },
        });
    } catch (error) {
        console.error("Error building expense report:", error);
        return res.status(500).json({ success: false, message: "Failed to build expense report" });
    }
};

// POST /api/admin/expenses
export const createExpense = async (req: Request, res: Response) => {
    try {
        const parsed = upsertSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: parsed.error.issues[0]?.message ?? "Invalid expense data",
            });
        }
        const v = parsed.data;

        const [row] = await db
            .insert(expenses)
            .values({
                title: v.title,
                category: v.category,
                amount: String(v.amount),
                paidTo: v.paidTo?.trim() || null,
                paymentMethod: v.paymentMethod ?? null,
                note: v.note?.trim() || null,
                incurredAt: v.incurredAt ? new Date(v.incurredAt) : new Date(),
                createdBy: req.user?.id ?? null,
            })
            .returning();

        await createAuditLog({
            entityType: "expense",
            entityId: row.id,
            action: "create",
            performedBy: req.user!.id,
            performedByRole: "admin",
            newValue: { title: row.title, category: row.category, amount: row.amount },
        });

        return res.status(201).json({ success: true, expense: row });
    } catch (error) {
        console.error("Error creating expense:", error);
        return res.status(500).json({ success: false, message: "Failed to create expense" });
    }
};

// PATCH /api/admin/expenses/:id
export const updateExpense = async (req: Request, res: Response) => {
    try {
        const id = strParam(req.params.id);
        const parsed = upsertSchema.partial().safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: parsed.error.issues[0]?.message ?? "Invalid expense data",
            });
        }
        const v = parsed.data;

        const [existing] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Expense not found" });
        }

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (v.title !== undefined) updates.title = v.title;
        if (v.category !== undefined) updates.category = v.category;
        if (v.amount !== undefined) updates.amount = String(v.amount);
        if (v.paidTo !== undefined) updates.paidTo = v.paidTo?.trim() || null;
        if (v.paymentMethod !== undefined) updates.paymentMethod = v.paymentMethod ?? null;
        if (v.note !== undefined) updates.note = v.note?.trim() || null;
        if (v.incurredAt !== undefined && v.incurredAt) updates.incurredAt = new Date(v.incurredAt);

        const [row] = await db.update(expenses).set(updates).where(eq(expenses.id, id)).returning();

        await createAuditLog({
            entityType: "expense",
            entityId: id,
            action: "update",
            performedBy: req.user!.id,
            performedByRole: "admin",
            oldValue: { title: existing.title, category: existing.category, amount: existing.amount },
            newValue: { title: row.title, category: row.category, amount: row.amount },
        });

        return res.json({ success: true, expense: row });
    } catch (error) {
        console.error("Error updating expense:", error);
        return res.status(500).json({ success: false, message: "Failed to update expense" });
    }
};

// DELETE /api/admin/expenses/:id
export const deleteExpense = async (req: Request, res: Response) => {
    try {
        const id = strParam(req.params.id);
        const [existing] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Expense not found" });
        }

        await db.delete(expenses).where(eq(expenses.id, id));

        await createAuditLog({
            entityType: "expense",
            entityId: id,
            action: "delete",
            performedBy: req.user!.id,
            performedByRole: "admin",
            oldValue: { title: existing.title, category: existing.category, amount: existing.amount },
        });

        return res.json({ success: true, message: "Expense deleted" });
    } catch (error) {
        console.error("Error deleting expense:", error);
        return res.status(500).json({ success: false, message: "Failed to delete expense" });
    }
};
