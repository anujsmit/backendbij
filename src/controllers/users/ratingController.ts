// backend/src/controllers/ratingController.ts

import { Request, Response } from "express";
import { db } from "../../db";
import { 
    ratings, 
    serviceRequests, 
    users,           // Admin users only
    userAccounts,    // ✅ Customer accounts
    mistriAccounts,  // ✅ Mistri accounts
    mistriProfiles 
} from "../../db/schema";
import { z } from "zod";
import { and, eq, desc, sql, avg } from "drizzle-orm";
import { createAuditLog } from "../../services/auditLog";

const createRatingSchema = z.object({
    serviceRequestId: z.string().uuid(),
    rating: z.number().min(1).max(5).int(),
    review: z.string().optional(),
});

// ============================================
// CREATE RATING (Customer)
// ============================================

export const createRating = async (req: Request, res: Response) => {
    try {
        const validatedData = createRatingSchema.safeParse(req.body);

        if (!validatedData.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid request data",
                errors: validatedData.error.format(),
            });
        }

        // ✅ FIXED: Use userId and accountType from decoded token
        const userId = (req as any).user?.userId;
        const accountType = (req as any).user?.accountType;

        if (!userId || accountType !== "user") {
            return res.status(403).json({
                success: false,
                message: "Only customers can rate service requests",
            });
        }

        const { serviceRequestId, rating, review } = validatedData.data;

        const request = await db
            .select()
            .from(serviceRequests)
            .where(eq(serviceRequests.id, serviceRequestId))
            .limit(1);

        if (request.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Service request not found",
            });
        }

        const serviceRequest = request[0];

        if (serviceRequest.customerId !== userId) {
            return res.status(403).json({
                success: false,
                message: "You can only rate your own service requests",
            });
        }

        if (serviceRequest.status !== "completed") {
            return res.status(400).json({
                success: false,
                message: "Can only rate completed service requests",
            });
        }

        if (!serviceRequest.assignedMistriId) {
            return res.status(400).json({
                success: false,
                message: "No mistri assigned to this request",
            });
        }

        const existingRating = await db
            .select()
            .from(ratings)
            .where(eq(ratings.serviceRequestId, serviceRequestId))
            .limit(1);

        if (existingRating.length > 0) {
            return res.status(400).json({
                success: false,
                message: "This service request has already been rated",
            });
        }

        const result = await db.insert(ratings).values({
            serviceRequestId,
            customerId: userId,
            mistriId: serviceRequest.assignedMistriId,
            rating,
            review: review || null,
        }).returning();

        await updateMistriAverageRating(serviceRequest.assignedMistriId);

        return res.status(201).json({
            success: true,
            rating: result[0],
        });
    } catch (error) {
        console.error("Error creating rating:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create rating",
        });
    }
};

// ============================================
// GET MY RATINGS (Mistri)
// ============================================

export const getMyRatings = async (req: Request, res: Response) => {
    try {
        // ✅ FIXED: Use userId and accountType from decoded token
        const userId = (req as any).user?.userId;
        const accountType = (req as any).user?.accountType;

        if (!userId || accountType !== "mistri") {
            return res.status(403).json({
                success: false,
                message: "Only mistris can access their ratings",
            });
        }

        // ✅ FIXED: Use userAccounts for customer names
        const mistriRatings = await db
            .select({
                id: ratings.id,
                rating: ratings.rating,
                review: ratings.review,
                createdAt: ratings.createdAt,
                customerName: userAccounts.fullName,
                requestId: ratings.serviceRequestId,
            })
            .from(ratings)
            .innerJoin(userAccounts, eq(ratings.customerId, userAccounts.id))
            .where(
                and(
                    eq(ratings.mistriId, userId),
                    eq(ratings.isApproved, true)
                )
            )
            .orderBy(desc(ratings.createdAt));

        const avgRating = await db
            .select({
                average: avg(ratings.rating),
                count: sql<number>`count(*)::int`,
            })
            .from(ratings)
            .where(
                and(
                    eq(ratings.mistriId, userId),
                    eq(ratings.isApproved, true)
                )
            );

        return res.json({
            success: true,
            ratings: mistriRatings,
            averageRating: avgRating[0]?.average ? parseFloat(avgRating[0].average as string) : 0,
            totalRatings: avgRating[0]?.count || 0,
        });
    } catch (error) {
        console.error("Error fetching my ratings:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch ratings",
        });
    }
};

