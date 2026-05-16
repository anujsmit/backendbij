import { Request, Response } from "express";
import { getPreferences, updatePreferences } from "../services/notificationPreferences";
import { z } from "zod";

const updatePreferencesSchema = z.object({
    pushEnabled: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    quietHoursStart: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional(),
    quietHoursEnd: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional(),
    typeSettings: z.record(z.string(), z.object({
        push: z.boolean().optional(),
        sms: z.boolean().optional(),
    })).nullable().optional(),
});

export const getNotificationPreferences = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }

        const preferences = await getPreferences(userId);

        return res.json({
            success: true,
            preferences,
        });
    } catch (error) {
        console.error("Error fetching notification preferences:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch notification preferences",
        });
    }
};

export const updateNotificationPreferences = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }

        const validatedData = updatePreferencesSchema.safeParse(req.body);

        if (!validatedData.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid request data",
                errors: validatedData.error.format(),
            });
        }

        const updates = validatedData.data;

        const [updated] = await updatePreferences(userId, updates);

        return res.json({
            success: true,
            message: "Notification preferences updated successfully",
            preferences: updated,
        });
    } catch (error) {
        console.error("Error updating notification preferences:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update notification preferences",
        });
    }
};
