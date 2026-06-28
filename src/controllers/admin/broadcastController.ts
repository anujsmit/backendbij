// backend/src/controllers/admin/broadcastController.ts
import { Request, Response } from "express";
import { db } from "../../db";
import { 
    userAccounts,        // ✅ Customer accounts
    mistriAccounts,      // ✅ Mistri accounts
    users,               // ✅ Admin users - ADDED THIS IMPORT
    mistriProfiles, 
    notifications, 
    auditLogs 
} from "../../db/schema";
import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { sendBulkPushNotifications } from "../../services/pushNotificationService";
import { sendSms } from "../../services/sms";
import { createAuditLog } from "../../services/auditLog";
import { z } from "zod";

type Recipient = { 
    id: string; 
    deviceToken: string | null; 
    phoneNumber: string | null 
};

// ============================================
// SEGMENTS DEFINITION
// ============================================

export const SEGMENTS: { key: string; label: string; description: string }[] = [
    { key: "all_customers", label: "All customers", description: "Every active customer" },
    { key: "all_providers", label: "All providers", description: "Every active ServeX provider" },
    { key: "everyone", label: "Everyone", description: "All active customers + providers" },
    { key: "providers_plumber", label: "Plumbers", description: "Active plumbing providers" },
    { key: "providers_electrician", label: "Electricians", description: "Active electrical providers" },
    { key: "inactive_customers", label: "Inactive customers (30d)", description: "Customers with no request in 30 days" },
];

// ============================================
// GET RECIPIENTS FOR A SEGMENT
// ============================================

async function recipientsFor(segment: string): Promise<Recipient[]> {
    // ✅ Customer columns from userAccounts
    const customerCols = { 
        id: userAccounts.id, 
        deviceToken: userAccounts.deviceToken, 
        phoneNumber: userAccounts.phoneNumber 
    };
    
    // ✅ Provider columns from mistriAccounts
    const providerCols = {
        id: mistriAccounts.id,
        deviceToken: mistriAccounts.deviceToken,
        phoneNumber: mistriAccounts.phoneNumber
    };

    switch (segment) {
        case "all_customers":
            return db.select(customerCols)
                .from(userAccounts)
                .where(and(
                    eq(userAccounts.accountType, "user"),
                    eq(userAccounts.isActive, true)
                ));

        case "all_providers":
            return db.select(providerCols)
                .from(mistriAccounts)
                .where(and(
                    eq(mistriAccounts.accountType, "mistri"),
                    eq(mistriAccounts.isActive, true)
                ));

        case "everyone": {
            const customers = await db.select(customerCols)
                .from(userAccounts)
                .where(and(
                    eq(userAccounts.accountType, "user"),
                    eq(userAccounts.isActive, true)
                ));
            
            const providers = await db.select(providerCols)
                .from(mistriAccounts)
                .where(and(
                    eq(mistriAccounts.accountType, "mistri"),
                    eq(mistriAccounts.isActive, true)
                ));
            
            return [...customers, ...providers];
        }

        case "providers_plumber":
        case "providers_electrician": {
            const sid = segment === "providers_plumber" ? 1 : 2;
            return db.select(providerCols)
                .from(mistriAccounts)
                .innerJoin(mistriProfiles, eq(mistriProfiles.mistriId, mistriAccounts.id))
                .where(and(
                    eq(mistriAccounts.accountType, "mistri"),
                    eq(mistriAccounts.isActive, true),
                    eq(mistriProfiles.serviceId, sid)
                ));
        }

        case "inactive_customers": {
            const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
            return db.select(customerCols)
                .from(userAccounts)
                .where(and(
                    eq(userAccounts.accountType, "user"),
                    eq(userAccounts.isActive, true),
                    sql`${userAccounts.id} NOT IN (SELECT DISTINCT customer_id FROM service_requests WHERE created_at > ${since}::timestamptz)`
                ));
        }

        default:
            return [];
    }
}

