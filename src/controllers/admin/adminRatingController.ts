// backend/src/controllers/admin/adminRatingController.ts
import { Request, Response } from "express";
import { db } from "../../db";
import { 
    ratings, 
    userAccounts,        // ✅ Customer accounts
    mistriAccounts,      // ✅ Mistri accounts
    mistriProfiles 
} from "../../db/schema";
import { eq, and, desc, avg } from "drizzle-orm";
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

        // ✅ Fixed: Use mistriId directly with mistriProfiles.mistriId
        await db.update(mistriProfiles)
            .set({ averageRating })
            .where(eq(mistriProfiles.mistriId, mistriId));
    } catch (error) {
        console.error("Error updating average rating:", error);
    }
}

// ============================================
// GET ADMIN RATINGS
// ============================================

export const getAdminRatings = async (req: Request, res: Response) => {
    try {
        const filterRaw = req.query.filter;
        const filter = (Array.isArray(filterRaw) ? filterRaw[0] : filterRaw ?? "pending") as "pending" | "approved" | "all";

        const conditions: any[] = [];
        if (filter === "pending") conditions.push(eq(ratings.isApproved, false));
        else if (filter === "approved") conditions.push(eq(ratings.isApproved, true));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // ✅ Get customer names from userAccounts
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
                customerName: userAccounts.fullName,
            })
            .from(ratings)
            .innerJoin(userAccounts, eq(ratings.customerId, userAccounts.id))
            .where(whereClause)
            .orderBy(desc(ratings.createdAt));

        // ✅ Get mistri names from mistriAccounts
        const withMistri = await Promise.all(
            rows.map(async (r) => {
                const mistri = await db
                    .select({ fullName: mistriAccounts.fullName })
                    .from(mistriAccounts)
                    .where(eq(mistriAccounts.id, r.mistriId))
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
        // ✅ Fixed: Use userId from decoded token
        const adminId = (req as any).user?.userId;

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

        // ✅ Fixed: Use adminId from token
        await createAuditLog({
            entityType: "rating",
            entityId: id,
            action: "approve",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            oldValue: { isApproved: false },
            newValue: { isApproved: true, approvedAt: new Date().toISOString() },
            metadata: { mistriId: existing.mistriId },
        });

        return res.json({ 
            success: true, 
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
        // ✅ Fixed: Use userId from decoded token
        const adminId = (req as any).user?.userId;
        const { reason } = req.body;

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

        // ✅ Fixed: Use adminId from token
        await createAuditLog({
            entityType: "rating",
            entityId: id,
            action: "reject",
            performedBy: adminId || 'system',
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
// GET RATING STATISTICS
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

        // Get average rating
        const avgResult = await db
            .select({ 
                average: avg(ratings.rating),
                count: avg(ratings.rating)
            })
            .from(ratings)
            .where(and(
                eq(ratings.mistriId, mistriId),
                eq(ratings.isApproved, true)
            ));

        // Get rating distribution
        const distribution = await db
            .select({
                rating: ratings.rating,
                count: avg(ratings.rating)
            })
            .from(ratings)
            .where(and(
                eq(ratings.mistriId, mistriId),
                eq(ratings.isApproved, true)
            ))
            .groupBy(ratings.rating)
            .orderBy(ratings.rating);

        const totalCount = await db
            .select({ count: avg(ratings.rating) })
            .from(ratings)
            .where(and(
                eq(ratings.mistriId, mistriId),
                eq(ratings.isApproved, true)
            ));

        return res.json({
            success: true,
            stats: {
                averageRating: avgResult[0]?.average 
                    ? parseFloat(avgResult[0].average as string) 
                    : 0,
                totalReviews: totalCount[0]?.count || 0,
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
// GET MISTRI RATINGS (For Customer View)
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

        // Get approved ratings for the mistri
        const ratingsList = await db
            .select({
                id: ratings.id,
                rating: ratings.rating,
                review: ratings.review,
                createdAt: ratings.createdAt,
                customerName: userAccounts.fullName,
                customerId: ratings.customerId,
            })
            .from(ratings)
            .innerJoin(userAccounts, eq(ratings.customerId, userAccounts.id))
            .where(and(
                eq(ratings.mistriId, mistriId),
                eq(ratings.isApproved, true)
            ))
            .orderBy(desc(ratings.createdAt))
            .limit(limit)
            .offset(offset);

        // Get total count
        const totalResult = await db
            .select({ count: avg(ratings.rating) })
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
            performedBy: adminId || 'system',
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