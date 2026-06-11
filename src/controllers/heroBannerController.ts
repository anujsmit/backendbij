import { Request, Response } from "express";
import { db } from "../db";
import { heroBanners } from "../db/schema";
import { eq, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { createAuditLog } from "../services/auditLog";

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

async function uploadBannerImage(base64Image: string, bannerId: string): Promise<string> {
    const rawBuffer = Buffer.from(base64Image, "base64");
    const compressed = await sharp(rawBuffer)
        .resize({ width: 1200, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80, progressive: true })
        .toBuffer();

    const fileName = `banner_${bannerId}_${Date.now()}.jpg`;
    const { error } = await supabase.storage
        .from("banners")
        .upload(fileName, compressed, { upsert: true, contentType: "image/jpeg" });

    if (error) throw error;

    const { data } = supabase.storage.from("banners").getPublicUrl(fileName);
    return data.publicUrl;
}

export const getPublicHeroBanners = async (_req: Request, res: Response) => {
    try {
        const banners = await db
            .select()
            .from(heroBanners)
            .where(eq(heroBanners.isActive, true))
            .orderBy(asc(heroBanners.displayOrder));

        return res.json({ success: true, banners });
    } catch (error) {
        console.error("Error fetching hero banners:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch banners" });
    }
};

export const getAdminHeroBanners = async (_req: Request, res: Response) => {
    try {
        const banners = await db.select().from(heroBanners).orderBy(asc(heroBanners.displayOrder));
        return res.json({ success: true, banners });
    } catch (error) {
        console.error("Error fetching hero banners:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch banners" });
    }
};

const createBannerSchema = z.object({
    title: z.string().max(255).optional(),
    subtitle: z.string().optional(),
    imageBase64: z.string().optional(),
    imageUrl: z.string().url().optional(),
    linkUrl: z.string().url().optional(),
    displayOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
});

export const createHeroBanner = async (req: Request, res: Response): Promise<Response> => {
    try {
        const parsed = createBannerSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
        }

        const { imageBase64, ...rest } = parsed.data;

        if (!imageBase64 && !rest.imageUrl) {
            return res.status(400).json({ success: false, message: "imageBase64 or imageUrl is required" });
        }

        const [placeholder] = await db.insert(heroBanners).values({
            imageUrl: rest.imageUrl ?? "pending",
            ...rest,
        }).returning();

        let imageUrl = rest.imageUrl;

        if (imageBase64) {
            imageUrl = await uploadBannerImage(imageBase64, placeholder.id);
            await db.update(heroBanners).set({ imageUrl }).where(eq(heroBanners.id, placeholder.id));
        }

        const [final] = await db.select().from(heroBanners).where(eq(heroBanners.id, placeholder.id)).limit(1);

        return res.status(201).json({ success: true, banner: final });
    } catch (error) {
        console.error("Error creating hero banner:", error);
        return res.status(500).json({ success: false, message: "Failed to create banner" });
    }
};

const updateBannerSchema = z.object({
    title: z.string().max(255).optional(),
    subtitle: z.string().optional(),
    imageBase64: z.string().optional(),
    imageUrl: z.string().url().optional(),
    linkUrl: z.string().url().optional().nullable(),
    displayOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
});

export const updateHeroBanner = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const parsed = updateBannerSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
        }

        const [existing] = await db.select().from(heroBanners).where(eq(heroBanners.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Banner not found" });

        const { imageBase64, ...rest } = parsed.data;

        let imageUrl = rest.imageUrl;
        if (imageBase64) {
            imageUrl = await uploadBannerImage(imageBase64, id);
        }

        const [updated] = await db
            .update(heroBanners)
            .set({ ...rest, ...(imageUrl ? { imageUrl } : {}), updatedAt: new Date() })
            .where(eq(heroBanners.id, id))
            .returning();

        return res.json({ success: true, banner: updated });
    } catch (error) {
        console.error("Error updating hero banner:", error);
        return res.status(500).json({ success: false, message: "Failed to update banner" });
    }
};

export const deleteHeroBanner = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = req.user!.id;

        const [existing] = await db.select().from(heroBanners).where(eq(heroBanners.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Banner not found" });

        if (existing.imageUrl?.includes("supabase")) {
            try {
                const url = new URL(existing.imageUrl);
                const match = url.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)/);
                if (match) {
                    const [, bucket, filePath] = match;
                    await supabase.storage.from(bucket).remove([filePath]);
                }
            } catch {
            }
        }

        await db.delete(heroBanners).where(eq(heroBanners.id, id));

        await createAuditLog({
            entityType: "hero_banner",
            entityId: id,
            action: "delete",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { title: existing.title, imageUrl: existing.imageUrl },
            newValue: null,
        });

        return res.json({ success: true, message: "Banner deleted" });
    } catch (error) {
        console.error("Error deleting hero banner:", error);
        return res.status(500).json({ success: false, message: "Failed to delete banner" });
    }
};

export const reorderHeroBanners = async (req: Request, res: Response) => {
    try {
        const { order } = req.body as { order: Array<{ id: string; displayOrder: number }> };
        if (!Array.isArray(order)) {
            return res.status(400).json({ success: false, message: "order array required" });
        }

        await Promise.all(
            order.map(({ id, displayOrder }) =>
                db.update(heroBanners).set({ displayOrder, updatedAt: new Date() }).where(eq(heroBanners.id, id))
            )
        );

        return res.json({ success: true, message: "Reordered successfully" });
    } catch (error) {
        console.error("Error reordering banners:", error);
        return res.status(500).json({ success: false, message: "Failed to reorder banners" });
    }
};
