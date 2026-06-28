// backend/src/services/notificationPreferences.ts
import { db } from "../db";
import { mistriAccounts, notificationPreferences, userAccounts, users } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface NotificationPreferences {
    pushEnabled: boolean;
    smsEnabled: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    typeSettings: Record<string, { push?: boolean; sms?: boolean }> | null;
}

// ============================================
// GET PREFERENCES
// ============================================

export const getPreferences = async (
    userId: string,
    accountType: 'user' | 'mistri' | 'admin'
): Promise<NotificationPreferences> => {
    try {
        const [prefs] = await db
            .select()
            .from(notificationPreferences)
            .where(
                and(
                    eq(notificationPreferences.userId, userId),
                    eq(notificationPreferences.accountType, accountType)
                )
            )
            .limit(1);

        if (prefs) {
            return {
                pushEnabled: prefs.pushEnabled,
                smsEnabled: prefs.smsEnabled,
                quietHoursStart: prefs.quietHoursStart,
                quietHoursEnd: prefs.quietHoursEnd,
                typeSettings: prefs.typeSettings as Record<string, { push?: boolean; sms?: boolean }> | null,
            };
        }

        // Return default preferences if not found
        return {
            pushEnabled: true,
            smsEnabled: true,
            quietHoursStart: null,
            quietHoursEnd: null,
            typeSettings: null,
        };
    } catch (error) {
        logger.error("Error getting notification preferences:", error);
        return {
            pushEnabled: true,
            smsEnabled: true,
            quietHoursStart: null,
            quietHoursEnd: null,
            typeSettings: null,
        };
    }
};

// ============================================
// UPDATE PREFERENCES
// ============================================

export const updatePreferences = async (
    userId: string,
    updates: Partial<NotificationPreferences>,
    accountType: 'user' | 'mistri' | 'admin'
): Promise<NotificationPreferences> => {
    try {
        // Check if preferences exist
        const [existing] = await db
            .select()
            .from(notificationPreferences)
            .where(
                and(
                    eq(notificationPreferences.userId, userId),
                    eq(notificationPreferences.accountType, accountType)
                )
            )
            .limit(1);

        const updateData = {
            pushEnabled: updates.pushEnabled !== undefined ? updates.pushEnabled : true,
            smsEnabled: updates.smsEnabled !== undefined ? updates.smsEnabled : true,
            quietHoursStart: updates.quietHoursStart !== undefined ? updates.quietHoursStart : null,
            quietHoursEnd: updates.quietHoursEnd !== undefined ? updates.quietHoursEnd : null,
            typeSettings: updates.typeSettings !== undefined ? updates.typeSettings : null,
            updatedAt: new Date(),
        };

        let result;

        if (existing) {
            // Update existing preferences
            const [updated] = await db
                .update(notificationPreferences)
                .set(updateData)
                .where(
                    and(
                        eq(notificationPreferences.userId, userId),
                        eq(notificationPreferences.accountType, accountType)
                    )
                )
                .returning();

            result = updated;
        } else {
            // Insert new preferences
            const [inserted] = await db
                .insert(notificationPreferences)
                .values({
                    userId,
                    accountType,
                    ...updateData,
                })
                .returning();

            result = inserted;
        }

        return {
            pushEnabled: result.pushEnabled,
            smsEnabled: result.smsEnabled,
            quietHoursStart: result.quietHoursStart,
            quietHoursEnd: result.quietHoursEnd,
            typeSettings: result.typeSettings as Record<string, { push?: boolean; sms?: boolean }> | null,
        };
    } catch (error) {
        logger.error("Error updating notification preferences:", error);
        throw error;
    }
};

// ============================================
// SHOULD SEND NOTIFICATION
// ============================================

export const shouldSendNotification = async (
    userId: string,
    type: string,
    channel: 'push' | 'sms'
): Promise<boolean> => {
    try {
        // Get user's account type
        let accountType: 'user' | 'mistri' | 'admin' | null = null;
        
        // Check all tables
        const user = await db.query.userAccounts.findFirst({
            where: eq(userAccounts.id, userId)
        });
        if (user) accountType = 'user';
        
        if (!accountType) {
            const mistri = await db.query.mistriAccounts.findFirst({
                where: eq(mistriAccounts.id, userId)
            });
            if (mistri) accountType = 'mistri';
        }
        
        if (!accountType) {
            const admin = await db.query.users.findFirst({
                where: eq(users.id, userId)
            });
            if (admin) accountType = 'admin';
        }

        if (!accountType) {
            // User not found, default to true
            return true;
        }

        const prefs = await getPreferences(userId, accountType);

        // Check global channel settings
        if (channel === 'push' && !prefs.pushEnabled) return false;
        if (channel === 'sms' && !prefs.smsEnabled) return false;

        // Check type-specific settings
        if (prefs.typeSettings && prefs.typeSettings[type]) {
            const typeSetting = prefs.typeSettings[type];
            if (channel === 'push' && typeSetting.push === false) return false;
            if (channel === 'sms' && typeSetting.sms === false) return false;
        }

        // Check quiet hours
        if (prefs.quietHoursStart && prefs.quietHoursEnd) {
            const now = new Date();
            const currentTime = now.getHours() * 60 + now.getMinutes();
            const [startHour, startMin] = prefs.quietHoursStart.split(':').map(Number);
            const [endHour, endMin] = prefs.quietHoursEnd.split(':').map(Number);
            const start = startHour * 60 + startMin;
            const end = endHour * 60 + endMin;

            if (start <= end) {
                if (currentTime >= start && currentTime <= end) return false;
            } else {
                // Overnight quiet hours
                if (currentTime >= start || currentTime <= end) return false;
            }
        }

        return true;
    } catch (error) {
        logger.error("Error checking notification preferences:", error);
        return true; // Default to true on error
    }
};