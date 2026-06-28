// backend/src/controllers/admin/adminConsultationController.ts

import { Request, Response } from "express";
import { db } from "../../db";
import { 
    consultations, 
    users, 
    userAccounts, 
    mistriAccounts 
} from "../../db/schema";
import { eq, desc, and, or, ilike, count, sql } from "drizzle-orm";
import { z } from "zod";
import { createNotification } from "../notificationController";
import { createAuditLog } from "../../services/auditLog";
import { sendSms } from "../../services/sms";
import { shouldSendNotification } from "../../services/notificationPreferences";

// ============================================
// VALIDATION SCHEMAS
// ============================================

const updateConsultationSchema = z.object({
    status: z.enum(['pending', 'assigned', 'in_progress', 'completed', 'cancelled']).optional(),
    assignedTo: z.string().uuid().optional().nullable(),
    notes: z.string().optional().nullable(),
    adminNotes: z.string().optional().nullable(),
    urgency: z.enum(['normal', 'urgent', 'emergency']).optional(),
});

const assignConsultationSchema = z.object({
    mistriId: z.string().uuid(),
    notes: z.string().optional(),
});

// ============================================
// CONTROLLER FUNCTIONS
// ============================================

/**
 * Get all consultations (Admin only)
 */
export const getAllConsultations = async (req: Request, res: Response) => {
    try {
        const { status, categoryId, search, page = "1", limit = "20" } = req.query;
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const offset = (pageNum - 1) * limitNum;

        const conditions: any[] = [];

        if (status && status !== 'all') {
            conditions.push(eq(consultations.status, status as any));
        }

        if (categoryId) {
            conditions.push(eq(consultations.categoryId, parseInt(categoryId as string)));
        }

        if (search) {
            conditions.push(
                or(
                    ilike(consultations.categoryName, `%${search}%`),
                    ilike(consultations.location, `%${search}%`),
                    ilike(consultations.details, `%${search}%`)
                )!
            );
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // Get consultations with customer details from userAccounts
        const consultationList = await db
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
            .where(whereClause)
            .orderBy(desc(consultations.createdAt))
            .limit(limitNum)
            .offset(offset);

        // Get assigned mistri details from mistriAccounts
        const consultationsWithMistri = await Promise.all(
            consultationList.map(async (consultation) => {
                let assignedMistriName = null;
                let assignedMistriPhone = null;
                
                if (consultation.assignedTo) {
                    try {
                        const [mistri] = await db
                            .select({
                                fullName: mistriAccounts.fullName,
                                phoneNumber: mistriAccounts.phoneNumber,
                            })
                            .from(mistriAccounts)
                            .where(eq(mistriAccounts.id, consultation.assignedTo))
                            .limit(1);
                        
                        if (mistri) {
                            assignedMistriName = mistri.fullName;
                            assignedMistriPhone = mistri.phoneNumber;
                        }
                    } catch (error) {
                        console.error('Error fetching mistri details:', error);
                    }
                }
                
                return {
                    ...consultation,
                    assignedMistriName,
                    assignedMistriPhone,
                };
            })
        );

        // Get total count
        let total = 0;
        try {
            const totalResult = await db
                .select({ count: count() })
                .from(consultations)
                .where(whereClause);
            total = Number(totalResult[0]?.count || 0);
        } catch (error) {
            console.error('Error getting total count:', error);
            total = consultationList.length;
        }

        return res.json({
            success: true,
            consultations: consultationsWithMistri,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
            },
        });
    } catch (error) {
        console.error("Error fetching consultations:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch consultations"
        });
    }
};

/**
 * Get consultation by ID (Admin view)
 */
