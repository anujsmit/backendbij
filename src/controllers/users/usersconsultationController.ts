// backend/src/controllers/customerConsultationController.ts

import { Request, Response } from "express";
import { db } from "../../db";
import { 
    consultations, 
    userAccounts, 
    users,
    mistriAccounts  // ✅ ADD THIS IMPORT
} from "../../db/schema";
import { eq, desc, and, count } from "drizzle-orm";
import { z } from "zod";
import { createNotification } from "../notificationController";
import { createAuditLog } from "../../services/auditLog";
import { sendSms } from "../../services/sms";
import { shouldSendNotification } from "../../services/notificationPreferences";

// ============================================
// VALIDATION SCHEMAS
// ============================================

const createConsultationSchema = z.object({
    categoryId: z.number().int().positive(),
    categoryName: z.string().min(1),
    location: z.string().min(1),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    details: z.string().optional(),
    preferredDate: z.union([
        z.string().datetime(),
        z.string().datetime().optional(),
        z.null(),
        z.undefined(),
        z.literal('')
    ]).transform(val => {
        if (val === '' || val === null || val === undefined) return null;
        return val;
    }),
    preferredTime: z.union([
        z.string(),
        z.null(),
        z.undefined(),
        z.literal('')
    ]).transform(val => {
        if (val === '' || val === null || val === undefined) return null;
        return val;
    }),
    urgency: z.enum(['normal', 'urgent', 'emergency']).default('normal'),
});

// ============================================
// CONTROLLER FUNCTIONS
// ============================================

/**
 * Create a new consultation request (Customer)
 */
export const createConsultation = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        
        console.log('📝 Create consultation - Request body:', JSON.stringify(req.body, null, 2));
        console.log('👤 User ID:', userId);

        const parsed = createConsultationSchema.safeParse(req.body);

        if (!parsed.success) {
            console.error('❌ Validation error:', parsed.error.format());
            return res.status(400).json({
                success: false,
                message: "Invalid data",
                errors: parsed.error.format()
            });
        }

        const { 
            categoryId,
            categoryName,
            location,
            latitude,
            longitude,
            details,
            preferredDate,
            preferredTime,
            urgency
        } = parsed.data;

        // Get user details from userAccounts
        let user = null;
        if (userId) {
            try {
                user = await db.query.userAccounts.findFirst({
                    where: eq(userAccounts.id, userId)
                });
            } catch (dbError) {
                console.error('❌ Database error fetching user:', dbError);
            }
        }

        // Create consultation
        const consultationData = {
            userId: userId || null,
            categoryId,
            categoryName,
            location,
            latitude: latitude ? String(latitude) : null,
            longitude: longitude ? String(longitude) : null,
            details: details || null,
            preferredDate: preferredDate ? new Date(preferredDate) : null,
            preferredTime: preferredTime || null,
            urgency,
            status: 'pending',
        };

        let consultation;
        try {
            const [result] = await db.insert(consultations).values(consultationData).returning();
            consultation = result;
        } catch (dbError) {
            console.error('❌ Database error creating consultation:', dbError);
            return res.status(500).json({
                success: false,
                message: "Failed to create consultation. Please try again.",
                error: process.env.NODE_ENV === 'development' ? String(dbError) : undefined
            });
        }

        // Notify admins (non-blocking)
        try {
            const admins = await db.query.users.findMany({
                where: eq(users.role, "admin"),
            });

            for (const admin of admins) {
                await createNotification(
                    admin.id,
                    "New Consultation Request",
                    `${user?.fullName || 'A customer'} has requested a ${categoryName} consultation. Location: ${location}`,
                    "new_consultation",
                    consultation.id
                );
            }
            console.log(`✅ Notified ${admins.length} admins`);
        } catch (notificationError) {
            console.error('❌ Error sending admin notifications:', notificationError);
        }

        // Send confirmation to user (non-blocking)
        if (userId && user?.deviceToken) {
            try {
                await createNotification(
                    userId,
                    "Consultation Request Received",
                    "Your consultation request has been received. We'll get back to you shortly.",
                    "consultation_confirmed",
                    consultation.id
                );
            } catch (notifError) {
                console.error('❌ Error sending user notification:', notifError);
            }
        }

        // Send SMS if enabled (non-blocking)
        if (userId && user?.phoneNumber) {
            try {
                const shouldSendSms = await shouldSendNotification(userId, 'consultation', 'sms');
                if (shouldSendSms) {
                    await sendSms(
                        user.phoneNumber,
                        `SERVEX: Your consultation request for ${categoryName} has been received. We'll contact you shortly.`,
                        "consultation_confirmed"
                    );
                }
            } catch (smsError) {
                console.error('❌ Failed to send consultation SMS:', smsError);
            }
        }

        // Create audit log (non-blocking)
        try {
            await createAuditLog({
                entityType: "consultation",
                entityId: consultation.id,
                action: "create",
                performedBy: userId || 'anonymous',
                performedByRole: userId ? "user" : "admin",
                newValue: { categoryName, location, urgency },
            });
        } catch (auditError) {
            console.error('❌ Error creating audit log:', auditError);
        }

        return res.status(201).json({
            success: true,
            message: "Consultation request submitted successfully",
            consultation,
        });
    } catch (error) {
        console.error('❌ Error creating consultation:', error);
        return res.status(500).json({
            success: false,
            message: "Failed to submit consultation request",
            error: process.env.NODE_ENV === 'development' ? String(error) : undefined
        });
    }
};

