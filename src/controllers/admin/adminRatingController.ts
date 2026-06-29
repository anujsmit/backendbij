// backend/src/controllers/admin/adminRatingController.ts
import { Request, Response } from "express";
import { db } from "../../db";
import { 
    ratings, 
    users,          // ✅ Unified users table
    mistriProfiles 
} from "../../db/schema";
import { eq, and, desc, avg, count, sql } from "drizzle-orm";
import { createAuditLog } from "../../services/auditLog";

// ============================================
// UPDATE MISTRI AVERAGE RATING
// ============================================

async function updateMistriAverageRating(mistriId: string) {
    try {
        const avgResult = await db
            .select({ average: avg(ratings.rating) })
            .from(ratings)
            .where(and(eq(ratings.mistriId, mistriId), eq(ratings.isApproved, true)));

        const averageRating = avgResult[0]?.average
            ? parseFloat(avgResult[0].average as string).toFixed(2)
            : "0.00";

        await db.update(mistriProfiles)
            .set({ averageRating })
            .where(eq(mistriProfiles.mistriId, mistriId));
    } catch (error) {
        console.error("Error updating average rating:", error);
    }
}

// ============================================
// GET ADMIN RATINGS - FIXED
// ============================================

export const getAdminRatings = async (req: Request, res: Response) => {
    try {
        const filterRaw = req.query.filter;
        const filter = (Array.isArray(filterRaw) ? filterRaw[0] : filterRaw ?? "pending") as "pending" | "approved" | "all";

        const conditions: any[] = [];
        if (filter === "pending") conditions.push(eq(ratings.isApproved, false));
        else if (filter === "approved") conditions.push(eq(ratings.isApproved, true));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // ✅ Get customer names from users (unified table)
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

        // ✅ Get mistri names from users (unified table)
        const withMistri = await Promise.all(
            rows.map(async (r) => {
                const mistri = await db
                    .select({ fullName: users.fullName })
                    .from(users)
                    .where(eq(users.id, r.mistriId))
                    .limit(1);
                return { 
                    ...r, 
                    mistriName: mistri[0]?.fullName ?? "Unknown" 
                };
            })
        );

        return res.json({ 
            success: true, 
            ratings: withMistri, 
            count: withMistri.length 
        });
    } catch (error) {
        console.error("Error fetching ratings:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Failed to fetch ratings" 
        });
    }
};

// ============================================
// APPROVE RATING
// ============================================

export const approveRating = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = (req as any).user?.userId;

        if (!adminId) {
            return res.status(401).json({
                success: false,
                message: "Admin ID not found"
            });
        }

        const [existing] = await db
            .select()
            .from(ratings)
            .where(eq(ratings.id, id))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ 
                success: false, 
                message: "Rating not found" 
            });
        }

        if (existing.isApproved) {
            return res.status(400).json({ 
                success: false, 
                message: "Already approved" 
            });
        }

        const [updated] = await db
            .update(ratings)
            .set({ 
                isApproved: true, 
                approvedBy: adminId, 
                approvedAt: new Date() 
            })
            .where(eq(ratings.id, id))
            .returning();

        // ✅ Update average rating using mistriId
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

        return res.json({ 
            success: true, 
            message: "Rating approved successfully",
            rating: updated 
        });
    } catch (error) {
        console.error("Error approving rating:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Failed to approve rating" 
        });
    }
};

// ============================================
// REJECT RATING
// ============================================

export const rejectRating = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = (req as any).user?.userId;
        const { reason } = req.body;

        if (!adminId) {
            return res.status(401).json({
                success: false,
                message: "Admin ID not found"
            });
        }

        const [existing] = await db
            .select()
            .from(ratings)
            .where(eq(ratings.id, id))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ 
                success: false, 
                message: "Rating not found" 
            });
        }

        await createAuditLog({
            entityType: "rating",
            entityId: id,
            action: "reject",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { 
                rating: existing.rating, 
                review: existing.review 
            },
            newValue: null,
            metadata: { reason: reason ?? "No reason provided" },
        });

        // Delete the rating
        await db.delete(ratings).where(eq(ratings.id, id));

        // ✅ Update average rating using mistriId
        await updateMistriAverageRating(existing.mistriId);

        return res.json({ 
            success: true, 
            message: "Rating rejected and removed" 
        });
    } catch (error) {
        console.error("Error rejecting rating:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Failed to reject rating" 
        });
    }
};

