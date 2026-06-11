import { Request, Response } from "express";
import { db } from "../db";
import { users, mistriProfiles, notifications, auditLogs } from "../db/schema";
import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { sendBulkPushNotifications } from "../services/pushNotificationService";
import { sendSms } from "../services/sms";
import { createAuditLog } from "../services/auditLog";
import { z } from "zod";

type Recipient = { id: string; deviceToken: string | null; phoneNumber: string | null };

export const SEGMENTS: { key: string; label: string; description: string }[] = [
    { key: "all_customers", label: "All customers", description: "Every active customer" },
    { key: "all_providers", label: "All providers", description: "Every active ServeX provider" },
    { key: "everyone", label: "Everyone", description: "All active customers + providers" },
    { key: "providers_plumber", label: "Plumbers", description: "Active plumbing providers" },
    { key: "providers_electrician", label: "Electricians", description: "Active electrical providers" },
    { key: "inactive_customers", label: "Inactive customers (30d)", description: "Customers with no request in 30 days" },
];

async function recipientsFor(segment: string): Promise<Recipient[]> {
    const cols = { id: users.id, deviceToken: users.deviceToken, phoneNumber: users.phoneNumber };
    switch (segment) {
        case "all_customers":
            return db.select(cols).from(users).where(and(eq(users.role, "user"), eq(users.isActive, true)));
        case "all_providers":
            return db.select(cols).from(users).where(and(eq(users.role, "mistri"), eq(users.isActive, true)));
        case "everyone":
            return db.select(cols).from(users).where(and(inArray(users.role, ["user", "mistri"]), eq(users.isActive, true)));
        case "providers_plumber":
        case "providers_electrician": {
            const sid = segment === "providers_plumber" ? 1 : 2;
            return db.select(cols).from(users)
                .innerJoin(mistriProfiles, eq(mistriProfiles.userId, users.id))
                .where(and(eq(users.role, "mistri"), eq(users.isActive, true), eq(mistriProfiles.serviceId, sid)));
        }
        case "inactive_customers": {
            const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
            return db.select(cols).from(users).where(and(
                eq(users.role, "user"),
                eq(users.isActive, true),
                sql`${users.id} NOT IN (SELECT DISTINCT customer_id FROM service_requests WHERE created_at > ${since}::timestamptz)`
            ));
        }
        default:
            return [];
    }
}

// GET /api/admin/broadcast/segments — live reach per segment.
export const getBroadcastSegments = async (_req: Request, res: Response) => {
    try {
        const segments = await Promise.all(SEGMENTS.map(async (s) => {
            const r = await recipientsFor(s.key);
            return {
                key: s.key,
                label: s.label,
                description: s.description,
                total: r.length,
                withPush: r.filter((x) => x.deviceToken).length,
                withPhone: r.filter((x) => x.phoneNumber).length,
            };
        }));
        return res.json({ success: true, segments });
    } catch (error) {
        console.error("Error fetching broadcast segments:", error);
        return res.status(500).json({ success: false, message: "Failed to load segments" });
    }
};

const sendSchema = z.object({
    segment: z.string(),
    channels: z.array(z.enum(["push", "sms", "inapp"])).min(1, "Pick at least one channel"),
    title: z.string().trim().max(120).optional().default(""),
    message: z.string().trim().min(1, "Message is required").max(1000),
});

// POST /api/admin/broadcast/send — push / SMS / in-app to a segment.
export const sendBroadcast = async (req: Request, res: Response) => {
    try {
        const parsed = sendSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid data" });
        }
        const { segment, channels, title, message } = parsed.data;

        const seg = SEGMENTS.find((s) => s.key === segment);
        if (!seg) return res.status(400).json({ success: false, message: "Unknown segment" });

        if ((channels.includes("push") || channels.includes("inapp")) && !title.trim()) {
            return res.status(400).json({ success: false, message: "A title is required for push / in-app messages" });
        }

        const recipients = await recipientsFor(segment);
        if (recipients.length === 0) {
            return res.status(400).json({ success: false, message: "No recipients in this segment" });
        }

        let pushSent = 0, smsSent = 0, inappSent = 0;

        if (channels.includes("inapp")) {
            await db.insert(notifications).values(
                recipients.map((u) => ({ userId: u.id, title: title || "ServeX", message, type: "broadcast" }))
            );
            inappSent = recipients.length;
        }

        if (channels.includes("push")) {
            const tokens = recipients.map((u) => u.deviceToken).filter((t): t is string => !!t);
            pushSent = await sendBulkPushNotifications(tokens, title || "ServeX", message, { type: "broadcast" });
        }

        if (channels.includes("sms")) {
            for (const u of recipients) {
                if (!u.phoneNumber) continue;
                try {
                    await sendSms(u.phoneNumber, message, "broadcast");
                    smsSent++;
                } catch {
                    /* individual SMS failure shouldn't abort the broadcast */
                }
            }
        }

        const entityId = crypto.randomUUID();
        await createAuditLog({
            entityType: "broadcast",
            entityId,
            action: "send",
            performedBy: req.user!.id,
            performedByRole: "admin",
            metadata: { title, message, channels, segment, segmentLabel: seg.label, audienceCount: recipients.length, pushSent, smsSent, inappSent },
        });

        return res.json({ success: true, audienceCount: recipients.length, pushSent, smsSent, inappSent });
    } catch (error) {
        console.error("Error sending broadcast:", error);
        return res.status(500).json({ success: false, message: "Failed to send broadcast" });
    }
};

// GET /api/admin/broadcast/history — past broadcasts (stored as audit-log events).
export const getBroadcastHistory = async (_req: Request, res: Response) => {
    try {
        const sender = alias(users, "sender");
        const rows = await db
            .select({ id: auditLogs.id, createdAt: auditLogs.createdAt, metadata: auditLogs.metadata, senderName: sender.fullName })
            .from(auditLogs)
            .leftJoin(sender, eq(auditLogs.performedBy, sender.id))
            .where(eq(auditLogs.entityType, "broadcast"))
            .orderBy(desc(auditLogs.createdAt))
            .limit(50);

        const broadcasts = rows.map((r) => {
            const m = (r.metadata ?? {}) as Record<string, unknown>;
            return {
                id: r.id,
                createdAt: r.createdAt,
                sender: r.senderName,
                title: m.title ?? "",
                message: m.message ?? "",
                channels: m.channels ?? [],
                segmentLabel: m.segmentLabel ?? "",
                audienceCount: m.audienceCount ?? 0,
                pushSent: m.pushSent ?? 0,
                smsSent: m.smsSent ?? 0,
                inappSent: m.inappSent ?? 0,
            };
        });

        return res.json({ success: true, broadcasts });
    } catch (error) {
        console.error("Error fetching broadcast history:", error);
        return res.status(500).json({ success: false, message: "Failed to load history" });
    }
};
