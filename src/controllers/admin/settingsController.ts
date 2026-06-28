import { Request, Response } from "express";
import { db } from "../../db";
import { appSettings } from "../../db/schema";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../../services/auditLog";

/**
 * Business / platform settings, stored as key-value rows in app_settings
 * (the same table the Payouts feature uses for `commission_rate`, so the
 * commission % stays a single source of truth across both screens).
 */
type SettingType = "string" | "number" | "boolean";
const CATALOG: { key: string; type: SettingType; default: string }[] = [
    { key: "support_phone", type: "string", default: "" },
    { key: "support_email", type: "string", default: "" },
    { key: "operating_hours", type: "string", default: "" },
    { key: "currency_symbol", type: "string", default: "रु" },
    { key: "currency_code", type: "string", default: "NPR" },
    { key: "commission_rate", type: "number", default: "0" },
    { key: "min_app_version", type: "string", default: "" },
    { key: "force_update", type: "boolean", default: "false" },
    { key: "sms_enabled", type: "boolean", default: "true" },
    { key: "push_enabled", type: "boolean", default: "true" },
];
const KEYS = CATALOG.map((c) => c.key);

function coerce(type: SettingType, raw: string): string | number | boolean {
    if (type === "number") return parseFloat(raw) || 0;
    if (type === "boolean") return raw === "true" || raw === "1";
    return raw;
}

export const getBusinessSettings = async (_req: Request, res: Response) => {
    try {
        let stored: Record<string, string> = {};
        try {
            const rows = await db.select().from(appSettings).where(inArray(appSettings.key, KEYS));
            stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        } catch { stored = {}; } // app_settings may not exist on a very old DB

        const settings: Record<string, string | number | boolean> = {};
        for (const c of CATALOG) {
            settings[c.key] = coerce(c.type, stored[c.key] ?? c.default);
        }
        return res.json({ success: true, settings });
    } catch (error) {
        console.error("getBusinessSettings error:", error);
        return res.status(500).json({ success: false, message: "Failed to load settings" });
    }
};

const updateSchema = z.object({
    support_phone: z.string().trim().max(40).optional(),
    support_email: z.string().trim().max(120).optional(),
    operating_hours: z.string().trim().max(120).optional(),
    currency_symbol: z.string().trim().max(8).optional(),
    currency_code: z.string().trim().max(8).optional(),
    commission_rate: z.coerce.number().min(0).max(100).optional(),
    min_app_version: z.string().trim().max(20).optional(),
    force_update: z.boolean().optional(),
    sms_enabled: z.boolean().optional(),
    push_enabled: z.boolean().optional(),
});

export const updateBusinessSettings = async (req: Request, res: Response) => {
    try {
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" });
        }
        const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
        for (const [key, value] of entries) {
            const str = typeof value === "boolean" ? String(value) : String(value);
            await db.insert(appSettings)
                .values({ key, value: str, updatedAt: new Date() })
                .onConflictDoUpdate({ target: appSettings.key, set: { value: str, updatedAt: new Date() } });
        }

        // ✅ FIXED: Use userId from decoded token
        await createAuditLog({
            entityType: "app_settings",
            entityId: "business_settings",
            action: "update",
            performedBy: (req as any).user?.userId || 'system',
            performedByRole: "admin",
            newValue: parsed.data,
        });

        return res.json({ success: true, message: "Settings saved" });
    } catch (error) {
        console.error("updateBusinessSettings error:", error);
        return res.status(500).json({ success: false, message: "Failed to save settings" });
    }
};