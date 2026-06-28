// backend/src/controllers/notificationPreferencesController.ts

import { Request, Response } from "express";
import { db } from "../db";
import { 
    notificationPreferences,
    userAccounts,
    mistriAccounts,
    users
} from "../db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../services/auditLog";
import { logger } from "../utils/logger";

// ============================================
// TYPES & SCHEMAS
// ============================================

const DEFAULT_PREFERENCES = {
    pushEnabled: true,
    smsEnabled: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    typeSettings: {},
};

const updatePreferencesSchema = z.object({
    pushEnabled: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    quietHoursStart: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional().nullable(),
    quietHoursEnd: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional().nullable(),
    typeSettings: z.record(z.boolean()).optional(),
});

// ============================================
// HELPER FUNCTIONS
// ============================================

type AccountType = 'user' | 'mistri' | 'admin';

async function getUserFromAccount(userId: string, accountType: AccountType) {
    if (accountType === 'user') {
        return await db.query.userAccounts.findFirst({
            where: eq(userAccounts.id, userId)
        });
    } else if (accountType === 'mistri') {
        return await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.id, userId)
        });
    } else if (accountType === 'admin') {
        return await db.query.users.findFirst({
            where: eq(users.id, userId)
        });
    }
    return null;
}

async function getPreferences(userId: string, accountType: AccountType) {
    const prefs = await db.query.notificationPreferences.findFirst({
        where: and(
            eq(notificationPreferences.userId, userId),
            eq(notificationPreferences.accountType, accountType)
        )
    });

    if (prefs) {
        return prefs;
    }

    // Return defaults if no preferences exist
    return {
        userId,
        accountType,
        pushEnabled: DEFAULT_PREFERENCES.pushEnabled,
        smsEnabled: DEFAULT_PREFERENCES.smsEnabled,
        quietHoursStart: DEFAULT_PREFERENCES.quietHoursStart,
        quietHoursEnd: DEFAULT_PREFERENCES.quietHoursEnd,
        typeSettings: DEFAULT_PREFERENCES.typeSettings,
    };
}

async function updatePreferences(userId: string, updates: any, accountType: AccountType) {
    // Check if preferences exist
    const existing = await db.query.notificationPreferences.findFirst({
        where: and(
            eq(notificationPreferences.userId, userId),
            eq(notificationPreferences.accountType, accountType)
        )
    });

    if (existing) {
        // Update existing
        const [updated] = await db.update(notificationPreferences)
            .set({
                ...updates,
                updatedAt: new Date(),
            })
            .where(and(
                eq(notificationPreferences.userId, userId),
                eq(notificationPreferences.accountType, accountType)
            ))
            .returning();
        
        return updated;
    } else {
        // Insert new
        const [inserted] = await db.insert(notificationPreferences)
            .values({
                userId,
                accountType,
                pushEnabled: updates.pushEnabled ?? DEFAULT_PREFERENCES.pushEnabled,
                smsEnabled: updates.smsEnabled ?? DEFAULT_PREFERENCES.smsEnabled,
                quietHoursStart: updates.quietHoursStart ?? DEFAULT_PREFERENCES.quietHoursStart,
                quietHoursEnd: updates.quietHoursEnd ?? DEFAULT_PREFERENCES.quietHoursEnd,
                typeSettings: updates.typeSettings ?? DEFAULT_PREFERENCES.typeSettings,
            })
            .returning();
        
        return inserted;
    }
}

// ============================================
// CONTROLLER FUNCTIONS
// ============================================

/**
 * GET /api/notification-preferences
 * Get current user's notification preferences
 */
export const getNotificationPreferences = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const accountType = (req as any).user?.accountType;

        if (!userId || !accountType) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        const preferences = await getPreferences(userId, accountType as AccountType);

        return res.json({
            success: true,
            preferences: {
                pushEnabled: preferences.pushEnabled,
                smsEnabled: preferences.smsEnabled,
                quietHoursStart: preferences.quietHoursStart,
                quietHoursEnd: preferences.quietHoursEnd,
                typeSettings: preferences.typeSettings || {},
            }
        });
    } catch (error) {
        logger.error("Error fetching notification preferences:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch notification preferences"
        });
    }
};