// ============================================
// GET BROADCAST SEGMENTS (Live reach per segment)
// ============================================

export const getBroadcastSegments = async (_req: Request, res: Response) => {
    try {
        const segments = await Promise.all(
            SEGMENTS.map(async (s) => {
                const r = await recipientsFor(s.key);
                return {
                    key: s.key,
                    label: s.label,
                    description: s.description,
                    total: r.length,
                    withPush: r.filter((x) => x.deviceToken).length,
                    withPhone: r.filter((x) => x.phoneNumber).length,
                };
            })
        );
        return res.json({ success: true, segments });
    } catch (error) {
        console.error("Error fetching broadcast segments:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Failed to load segments" 
        });
    }
};

// ============================================
// GET ACCOUNT TYPE HELPER
// ============================================

async function getAccountType(userId: string): Promise<'user' | 'mistri' | 'admin'> {
    // Check user accounts
    const user = await db.query.userAccounts.findFirst({
        where: eq(userAccounts.id, userId)
    });
    if (user) return 'user';

    // Check mistri accounts
    const mistri = await db.query.mistriAccounts.findFirst({
        where: eq(mistriAccounts.id, userId)
    });
    if (mistri) return 'mistri';

    // Check admin users
    const admin = await db.query.users.findFirst({
        where: eq(users.id, userId)
    });
    if (admin) return 'admin';

    return 'user';
}

// ============================================
// SEND BROADCAST
// ============================================

const sendSchema = z.object({
    segment: z.string(),
    channels: z.array(z.enum(["push", "sms", "inapp"])).min(1, "Pick at least one channel"),
    title: z.string().trim().max(120).optional().default(""),
    message: z.string().trim().min(1, "Message is required").max(1000),
});

export const sendBroadcast = async (req: Request, res: Response) => {
    try {
        const parsed = sendSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ 
                success: false, 
                message: parsed.error.issues[0]?.message ?? "Invalid data" 
            });
        }

        const { segment, channels, title, message } = parsed.data;

        const seg = SEGMENTS.find((s) => s.key === segment);
        if (!seg) {
            return res.status(400).json({ 
                success: false, 
                message: "Unknown segment" 
            });
        }

        if ((channels.includes("push") || channels.includes("inapp")) && !title.trim()) {
            return res.status(400).json({ 
                success: false, 
                message: "A title is required for push / in-app messages" 
            });
        }

        const recipients = await recipientsFor(segment);
        if (recipients.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "No recipients in this segment" 
            });
        }

        let pushSent = 0, smsSent = 0, inappSent = 0;

        // In-app notifications
        if (channels.includes("inapp")) {
            // ✅ FIXED: Resolve accountType for each recipient before inserting
            const notificationsData = [];
            for (const u of recipients) {
                const accountType = await getAccountType(u.id);
                notificationsData.push({
                    userId: u.id,
                    accountType: accountType,
                    title: title || "ServeX",
                    message: message,
                    type: "broadcast"
                });
            }
            await db.insert(notifications).values(notificationsData);
            inappSent = recipients.length;
        }

        // Push notifications
        if (channels.includes("push")) {
            const tokens = recipients
                .map((u) => u.deviceToken)
                .filter((t): t is string => !!t);
            pushSent = await sendBulkPushNotifications(
                tokens, 
                title || "ServeX", 
                message, 
                { type: "broadcast" }
            );
        }

        // SMS notifications
        if (channels.includes("sms")) {
            for (const u of recipients) {
                if (!u.phoneNumber) continue;
                try {
                    await sendSms(u.phoneNumber, message, "broadcast");
                    smsSent++;
                } catch {
                    // Individual SMS failure shouldn't abort the broadcast
                }
            }
        }

        const entityId = crypto.randomUUID();

        await createAuditLog({
            entityType: "broadcast",
            entityId,
            action: "send",
            performedBy: (req as any).user?.userId || 'system',
            performedByRole: "admin",
            metadata: { 
                title, 
                message, 
                channels, 
                segment, 
                segmentLabel: seg.label, 
                audienceCount: recipients.length, 
                pushSent, 
                smsSent, 
                inappSent 
            },
        });

        return res.json({ 
            success: true, 
            audienceCount: recipients.length, 
            pushSent, 
            smsSent, 
            inappSent 
        });
    } catch (error) {
        console.error("Error sending broadcast:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Failed to send broadcast" 
        });
    }
};

