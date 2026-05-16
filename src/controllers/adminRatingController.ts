import { Request, Response } from "express";
import { db } from "../db";
import { ratings, users, mistriProfiles } from "../db/schema";
import { eq, and, desc, avg } from "drizzle-orm";
import { createAuditLog } from "../services/auditLog";

async function updateMistriAverageRating(mistriId: string) {
    try {
        const avgResult = await db
            .select({ average: avg(ratings.rating) })
            .from(ratings)
            .where(and(eq(ratings.mistriId, mistriId), eq(ratings.isApproved, true)));

        const averageRating = avgResult[0]?.average
            ? parseFloat(avgResult[0].average as string).toFixed(2)
            : "0.00";

        await db.update(mistriProfiles).set({ averageRating }).where(eq(mistriProfiles.userId, mistriId));
    } catch (error) {
        console.error("Error updating average rating:", error);
    }
}

export const getAdminRatings = async (req: Request, res: Response) => {
    try {
        const filterRaw = req.query.filter;
        const filter = (Array.isArray(filterRaw) ? filterRaw[0] : filterRaw ?? "pending") as "pending" | "approved" | "all";

        const conditions: any[] = [];
        if (filter === "pending") conditions.push(eq(ratings.isApproved, false));
        else if (filter === "approved") conditions.push(eq(ratings.isApproved, true));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const customerAlias = users;
        const rows = await db
            .select({
                id: ratings.id,
                rating: ratings.rating,
                review: ratings.review,
                isApproved: ratings.isApproved,
                rejectionReason: ratings.rejectionReason,
                createdAt: ratings.createdAt,
                approvedAt: ratings.approvedAt,
                customerId: ratings.customerId,
                mistriId: ratings.mistriId,
                serviceRequestId: ratings.serviceRequestId,
                customerName: users.fullName,
            })
            .from(ratings)
            .innerJoin(users, eq(ratings.customerId, users.id))
            .where(whereClause)
            .orderBy(desc(ratings.createdAt));

        const withMistri = await Promise.all(
            rows.map(async (r) => {
                const mistri = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, r.mistriId)).limit(1);
                return { ...r, mistriName: mistri[0]?.fullName ?? "Unknown" };
            })
        );

        return res.json({ success: true, ratings: withMistri, count: withMistri.length });
    } catch (error) {
        console.error("Error fetching ratings:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch ratings" });
    }
};

export const approveRating = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = req.user!.id;

        const [existing] = await db.select().from(ratings).where(eq(ratings.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Rating not found" });
        if (existing.isApproved) return res.status(400).json({ success: false, message: "Already approved" });

        const [updated] = await db
            .update(ratings)
            .set({ isApproved: true, approvedBy: adminId, approvedAt: new Date() })
            .where(eq(ratings.id, id))
            .returning();

        await updateMistriAverageRating(existing.mistriId);

        await createAuditLog({
            entityType: "rating",
            entityId: id,
            action: "approve",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { isApproved: false },
            newValue: { isApproved: true, approvedAt: new Date().toISOString() },
            metadata: { mistriId: existing.mistriId },
        });

        return res.json({ success: true, rating: updated });
    } catch (error) {
        console.error("Error approving rating:", error);
        return res.status(500).json({ success: false, message: "Failed to approve rating" });
    }
};

export const rejectRating = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = req.user!.id;
        const { reason } = req.body;

        const [existing] = await db.select().from(ratings).where(eq(ratings.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Rating not found" });

        await createAuditLog({
            entityType: "rating",
            entityId: id,
            action: "reject",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { rating: existing.rating, review: existing.review },
            newValue: null,
            metadata: { reason: reason ?? "No reason provided" },
        });

        await db.delete(ratings).where(eq(ratings.id, id));
        await updateMistriAverageRating(existing.mistriId);

        return res.json({ success: true, message: "Rating rejected and removed" });
    } catch (error) {
        console.error("Error rejecting rating:", error);
        return res.status(500).json({ success: false, message: "Failed to reject rating" });
    }
};