/**
 * PATCH /api/notification-preferences
 * Update current user's notification preferences
 */
export const updateNotificationPreferences = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const accountType = (req as any).user?.accountType;

        if (!userId || !accountType) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        const parsed = updatePreferencesSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid data",
                errors: parsed.error.format()
            });
        }

        // ✅ FIXED: Don't destructure - just assign the result
        const updated = await updatePreferences(userId, parsed.data, accountType as AccountType);

        // Create audit log
        await createAuditLog({
            entityType: "notification_preferences",
            entityId: userId,
            action: "update",
            performedBy: userId,
            performedByRole: accountType,
            newValue: parsed.data,
        });

        return res.json({
            success: true,
            message: "Preferences updated successfully",
            preferences: {
                pushEnabled: updated.pushEnabled,
                smsEnabled: updated.smsEnabled,
                quietHoursStart: updated.quietHoursStart,
                quietHoursEnd: updated.quietHoursEnd,
                typeSettings: updated.typeSettings || {},
            }
        });
    } catch (error) {
        logger.error("Error updating notification preferences:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update notification preferences"
        });
    }
};

/**
 * POST /api/notification-preferences/reset
 * Reset notification preferences to defaults
 */
export const resetNotificationPreferences = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const accountType = (req as any).user?.accountType;

        if (!userId || !accountType) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        // ✅ FIXED: Don't destructure - just assign the result
        const updated = await updatePreferences(userId, DEFAULT_PREFERENCES, accountType as AccountType);

        await createAuditLog({
            entityType: "notification_preferences",
            entityId: userId,
            action: "reset",
            performedBy: userId,
            performedByRole: accountType,
            newValue: DEFAULT_PREFERENCES,
        });

        return res.json({
            success: true,
            message: "Preferences reset to defaults",
            preferences: {
                pushEnabled: updated.pushEnabled,
                smsEnabled: updated.smsEnabled,
                quietHoursStart: updated.quietHoursStart,
                quietHoursEnd: updated.quietHoursEnd,
                typeSettings: updated.typeSettings || {},
            }
        });
    } catch (error) {
        logger.error("Error resetting notification preferences:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to reset notification preferences"
        });
    }
};

/**
 * POST /api/admin/notification-preferences/:userId
 * Admin endpoint to update a user's preferences
 */
export const adminUpdateNotificationPreferences = async (req: Request, res: Response) => {
    try {
        const adminId = (req as any).user?.userId;
        const userId = req.params.userId;
        const { accountType, preferences } = req.body;

        if (!adminId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        if (!userId || !accountType) {
            return res.status(400).json({
                success: false,
                message: "User ID and account type are required"
            });
        }

        // Verify user exists
        const user = await getUserFromAccount(userId, accountType as AccountType);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const parsed = updatePreferencesSchema.safeParse(preferences);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid preferences data",
                errors: parsed.error.format()
            });
        }

        // ✅ FIXED: Don't destructure - just assign the result
        const updated = await updatePreferences(userId, parsed.data, accountType as AccountType);

        await createAuditLog({
            entityType: "notification_preferences",
            entityId: userId,
            action: "admin_update",
            performedBy: adminId,
            performedByRole: "admin",
            newValue: parsed.data,
        });

        return res.json({
            success: true,
            message: "User preferences updated successfully",
            preferences: {
                pushEnabled: updated.pushEnabled,
                smsEnabled: updated.smsEnabled,
                quietHoursStart: updated.quietHoursStart,
                quietHoursEnd: updated.quietHoursEnd,
                typeSettings: updated.typeSettings || {},
            }
        });
    } catch (error) {
        logger.error("Error updating user preferences:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update user preferences"
        });
    }
};