export const getConsultationById = async (req: Request, res: Response) => {
    try {
        const id = req.params.id;

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

        // Get assigned mistri details from mistriAccounts
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
 * Assign a mistri to a consultation (Admin only)
 */
export const assignConsultation = async (req: Request, res: Response) => {
    try {
        const adminId = (req as any).user?.userId;
        const id = req.params.id;
        const parsed = assignConsultationSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid data",
                errors: parsed.error.format()
            });
        }

        const { mistriId, notes } = parsed.data;

        // Get consultation
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

        if (consultation.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Cannot assign consultation with status: ${consultation.status}`
            });
        }

        // Verify mistri exists in mistriAccounts
        const [mistri] = await db
            .select({
                id: mistriAccounts.id,
                fullName: mistriAccounts.fullName,
                phoneNumber: mistriAccounts.phoneNumber,
            })
            .from(mistriAccounts)
            .where(eq(mistriAccounts.id, mistriId))
            .limit(1);

        if (!mistri) {
            return res.status(404).json({
                success: false,
                message: "Mistri not found"
            });
        }

        // Update consultation
        const [updated] = await db
            .update(consultations)
            .set({
                status: 'assigned',
                assignedTo: mistriId,
                notes: notes || null,
                updatedAt: new Date(),
            })
            .where(eq(consultations.id, id))
            .returning();

        // Notify mistri
        await createNotification(
            mistriId,
            "New Consultation Assignment",
            `You have been assigned a ${consultation.categoryName} consultation for ${consultation.location}`,
            "consultation_assigned",
            id
        );

        // Notify customer from userAccounts
        if (consultation.userId) {
            await createNotification(
                consultation.userId,
                "Consultation Assigned",
                `Your consultation has been assigned to ${mistri.fullName}. They will contact you shortly.`,
                "consultation_assigned",
                id
            );

            // Send SMS to customer
            const shouldSendSms = await shouldSendNotification(consultation.userId, 'consultation', 'sms');
            if (shouldSendSms) {
                try {
                    const customer = await db.query.userAccounts.findFirst({
                        where: eq(userAccounts.id, consultation.userId)
                    });
                    if (customer?.phoneNumber) {
                        await sendSms(
                            customer.phoneNumber,
                            `SERVEX: Your consultation has been assigned to ${mistri.fullName}. They will contact you shortly.`,
                            "consultation_assigned"
                        );
                    }
                } catch (smsError) {
                    console.error('Failed to send consultation SMS:', smsError);
                }
            }
        }

        // Create audit log
        await createAuditLog({
            entityType: "consultation",
            entityId: id,
            action: "assign",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            oldValue: { status: 'pending', assignedTo: null },
            newValue: { status: 'assigned', assignedTo: mistriId },
            metadata: { notes },
        });

        return res.json({
            success: true,
            message: "Consultation assigned successfully",
            consultation: updated,
        });
    } catch (error) {
        console.error("Error assigning consultation:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to assign consultation"
        });
    }
};

/**
 * Update consultation status (Admin only)
 */
export const updateConsultationStatus = async (req: Request, res: Response) => {
    try {
        const adminId = (req as any).user?.userId;
        const id = req.params.id;
        const { status, adminNotes } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                message: "Status is required"
            });
        }

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

        const updateData: any = {
            status,
            updatedAt: new Date(),
        };

        if (status === 'completed') {
            updateData.completedAt = new Date();
        }

        if (adminNotes !== undefined) {
            updateData.adminNotes = adminNotes;
        }

        const [updated] = await db
            .update(consultations)
            .set(updateData)
            .where(eq(consultations.id, id))
            .returning();

        // Notify customer if status changes
        if (consultation.userId) {
            let notificationTitle = '';
            let notificationMessage = '';

            switch (status) {
                case 'assigned':
                    notificationTitle = 'Consultation Assigned';
                    notificationMessage = `Your consultation has been assigned to a professional.`;
                    break;
                case 'in_progress':
                    notificationTitle = 'Consultation In Progress';
                    notificationMessage = `Your consultation is now in progress.`;
                    break;
                case 'completed':
                    notificationTitle = 'Consultation Completed';
                    notificationMessage = `Your consultation has been marked as completed. Thank you for using our service!`;
                    break;
                case 'cancelled':
                    notificationTitle = 'Consultation Cancelled';
                    notificationMessage = `Your consultation has been cancelled.`;
                    break;
                default:
                    notificationTitle = 'Consultation Updated';
                    notificationMessage = `Your consultation status has been updated to ${status}.`;
            }

            await createNotification(
                consultation.userId,
                notificationTitle,
                notificationMessage,
                `consultation_${status}`,
                id
            );
        }

        // Create audit log
        await createAuditLog({
            entityType: "consultation",
            entityId: id,
            action: `status_update_${status}`,
            performedBy: adminId || 'system',
            performedByRole: "admin",
            oldValue: { status: consultation.status },
            newValue: { status },
            metadata: { adminNotes },
        });

        return res.json({
            success: true,
            message: `Consultation ${status} successfully`,
            consultation: updated,
        });
    } catch (error) {
        console.error("Error updating consultation status:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update consultation status"
        });
    }
};

/**
 * Get consultation stats (Admin only)
 */
export const getConsultationStats = async (req: Request, res: Response) => {
    try {
        const [total, pending, assigned, inProgress, completed, cancelled] = await Promise.all([
            db.select({ count: count() }).from(consultations),
            db.select({ count: count() }).from(consultations).where(eq(consultations.status, 'pending')),
            db.select({ count: count() }).from(consultations).where(eq(consultations.status, 'assigned')),
            db.select({ count: count() }).from(consultations).where(eq(consultations.status, 'in_progress')),
            db.select({ count: count() }).from(consultations).where(eq(consultations.status, 'completed')),
            db.select({ count: count() }).from(consultations).where(eq(consultations.status, 'cancelled')),
        ]);

        // Get stats by category
        const byCategory = await db
            .select({
                categoryName: consultations.categoryName,
                count: count(),
            })
            .from(consultations)
            .groupBy(consultations.categoryName)
            .orderBy(desc(count()));

        // Get stats by urgency
        const byUrgency = await db
            .select({
                urgency: consultations.urgency,
                count: count(),
            })
            .from(consultations)
            .groupBy(consultations.urgency);

        // Get recent trend (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const trend = await db
            .select({
                date: sql<string>`DATE(${consultations.createdAt})`,
                count: count(),
            })
            .from(consultations)
            .where(sql`${consultations.createdAt} >= ${sevenDaysAgo}`)
            .groupBy(sql`DATE(${consultations.createdAt})`)
            .orderBy(sql`DATE(${consultations.createdAt})`);

        return res.json({
            success: true,
            stats: {
                total: Number(total[0]?.count || 0),
                pending: Number(pending[0]?.count || 0),
                assigned: Number(assigned[0]?.count || 0),
                inProgress: Number(inProgress[0]?.count || 0),
                completed: Number(completed[0]?.count || 0),
                cancelled: Number(cancelled[0]?.count || 0),
                byCategory: byCategory.map(item => ({
                    categoryName: item.categoryName,
                    count: Number(item.count),
                })),
                byUrgency: byUrgency.map(item => ({
                    urgency: item.urgency,
                    count: Number(item.count),
                })),
                trend: trend.map(item => ({
                    date: item.date,
                    count: Number(item.count),
                })),
            },
        });
    } catch (error) {
        console.error("Error fetching consultation stats:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch consultation stats"
        });
    }
};

/**
 * Get available categories for consultation (Admin only)
 */
export const getConsultationCategories = async (req: Request, res: Response) => {
    try {
        const categories = await db
            .select({
                categoryId: consultations.categoryId,
                categoryName: consultations.categoryName,
                count: count(),
            })
            .from(consultations)
            .groupBy(consultations.categoryId, consultations.categoryName)
            .orderBy(desc(count()));

        return res.json({
            success: true,
            categories,
        });
    } catch (error) {
        console.error("Error fetching consultation categories:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch categories"
        });
    }
};