// ============================================
// GET RATING STATISTICS - FIXED
// ============================================

export const getRatingStats = async (req: Request, res: Response) => {
    try {
        const mistriId = req.params.mistriId;

        if (!mistriId) {
            return res.status(400).json({
                success: false,
                message: "Mistri ID is required"
            });
        }

        // ✅ Get average rating - FIXED: Use proper avg
        const avgResult = await db
            .select({ 
                average: avg(ratings.rating) 
            })
            .from(ratings)
            .where(and(
                eq(ratings.mistriId, mistriId),
                eq(ratings.isApproved, true)
            ));

        // ✅ Get total count - FIXED: Use count instead of avg
        const totalResult = await db
            .select({ 
                count: sql<number>`count(*)::int` 
            })
            .from(ratings)
            .where(and(
                eq(ratings.mistriId, mistriId),
                eq(ratings.isApproved, true)
            ));

        // ✅ Get rating distribution - FIXED: Use proper group by
        const distribution = await db
            .select({
                rating: ratings.rating,
                count: sql<number>`count(*)::int`,
            })
            .from(ratings)
            .where(and(
                eq(ratings.mistriId, mistriId),
                eq(ratings.isApproved, true)
            ))
            .groupBy(ratings.rating)
            .orderBy(ratings.rating);

        return res.json({
            success: true,
            stats: {
                averageRating: avgResult[0]?.average 
                    ? parseFloat(avgResult[0].average as string) 
                    : 0,
                totalReviews: totalResult[0]?.count || 0,
                distribution: distribution.map(d => ({
                    rating: d.rating,
                    count: Number(d.count)
                }))
            }
        });
    } catch (error) {
        console.error("Error fetching rating stats:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch rating stats"
        });
    }
};

// ============================================
// GET MISTRI RATINGS (For Customer View) - FIXED
// ============================================

export const getMistriRatings = async (req: Request, res: Response) => {
    try {
        const mistriId = req.params.mistriId;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const offset = (page - 1) * limit;

        if (!mistriId) {
            return res.status(400).json({
                success: false,
                message: "Mistri ID is required"
            });
        }

        // ✅ Get approved ratings for the mistri
        const ratingsList = await db
            .select({
                id: ratings.id,
                rating: ratings.rating,
                review: ratings.review,
                createdAt: ratings.createdAt,
                customerName: users.fullName,
                customerId: ratings.customerId,
            })
            .from(ratings)
            .innerJoin(users, eq(ratings.customerId, users.id))
            .where(and(
                eq(ratings.mistriId, mistriId),
                eq(ratings.isApproved, true)
            ))
            .orderBy(desc(ratings.createdAt))
            .limit(limit)
            .offset(offset);

        // ✅ Get total count - FIXED: Use sql count
        const totalResult = await db
            .select({ 
                count: sql<number>`count(*)::int` 
            })
            .from(ratings)
            .where(and(
                eq(ratings.mistriId, mistriId),
                eq(ratings.isApproved, true)
            ));

        return res.json({
            success: true,
            ratings: ratingsList,
            pagination: {
                page,
                limit,
                total: totalResult[0]?.count || 0,
                totalPages: Math.ceil((totalResult[0]?.count || 0) / limit),
            }
        });
    } catch (error) {
        console.error("Error fetching mistri ratings:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch mistri ratings"
        });
    }
};

// ============================================
// DELETE RATING (Admin)
// ============================================

export const deleteRating = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = (req as any).user?.userId;

        if (!adminId) {
            return res.status(401).json({
                success: false,
                message: "Admin ID not found"
            });
        }

        const [existing] = await db
            .select()
            .from(ratings)
            .where(eq(ratings.id, id))
            .limit(1);

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: "Rating not found"
            });
        }

        const mistriId = existing.mistriId;

        await createAuditLog({
            entityType: "rating",
            entityId: id,
            action: "delete",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: {
                rating: existing.rating,
                review: existing.review,
                mistriId: existing.mistriId,
                customerId: existing.customerId,
            },
            newValue: null,
            metadata: { deletedBy: adminId },
        });

        await db.delete(ratings).where(eq(ratings.id, id));

        // ✅ Update average rating
        await updateMistriAverageRating(mistriId);

        return res.json({
            success: true,
            message: "Rating deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting rating:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to delete rating"
        });
    }
};