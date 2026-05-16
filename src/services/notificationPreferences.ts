import { db } from "../db";
import { notificationPreferences } from "../db/schema";
import { eq } from "drizzle-orm";

/**
 * Check if a notification should be sent based on user preferences
 * @param userId - The user ID to check preferences for
 * @param notificationType - The type of notification (e.g., 'new_request', 'request_accepted')
 * @param channel - The notification channel ('push' or 'sms')
 * @returns Promise<boolean> - Whether the notification should be sent
 */
export const shouldSendNotification = async (
  userId: string,
  notificationType: string,
  channel: 'push' | 'sms'
): Promise<boolean> => {
  try {
    // Get user's notification preferences
    const prefs = await db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, userId),
    });

    // If no preferences exist, create default preferences and allow notification
    if (!prefs) {
      await createDefaultPreferences(userId);
      return true;
    }

    // Check global channel toggle
    if (channel === 'push' && !prefs.pushEnabled) {
      return false;
    }
    if (channel === 'sms' && !prefs.smsEnabled) {
      return false;
    }

    // Check quiet hours
    if (prefs.quietHoursStart && prefs.quietHoursEnd) {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      if (isInQuietHours(currentTime, prefs.quietHoursStart, prefs.quietHoursEnd)) {
        return false;
      }
    }

    // Check type-specific settings
    if (prefs.typeSettings && typeof prefs.typeSettings === 'object') {
      const typeSettings = prefs.typeSettings as Record<string, any>;
      const notifTypeSettings = typeSettings[notificationType];

      if (notifTypeSettings) {
        // If type-specific setting exists for this channel, use it
        if (channel === 'push' && typeof notifTypeSettings.push === 'boolean') {
          return notifTypeSettings.push;
        }
        if (channel === 'sms' && typeof notifTypeSettings.sms === 'boolean') {
          return notifTypeSettings.sms;
        }
      }
    }

    // Default: allow notification if all checks passed
    return true;
  } catch (error) {
    console.error('Error checking notification preferences:', error);
    // On error, allow notification (fail open to not break functionality)
    return true;
  }
};

/**
 * Create default notification preferences for a user
 */
export const createDefaultPreferences = async (userId: string): Promise<void> => {
  try {
    await db.insert(notificationPreferences).values({
      userId,
      pushEnabled: true,
      smsEnabled: true,
      quietHoursStart: null,
      quietHoursEnd: null,
      typeSettings: null,
    });
  } catch (error) {
    console.error('Failed to create default notification preferences:', error);
    // Don't throw - this is a background operation
  }
};

/**
 * Get notification preferences for a user
 */
export const getPreferences = async (userId: string) => {
  const prefs = await db.query.notificationPreferences.findFirst({
    where: eq(notificationPreferences.userId, userId),
  });

  // If no preferences exist, create defaults
  if (!prefs) {
    await createDefaultPreferences(userId);
    return {
      userId,
      pushEnabled: true,
      smsEnabled: true,
      quietHoursStart: null,
      quietHoursEnd: null,
      typeSettings: null,
    };
  }

  return prefs;
};

/**
 * Update notification preferences for a user
 */
export const updatePreferences = async (
  userId: string,
  updates: {
    pushEnabled?: boolean;
    smsEnabled?: boolean;
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
    typeSettings?: Record<string, any> | null;
  }
) => {
  // Check if preferences exist
  const existing = await db.query.notificationPreferences.findFirst({
    where: eq(notificationPreferences.userId, userId),
  });

  if (!existing) {
    // Create new preferences
    return await db.insert(notificationPreferences).values({
      userId,
      pushEnabled: updates.pushEnabled ?? true,
      smsEnabled: updates.smsEnabled ?? true,
      quietHoursStart: updates.quietHoursStart ?? null,
      quietHoursEnd: updates.quietHoursEnd ?? null,
      typeSettings: updates.typeSettings ?? null,
      updatedAt: new Date(),
    }).returning();
  }

  // Update existing preferences
  return await db.update(notificationPreferences)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(notificationPreferences.userId, userId))
    .returning();
};

/**
 * Check if current time is within quiet hours
 * @param currentTime - Current time in HH:mm format
 * @param start - Quiet hours start time in HH:mm format
 * @param end - Quiet hours end time in HH:mm format
 */
function isInQuietHours(currentTime: string, start: string, end: string): boolean {
  // Convert times to minutes since midnight for comparison
  const toMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const current = toMinutes(currentTime);
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);

  // Handle case where quiet hours cross midnight (e.g., 22:00 to 08:00)
  if (startMin > endMin) {
    return current >= startMin || current < endMin;
  }

  // Normal case (e.g., 13:00 to 14:00)
  return current >= startMin && current < endMin;
}