/**
 * Get customer's consultations
 */
export const getMyConsultations = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const { status, page = "1", limit = "20" } = req.query;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const offset = (pageNum - 1) * limitNum;

        const conditions: any[] = [eq(consultations.userId, userId)];

        if (status && status !== 'all') {
            conditions.push(eq(consultations.status, status as any));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const consultationList = await db
            .select()
            .from(consultations)
            .where(whereClause)
            .orderBy(desc(consultations.createdAt))
            .limit(limitNum)
            .offset(offset);

        const totalResult = await db
            .select({ count: count() })
            .from(consultations)
            .where(whereClause);

        return res.json({
            success: true,
            consultations: consultationList,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: Number(totalResult[0]?.count || 0),
            },
        });
    } catch (error) {
        console.error("Error fetching customer consultations:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch consultations"
        });
    }
};

/**
 * Get consultation by ID (Customer view)
 */
export const getConsultationById = async (req: Request, res: Response) => {
    try {
        const id = req.params.id;
        const userId = (req as any).user?.userId;
        const accountType = (req as any).user?.accountType;

        const [consultation] = await db
            .select({
                id: consultations.id,
                userId: consultations.userId,
                categoryId: consultations.categoryId,
                categoryName: consultations.categoryName,
                location: consultations.location,
                latitude: consultations.latitude,
                longitude: consultations.longitude,
                details: consultations.details,
                preferredDate: consultations.preferredDate,
                preferredTime: consultations.preferredTime,
                urgency: consultations.urgency,
                status: consultations.status,
                assignedTo: consultations.assignedTo,
                notes: consultations.notes,
                adminNotes: consultations.adminNotes,
                createdAt: consultations.createdAt,
                updatedAt: consultations.updatedAt,
                completedAt: consultations.completedAt,
                customerName: userAccounts.fullName,
                customerPhone: userAccounts.phoneNumber,
            })
            .from(consultations)
            .leftJoin(userAccounts, eq(consultations.userId, userAccounts.id))
            .where(eq(consultations.id, id))
            .limit(1);

        if (!consultation) {
            return res.status(404).json({
                success: false,
                message: "Consultation not found"
            });
        }

        // Check if user owns this consultation
        if (consultation.userId !== userId) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to view this consultation"
            });
        }

        // ✅ FIXED: Get assigned mistri details from mistriAccounts
        let assignedMistri = null;
        if (consultation.assignedTo) {
            const [mistri] = await db
                .select({
                    id: mistriAccounts.id,
                    fullName: mistriAccounts.fullName,
                    phoneNumber: mistriAccounts.phoneNumber,
                })
                .from(mistriAccounts)
                .where(eq(mistriAccounts.id, consultation.assignedTo))
                .limit(1);
            
            if (mistri) {
                assignedMistri = mistri;
            }
        }

        return res.json({
            success: true,
            consultation: {
                ...consultation,
                assignedMistri,
            },
        });
    } catch (error) {
        console.error("Error fetching consultation:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch consultation"
        });
    }
};

/**
 * Cancel consultation (Customer)
 */
export const cancelConsultation = async (req: Request, res: Response) => {
    try {
        const id = req.params.id;
        const userId = (req as any).user?.userId;

        const [consultation] = await db
            .select()
            .from(consultations)
            .where(eq(consultations.id, id))
            .limit(1);

        if (!consultation) {
            return res.status(404).json({
                success: false,
                message: "Consultation not found"
            });
        }

        if (consultation.userId !== userId) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to cancel this consultation"
            });
        }

        if (consultation.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel consultation with status: ${consultation.status}`
            });
        }

        const [updated] = await db
            .update(consultations)
            .set({
                status: 'cancelled',
                updatedAt: new Date(),
            })
            .where(eq(consultations.id, id))
            .returning();

        await createAuditLog({
            entityType: "consultation",
            entityId: id,
            action: "cancel",
            performedBy: userId,
            performedByRole: "user",
            oldValue: { status: 'pending' },
            newValue: { status: 'cancelled' },
        });

        return res.json({
            success: true,
            message: "Consultation cancelled successfully",
            consultation: updated,
        });
    } catch (error) {
        console.error("Error cancelling consultation:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to cancel consultation"
        });
    }
};