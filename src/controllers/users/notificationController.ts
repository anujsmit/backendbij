// backend/src/controllers/notificationController.ts
import { Request, Response } from "express";
import { db } from "../../db";
import { 
    notifications, 
    users,  // ✅ Unified users table
} from "../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { sendPushNotification } from "../../services/pushNotificationService";
import { shouldSendNotification } from "../../services/notificationPreferences";
import { logger } from "../../utils/logger";

// ============================================
// GET USER NOTIFICATIONS
// ============================================

export const getUserNotifications = async (req: Request, res: Response) => {
    try {
        // ✅ Use userId from decoded token
        const userId = (req as any).user?.userId;
        const accountType = (req as any).accountType;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: "User not authenticated" 
            });
        }

        // ✅ Verify user exists in unified users table
        const userExists = await db.query.users.findFirst({
            where: and(
                eq(users.id, userId),
                eq(users.accountType, accountType)
            )
        });

        if (!userExists) {
            return res.status(404).json({ 
                success: false, 
                message: "User not found" 
            });
        }

        // ✅ Get notifications with account type filter
        const userNotifications = await db
            .select()
            .from(notifications)
            .where(
                and(
                    eq(notifications.userId, userId),
                    eq(notifications.accountType, accountType)
                )
            )
            .orderBy(desc(notifications.createdAt));

        const unreadCount = userNotifications.filter(n => !n.isRead).length;

        return res.status(200).json({
            success: true,
            notifications: userNotifications,
            unreadCount,
        });
    } catch (error) {
        console.error("Error fetching notifications:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch notifications",
        });
    }
};

// ============================================
// MARK NOTIFICATION AS READ
// ============================================

export const markNotificationAsRead = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const accountType = (req as any).accountType;
        const id = req.params.id as string;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: "User not authenticated" 
            });
        }

        // ✅ Check notification belongs to user
        const notification = await db
            .select()
            .from(notifications)
            .where(
                and(
                    eq(notifications.id, id),
                    eq(notifications.userId, userId),
                    eq(notifications.accountType, accountType)
                )
            )
            .limit(1);

        if (notification.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Notification not found",
            });
        }

        const [updated] = await db
            .update(notifications)
            .set({ isRead: true })
            .where(eq(notifications.id, id))
            .returning();

        return res.status(200).json({
            success: true,
            notification: updated,
        });
    } catch (error) {
        console.error("Error marking notification as read:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to mark notification as read",
        });
    }
};

// ============================================
// MARK ALL NOTIFICATIONS AS READ
// ============================================

export const markAllNotificationsAsRead = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const accountType = (req as any).accountType;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: "User not authenticated" 
            });
        }

        await db
            .update(notifications)
            .set({ isRead: true })
            .where(
                and(
                    eq(notifications.userId, userId),
                    eq(notifications.accountType, accountType)
                )
            );

        return res.status(200).json({
            success: true,
            message: "All notifications marked as read",
        });
    } catch (error) {
        console.error("Error marking all notifications as read:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to mark all notifications as read",
        });
    }
};

// ============================================
// CREATE NOTIFICATION (Internal function)
// ============================================

export const createNotification = async (
    userId: string,
    title: string,
    message: string,
    type: string,
    relatedRequestId?: string
) => {
    try {
        // ✅ Get user from unified users table
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId)
        });

        if (!user) {
            logger.warn(`User ${userId} not found`);
            return null;
        }

        const accountType = user.accountType;

        // ✅ Insert notification with account type
        const [notification] = await db
            .insert(notifications)
            .values({
                userId,
                accountType,
                title,
                message,
                type,
                relatedRequestId: relatedRequestId || null,
                isRead: false,
            })
            .returning();

        // ✅ Get device token from unified users table
        const deviceToken = user.deviceToken || null;

        // ✅ Send push notification if enabled
        const shouldSendPush = await shouldSendNotification(userId, type, 'push');

        if (deviceToken && shouldSendPush) {
            await sendPushNotification(
                deviceToken,
                title,
                message,
                {
                    type,
                    id: relatedRequestId,
                    notificationId: notification.id,
                }
            );
        } else if (!deviceToken) {
            logger.debug(`No device token for user ${userId}, skipping push notification`);
        } else if (!shouldSendPush) {
            logger.debug(`User ${userId} has disabled push notifications for type ${type}, skipping`);
        }

        return notification;
    } catch (error) {
        logger.error("Error creating notification:", error);
        throw error;
    }
};

// ============================================
// GET NOTIFICATION COUNT (Internal function)
// ============================================

export const getUnreadNotificationCount = async (
    userId: string,
    accountType: 'user' | 'mistri' | 'admin'
): Promise<number> => {
    try {
        const result = await db
            .select({ count: notifications.id })
            .from(notifications)
            .where(
                and(
                    eq(notifications.userId, userId),
                    eq(notifications.accountType, accountType),
                    eq(notifications.isRead, false)
                )
            );

        return result.length;
    } catch (error) {
        logger.error("Error getting unread notification count:", error);
        return 0;
    }
};

// ============================================
// BULK CREATE NOTIFICATIONS
// ============================================

export const createBulkNotifications = async (
    userIds: string[],
    title: string,
    message: string,
    type: string,
    relatedRequestId?: string
) => {
    try {
        const results = [];
        for (const userId of userIds) {
            try {
                const notification = await createNotification(
                    userId,
                    title,
                    message,
                    type,
                    relatedRequestId
                );
                if (notification) {
                    results.push(notification);
                }
            } catch (error) {
                logger.error(`Failed to create notification for user ${userId}:`, error);
            }
        }
        return results;
    } catch (error) {
        logger.error("Error creating bulk notifications:", error);
        return [];
    }
};

// ============================================
// DELETE NOTIFICATION (Admin only)
// ============================================

export const deleteNotification = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const id = req.params.id as string;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: "User not authenticated" 
            });
        }

        // ✅ Check if user is admin
        if ((req as any).accountType !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "Admin access required",
            });
        }

        const [deleted] = await db
            .delete(notifications)
            .where(eq(notifications.id, id))
            .returning();

        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: "Notification not found",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Notification deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting notification:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to delete notification",
        });
    }
};

// ============================================
// GET NOTIFICATIONS BY TYPE
// ============================================

export const getNotificationsByType = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const accountType = (req as any).accountType;
        const { type } = req.params;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: "User not authenticated" 
            });
        }

        const userNotifications = await db
            .select()
            .from(notifications)
            .where(
                and(
                    eq(notifications.userId, userId),
                    eq(notifications.accountType, accountType),
                    eq(notifications.type, type)
                )
            )
            .orderBy(desc(notifications.createdAt));

        return res.status(200).json({
            success: true,
            notifications: userNotifications,
            count: userNotifications.length,
        });
    } catch (error) {
        console.error("Error fetching notifications by type:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch notifications",
        });
    }
};