// ============================================
// GET BROADCAST HISTORY
// ============================================

export const getBroadcastHistory = async (_req: Request, res: Response) => {
    try {
        const sender = alias(users, "sender");
        const rows = await db
            .select({ 
                id: auditLogs.id, 
                createdAt: auditLogs.createdAt, 
                metadata: auditLogs.metadata, 
                senderName: sender.fullName 
            })
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
        return res.status(500).json({ 
            success: false, 
            message: "Failed to load history" 
        });
    }
};

// ============================================
// SEND TO SPECIFIC USERS (Direct broadcast)
// ============================================

export const sendDirectBroadcast = async (req: Request, res: Response) => {
    try {
        const { userIds, title, message, channels } = req.body;

        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "User IDs array is required"
            });
        }

        if (!message) {
            return res.status(400).json({
                success: false,
                message: "Message is required"
            });
        }

        if ((channels?.includes("push") || channels?.includes("inapp")) && !title) {
            return res.status(400).json({
                success: false,
                message: "Title is required for push/in-app messages"
            });
        }

        let pushSent = 0, smsSent = 0, inappSent = 0;

        // Get recipients from both tables
        const customers = await db.select({
            id: userAccounts.id,
            deviceToken: userAccounts.deviceToken,
            phoneNumber: userAccounts.phoneNumber,
        })
        .from(userAccounts)
        .where(inArray(userAccounts.id, userIds));

        const mistris = await db.select({
            id: mistriAccounts.id,
            deviceToken: mistriAccounts.deviceToken,
            phoneNumber: mistriAccounts.phoneNumber,
        })
        .from(mistriAccounts)
        .where(inArray(mistriAccounts.id, userIds));

        const recipients = [...customers, ...mistris];

        if (recipients.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No recipients found"
            });
        }

        // In-app notifications
        if (channels?.includes("inapp")) {
            // ✅ FIXED: Resolve accountType for each recipient before inserting
            const notificationsData = [];
            for (const u of recipients) {
                const accountType = await getAccountType(u.id);
                notificationsData.push({
                    userId: u.id,
                    accountType: accountType,
                    title: title || "ServeX",
                    message: message,
                    type: "direct_broadcast",
                });
            }
            await db.insert(notifications).values(notificationsData);
            inappSent = recipients.length;
        }

        // Push notifications
        if (channels?.includes("push")) {
            const tokens = recipients
                .map((u) => u.deviceToken)
                .filter((t): t is string => !!t);
            pushSent = await sendBulkPushNotifications(
                tokens,
                title || "ServeX",
                message,
                { type: "direct_broadcast" }
            );
        }

        // SMS notifications
        if (channels?.includes("sms")) {
            for (const u of recipients) {
                if (!u.phoneNumber) continue;
                try {
                    await sendSms(u.phoneNumber, message, "broadcast");
                    smsSent++;
                } catch {
                    // Individual SMS failure shouldn't abort the broadcast
                }
            }
        }

        const entityId = crypto.randomUUID();
        await createAuditLog({
            entityType: "broadcast",
            entityId,
            action: "direct_send",
            performedBy: (req as any).user?.userId || 'system',
            performedByRole: "admin",
            metadata: {
                title,
                message,
                channels,
                recipientCount: recipients.length,
                pushSent,
                smsSent,
                inappSent,
                userIds,
            },
        });

        return res.json({
            success: true,
            recipientCount: recipients.length,
            pushSent,
            smsSent,
            inappSent,
        });
    } catch (error) {
        console.error("Error sending direct broadcast:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send direct broadcast"
        });
    }
};