// ============================================
// GET MISTRI RATINGS (Public)
// ============================================

export const getMistriRatings = async (req: Request, res: Response) => {
    try {
        const mistriId = req.params.mistriId as string;

        // ✅ FIXED: Use userAccounts for customer names
        const mistriRatings = await db
            .select({
                id: ratings.id,
                rating: ratings.rating,
                review: ratings.review,
                createdAt: ratings.createdAt,
                customerName: userAccounts.fullName,
            })
            .from(ratings)
            .innerJoin(userAccounts, eq(ratings.customerId, userAccounts.id))
            .where(
                and(
                    eq(ratings.mistriId, mistriId),
                    eq(ratings.isApproved, true)
                )
            )
            .orderBy(desc(ratings.createdAt));

        const avgRating = await db
            .select({
                average: avg(ratings.rating),
                count: sql<number>`count(*)::int`,
            })
            .from(ratings)
            .where(
                and(
                    eq(ratings.mistriId, mistriId),
                    eq(ratings.isApproved, true)
                )
            );

        return res.json({
            success: true,
            ratings: mistriRatings,
            averageRating: avgRating[0]?.average ? parseFloat(avgRating[0].average as string) : 0,
            totalRatings: avgRating[0]?.count || 0,
        });
    } catch (error) {
        console.error("Error fetching mistri ratings:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch ratings",
        });
    }
};

// ============================================
// CHECK IF RATED (Customer)
// ============================================

export const checkIfRated = async (req: Request, res: Response) => {
    try {
        const serviceRequestId = req.params.serviceRequestId as string;
        // ✅ FIXED: Use userId from decoded token
        const userId = (req as any).user?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }

        const existingRating = await db
            .select()
            .from(ratings)
            .where(
                and(
                    eq(ratings.serviceRequestId, serviceRequestId),
                    eq(ratings.customerId, userId)
                )
            )
            .limit(1);

        return res.json({
            success: true,
            isRated: existingRating.length > 0,
            rating: existingRating[0] || null,
        });
    } catch (error) {
        console.error("Error checking rating status:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to check rating status",
        });
    }
};

// ============================================
// UPDATE MISTRI AVERAGE RATING (Helper)
// ============================================

async function updateMistriAverageRating(mistriId: string) {
    try {
        const avgResult = await db
            .select({
                average: avg(ratings.rating),
            })
            .from(ratings)
            .where(
                and(
                    eq(ratings.mistriId, mistriId),
                    eq(ratings.isApproved, true)
                )
            );

        const averageRating = avgResult[0]?.average
            ? parseFloat(avgResult[0].average as string).toFixed(2)
            : "0.00";

        // ✅ FIXED: Use mistriId in mistriProfiles
        await db
            .update(mistriProfiles)
            .set({ averageRating })
            .where(eq(mistriProfiles.mistriId, mistriId));
    } catch (error) {
        console.error("Error updating average rating:", error);
    }
}

// ============================================
// GET PENDING RATINGS (Admin)
// ============================================

