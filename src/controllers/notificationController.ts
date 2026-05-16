import { Request, Response } from "express";
import { db } from "../db";
import { notifications, users } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { sendPushNotification } from "../services/pushNotificationService";
import { shouldSendNotification } from "../services/notificationPreferences";

export const getUserNotifications = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, message: "User not authenticated" });
        }

        const userNotifications = await db
            .select()
            .from(notifications)
            .where(eq(notifications.userId, userId))
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

export const markNotificationAsRead = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const id = req.params.id as string;

        if (!userId) {
            return res.status(401).json({ success: false, message: "User not authenticated" });
        }

        const notification = await db
            .select()
            .from(notifications)
            .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
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

export const markAllNotificationsAsRead = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, message: "User not authenticated" });
        }

        await db
            .update(notifications)
            .set({ isRead: true })
            .where(eq(notifications.userId, userId));

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

export const createNotification = async (
    userId: string,
    title: string,
    message: string,
    type: string,
    relatedRequestId?: string
) => {
    try {
        const [notification] = await db
            .insert(notifications)
            .values({
                userId,
                title,
                message,
                type,
                relatedRequestId: relatedRequestId || null,
            })
            .returning();

        const user = await db.query.users.findFirst({
            where: eq(users.id, userId),
            columns: {
                deviceToken: true,
            },
        });

        const shouldSendPush = await shouldSendNotification(userId, type, 'push');

        if (user?.deviceToken && shouldSendPush) {
            await sendPushNotification(
                user.deviceToken,
                title,
                message,
                {
                    type,
                    id: relatedRequestId,
                    notificationId: notification.id,
                }
            );
        } else if (!user?.deviceToken) {
            console.log(`No device token for user ${userId}, skipping push notification`);
        } else if (!shouldSendPush) {
            console.log(`User ${userId} has disabled push notifications for type ${type}, skipping`);
        }

        return notification;
    } catch (error) {
        console.error("Error creating notification:", error);
        throw error;
    }
};