export const getPendingRatings = async (req: Request, res: Response) => {
    try {
        // ✅ FIXED: Use accountType from decoded token
        const accountType = (req as any).user?.accountType;

        if (accountType !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Only admins can view pending ratings",
            });
        }

        // ✅ FIXED: Use userAccounts for customer names
        const pendingRatings = await db
            .select({
                id: ratings.id,
                rating: ratings.rating,
                review: ratings.review,
                createdAt: ratings.createdAt,
                customerName: userAccounts.fullName,
                customerId: ratings.customerId,
                mistriId: ratings.mistriId,
                serviceRequestId: ratings.serviceRequestId,
            })
            .from(ratings)
            .innerJoin(userAccounts, eq(ratings.customerId, userAccounts.id))
            .where(eq(ratings.isApproved, false))
            .orderBy(desc(ratings.createdAt));

        // ✅ FIXED: Use mistriAccounts for mistri names
        const ratingsWithMistriNames = await Promise.all(
            pendingRatings.map(async (rating) => {
                const mistri = await db.query.mistriAccounts.findFirst({
                    where: eq(mistriAccounts.id, rating.mistriId),
                });
                return {
                    ...rating,
                    mistriName: mistri?.fullName || "Unknown",
                };
            })
        );

        return res.json({
            success: true,
            ratings: ratingsWithMistriNames,
            count: ratingsWithMistriNames.length,
        });
    } catch (error) {
        console.error("Error fetching pending ratings:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch pending ratings",
        });
    }
};

// ============================================
// APPROVE RATING (Admin)
// ============================================

export const approveRating = async (req: Request, res: Response) => {
    try {
        // ✅ FIXED: Use userId and accountType from decoded token
        const userId = (req as any).user?.userId;
        const accountType = (req as any).user?.accountType;
        const id = req.params.id as string;

        if (!userId || accountType !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Only admins can approve ratings",
            });
        }

        const existing = await db.select().from(ratings).where(eq(ratings.id, id)).limit(1);

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Rating not found",
            });
        }

        const rating = existing[0];

        if (rating.isApproved) {
            return res.status(400).json({
                success: false,
                message: "Rating is already approved",
            });
        }

        const [updated] = await db
            .update(ratings)
            .set({
                isApproved: true,
                approvedBy: userId,
                approvedAt: new Date(),
            })
            .where(eq(ratings.id, id))
            .returning();

        await updateMistriAverageRating(rating.mistriId);

        await createAuditLog({
            entityType: 'rating',
            entityId: id,
            action: 'approve',
            performedBy: userId,
            performedByRole: 'admin',
            oldValue: { isApproved: false },
            newValue: { isApproved: true, approvedBy: userId, approvedAt: new Date().toISOString() },
            metadata: { mistriId: rating.mistriId }
        });

        return res.json({
            success: true,
            message: "Rating approved successfully",
            rating: updated,
        });
    } catch (error) {
        console.error("Error approving rating:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to approve rating",
        });
    }
};

// ============================================
// REJECT RATING (Admin)
// ============================================

export const rejectRating = async (req: Request, res: Response) => {
    try {
        // ✅ FIXED: Use userId and accountType from decoded token
        const userId = (req as any).user?.userId;
        const accountType = (req as any).user?.accountType;
        const id = req.params.id as string;
        const { reason } = req.body;

        if (!userId || accountType !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Only admins can reject ratings",
            });
        }

        const existing = await db.select().from(ratings).where(eq(ratings.id, id)).limit(1);

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Rating not found",
            });
        }

        const rating = existing[0];

        await createAuditLog({
            entityType: 'rating',
            entityId: id,
            action: 'reject',
            performedBy: userId,
            performedByRole: 'admin',
            oldValue: {
                rating: rating.rating,
                review: rating.review,
                mistriId: rating.mistriId,
                customerId: rating.customerId,
            },
            newValue: null,
            metadata: { reason: reason || 'No reason provided' }
        });

        await db.delete(ratings).where(eq(ratings.id, id));

        await updateMistriAverageRating(rating.mistriId);

        return res.json({
            success: true,
            message: "Rating rejected and deleted",
        });
    } catch (error) {
        console.error("Error rejecting rating:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to reject rating",
        });
    }
};