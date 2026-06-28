// src/controllers/admin/heroBannerController.ts
import { Request, Response } from "express";
import { db } from "../../db";
import { heroBanners } from "../../db/schema";
import { eq, asc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { createAuditLog } from "../../services/auditLog";
import { logger } from "../../utils/logger";

// Initialize Supabase client conditionally
let supabase: ReturnType<typeof createClient> | null = null;

try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (supabaseUrl && supabaseKey && supabaseUrl !== 'your-supabase-url' && supabaseKey !== 'your-supabase-key') {
        supabase = createClient(supabaseUrl, supabaseKey);
        logger.info('Supabase client initialized for banners');
    } else {
        logger.warn('Supabase environment variables not properly set. Banner image upload features will use fallback mode.');
    }
} catch (error) {
    logger.error('Failed to initialize Supabase client for banners:', error);
}

// ============================================
// UPLOAD BANNER IMAGE
// ============================================

async function uploadBannerImage(base64Image: string, bannerId: string): Promise<string> {
    if (!supabase) {
        logger.warn(`[DEV] Supabase not available. Returning placeholder for banner ${bannerId}`);
        return `https://placehold.co/1200x400/1976D2/FFFFFF?text=Banner+${bannerId}`;
    }

    try {
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
    } catch (error) {
        logger.error('Banner image upload error:', error);
        return `https://placehold.co/1200x400/FF0000/FFFFFF?text=Banner+Error`;
    }
}

// ============================================
// PUBLIC ENDPOINTS
// ============================================

export const getPublicHeroBanners = async (req: Request, res: Response) => {
    try {
        const adType = req.query.adType as string;
        
        let whereCondition;
        if (adType === 'ad1') {
            whereCondition = and(
                eq(heroBanners.isActive, true),
                eq(heroBanners.adType, 'ad1')
            );
        } else if (adType === 'ad2') {
            whereCondition = and(
                eq(heroBanners.isActive, true),
                eq(heroBanners.adType, 'ad2')
            );
        } else {
            whereCondition = eq(heroBanners.isActive, true);
        }
        
        const banners = await db
            .select()
            .from(heroBanners)
            .where(whereCondition)
            .orderBy(asc(heroBanners.displayOrder));

        res.setHeader('Cache-Control', 'public, max-age=300');
        
        return res.json({ success: true, banners });
    } catch (error) {
        console.error("Error fetching hero banners:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch banners" });
    }
};

export const getBannersByAdType = async (req: Request, res: Response) => {
    try {
        const { adType } = req.params;
        
        if (!['ad1', 'ad2', 'both'].includes(adType)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid ad type. Must be 'ad1', 'ad2', or 'both'" 
            });
        }
        
        let whereCondition;
        if (adType === 'both') {
            whereCondition = eq(heroBanners.isActive, true);
        } else {
            whereCondition = and(
                eq(heroBanners.isActive, true),
                eq(heroBanners.adType, adType)
            );
        }
        
        const banners = await db
            .select()
            .from(heroBanners)
            .where(whereCondition)
            .orderBy(asc(heroBanners.displayOrder));

        res.setHeader('Cache-Control', 'public, max-age=300');
        
        return res.json({ success: true, banners });
    } catch (error) {
        console.error("Error fetching banners by ad type:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch banners" });
    }
};

// ============================================
// ADMIN ENDPOINTS
// ============================================

export const getAdminHeroBanners = async (_req: Request, res: Response) => {
    try {
        const banners = await db
            .select()
            .from(heroBanners)
            .orderBy(asc(heroBanners.displayOrder));
        return res.json({ success: true, banners });
    } catch (error) {
        console.error("Error fetching hero banners:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch banners" });
    }
};

export const getBannerStats = async (_req: Request, res: Response) => {
    try {
        const [totalCount, ad1Count, ad2Count, bothCount, activeCount] = await Promise.all([
            db.select({ count: sql<number>`count(*)` }).from(heroBanners),
            db.select({ count: sql<number>`count(*)` }).from(heroBanners).where(eq(heroBanners.adType, 'ad1')),
            db.select({ count: sql<number>`count(*)` }).from(heroBanners).where(eq(heroBanners.adType, 'ad2')),
            db.select({ count: sql<number>`count(*)` }).from(heroBanners).where(eq(heroBanners.adType, 'both')),
            db.select({ count: sql<number>`count(*)` }).from(heroBanners).where(eq(heroBanners.isActive, true)),
        ]);

        return res.json({
            success: true,
            stats: {
                total: Number(totalCount[0]?.count || 0),
                ad1: Number(ad1Count[0]?.count || 0),
                ad2: Number(ad2Count[0]?.count || 0),
                both: Number(bothCount[0]?.count || 0),
                active: Number(activeCount[0]?.count || 0),
            }
        });
    } catch (error) {
        console.error("Error fetching banner stats:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch stats" });
    }
};

// ============================================
// CREATE BANNER
// ============================================

const createBannerSchema = z.object({
    title: z.string().max(255).optional().nullable(),
    subtitle: z.string().optional().nullable(),
    imageBase64: z.string().optional(),
    imageUrl: z.string().url().optional(),
    linkUrl: z.string().url().optional().nullable(),
    displayOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    adType: z.enum(['ad1', 'ad2', 'both']).default('both'),
    videoUrl: z.string().url().optional().nullable(),
});

export const createHeroBanner = async (req: Request, res: Response): Promise<Response> => {
    try {
        const parsed = createBannerSchema.safeParse(req.body);
        if (!parsed.success) {
            console.error("Validation error:", parsed.error.format());
            return res.status(400).json({ 
                success: false, 
                message: "Invalid data", 
                errors: parsed.error.format() 
            });
        }

        const { imageBase64, imageUrl, videoUrl, adType, ...rest } = parsed.data;

        if (!imageBase64 && !imageUrl && !videoUrl) {
            return res.status(400).json({ 
                success: false, 
                message: "Either imageBase64, imageUrl, or videoUrl is required" 
            });
        }

        let finalImageUrl = imageUrl || null;
        let finalVideoUrl = videoUrl || null;

        if (imageBase64) {
            const [tempBanner] = await db.insert(heroBanners).values({
                imageUrl: "processing",
                adType: adType || 'both',
                title: rest.title || null,
                subtitle: rest.subtitle || null,
                linkUrl: rest.linkUrl || null,
                displayOrder: rest.displayOrder ?? 0,
                isActive: rest.isActive ?? true,
            }).returning();

            finalImageUrl = await uploadBannerImage(imageBase64, tempBanner.id);
            
            const [updated] = await db.update(heroBanners)
                .set({ 
                    imageUrl: finalImageUrl,
                    videoUrl: finalVideoUrl,
                })
                .where(eq(heroBanners.id, tempBanner.id))
                .returning();
            
            // ✅ Fixed: Use userId from decoded token
            await createAuditLog({
                entityType: "hero_banner",
                entityId: updated.id,
                action: "create",
                performedBy: (req as any).user?.userId || 'system',
                performedByRole: "admin",
                newValue: updated,
            });

            return res.status(201).json({ success: true, banner: updated });
        } else {
            const [banner] = await db.insert(heroBanners).values({
                imageUrl: finalImageUrl || '',
                videoUrl: finalVideoUrl,
                adType: adType || 'both',
                title: rest.title || null,
                subtitle: rest.subtitle || null,
                linkUrl: rest.linkUrl || null,
                displayOrder: rest.displayOrder ?? 0,
                isActive: rest.isActive ?? true,
            }).returning();

            // ✅ Fixed: Use userId from decoded token
            await createAuditLog({
                entityType: "hero_banner",
                entityId: banner.id,
                action: "create",
                performedBy: (req as any).user?.userId || 'system',
                performedByRole: "admin",
                newValue: banner,
            });
            
            return res.status(201).json({ success: true, banner });
        }
    } catch (error) {
        console.error("Error creating hero banner:", error);
        return res.status(500).json({ success: false, message: "Failed to create banner" });
    }
};

// ============================================
// UPDATE BANNER
// ============================================

const updateBannerSchema = z.object({
    title: z.string().max(255).optional().nullable(),
    subtitle: z.string().optional().nullable(),
    imageBase64: z.string().optional(),
    imageUrl: z.string().url().optional(),
    videoUrl: z.string().url().optional().nullable(),
    linkUrl: z.string().url().optional().nullable(),
    displayOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    adType: z.enum(['ad1', 'ad2', 'both']).optional(),
});

export const updateHeroBanner = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const parsed = updateBannerSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid data", 
                errors: parsed.error.format() 
            });
        }

        const [existing] = await db.select().from(heroBanners).where(eq(heroBanners.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Banner not found" });

        const { imageBase64, imageUrl, videoUrl, adType, ...rest } = parsed.data;

        let finalImageUrl = existing.imageUrl;
        let finalVideoUrl = existing.videoUrl;

        if (imageBase64) {
            finalImageUrl = await uploadBannerImage(imageBase64, id);
        } else if (imageUrl) {
            finalImageUrl = imageUrl;
        }
        
        if (videoUrl !== undefined) {
            finalVideoUrl = videoUrl;
        }

        const updateData: any = {
            ...rest,
            updatedAt: new Date(),
        };
        
        if (finalImageUrl) updateData.imageUrl = finalImageUrl;
        if (finalVideoUrl !== undefined) updateData.videoUrl = finalVideoUrl;
        if (adType) updateData.adType = adType;

        const [updated] = await db.update(heroBanners)
            .set(updateData)
            .where(eq(heroBanners.id, id))
            .returning();

        // ✅ Fixed: Use userId from decoded token
        await createAuditLog({
            entityType: "hero_banner",
            entityId: id,
            action: "update",
            performedBy: (req as any).user?.userId || 'system',
            performedByRole: "admin",
            oldValue: existing,
            newValue: updated,
        });

        return res.json({ success: true, banner: updated });
    } catch (error) {
        console.error("Error updating hero banner:", error);
        return res.status(500).json({ success: false, message: "Failed to update banner" });
    }
};

// ============================================
// BULK DELETE BANNERS
// ============================================

export const bulkDeleteHeroBanners = async (req: Request, res: Response) => {
    try {
        const { ids } = req.body;
        // ✅ Fixed: Use userId from decoded token
        const adminId = (req as any).user?.userId;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Array of banner IDs is required" 
            });
        }

        let deletedCount = 0;
        for (const id of ids) {
            const [existing] = await db.select().from(heroBanners).where(eq(heroBanners.id, id)).limit(1);
            if (existing) {
                if (existing.imageUrl?.includes("supabase") && supabase) {
                    try {
                        const url = new URL(existing.imageUrl);
                        const match = url.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)/);
                        if (match) {
                            const [, bucket, filePath] = match;
                            await supabase.storage.from(bucket).remove([filePath]);
                        }
                    } catch (error) {
                        console.error("Error deleting from storage:", error);
                    }
                }
                await db.delete(heroBanners).where(eq(heroBanners.id, id));
                deletedCount++;
            }
        }

        // ✅ Fixed: Use userId from decoded token
        await createAuditLog({
            entityType: "hero_banner",
            entityId: "bulk",
            action: "bulk_delete",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            newValue: { deletedCount, ids },
        });

        return res.json({ 
            success: true, 
            message: `${deletedCount} banners deleted successfully`,
            deletedCount
        });
    } catch (error) {
        console.error("Error bulk deleting banners:", error);
        return res.status(500).json({ success: false, message: "Failed to delete banners" });
    }
};

// ============================================
// DUPLICATE BANNER
// ============================================

export const duplicateHeroBanner = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        // ✅ Fixed: Use userId from decoded token
        const adminId = (req as any).user?.userId;

        const [existing] = await db.select().from(heroBanners).where(eq(heroBanners.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Banner not found" });

        const maxOrderResult = await db
            .select({ maxOrder: sql<number>`max(${heroBanners.displayOrder})` })
            .from(heroBanners);
        const maxOrder = maxOrderResult[0]?.maxOrder ?? 0;

        const [duplicated] = await db.insert(heroBanners).values({
            title: `${existing.title} (Copy)`,
            subtitle: existing.subtitle,
            imageUrl: existing.imageUrl,
            videoUrl: existing.videoUrl,
            linkUrl: existing.linkUrl,
            adType: existing.adType,
            isActive: false,
            displayOrder: maxOrder + 1,
        }).returning();

        // ✅ Fixed: Use userId from decoded token
        await createAuditLog({
            entityType: "hero_banner",
            entityId: duplicated.id,
            action: "duplicate",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            newValue: { originalId: id, title: duplicated.title },
        });

        return res.status(201).json({ success: true, banner: duplicated });
    } catch (error) {
        console.error("Error duplicating hero banner:", error);
        return res.status(500).json({ success: false, message: "Failed to duplicate banner" });
    }
};

// ============================================
// DELETE BANNER
// ============================================

export const deleteHeroBanner = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        // ✅ Fixed: Use userId from decoded token
        const adminId = (req as any).user?.userId;

        const [existing] = await db.select().from(heroBanners).where(eq(heroBanners.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Banner not found" });

        if (existing.imageUrl?.includes("supabase") && supabase) {
            try {
                const url = new URL(existing.imageUrl);
                const match = url.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)/);
                if (match) {
                    const [, bucket, filePath] = match;
                    await supabase.storage.from(bucket).remove([filePath]);
                }
            } catch (error) {
                console.error("Error deleting from storage:", error);
            }
        }

        await db.delete(heroBanners).where(eq(heroBanners.id, id));

        // ✅ Fixed: Use userId from decoded token
        await createAuditLog({
            entityType: "hero_banner",
            entityId: id,
            action: "delete",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            oldValue: { title: existing.title, imageUrl: existing.imageUrl, adType: existing.adType },
            newValue: null,
        });

        return res.json({ success: true, message: "Banner deleted" });
    } catch (error) {
        console.error("Error deleting hero banner:", error);
        return res.status(500).json({ success: false, message: "Failed to delete banner" });
    }
};

// ============================================
// REORDER BANNERS
// ============================================

export const reorderHeroBanners = async (req: Request, res: Response) => {
    try {
        const { order } = req.body as { order: Array<{ id: string; displayOrder: number }> };
        if (!Array.isArray(order)) {
            return res.status(400).json({ success: false, message: "order array required" });
        }

        for (const { id, displayOrder } of order) {
            await db.update(heroBanners)
                .set({ displayOrder, updatedAt: new Date() })
                .where(eq(heroBanners.id, id));
        }

        // ✅ Fixed: Use userId from decoded token
        await createAuditLog({
            entityType: "hero_banner",
            entityId: "reorder",
            action: "reorder",
            performedBy: (req as any).user?.userId || 'system',
            performedByRole: "admin",
            metadata: { order },
        });

        return res.json({ success: true, message: "Reordered successfully" });
    } catch (error) {
        console.error("Error reordering banners:", error);
        return res.status(500).json({ success: false, message: "Failed to reorder banners" });
    }
};

// ============================================
// TOGGLE BANNER ACTIVE
// ============================================

export const toggleBannerActive = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        // ✅ Fixed: Use userId from decoded token
        const adminId = (req as any).user?.userId;

        const [existing] = await db.select().from(heroBanners).where(eq(heroBanners.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Banner not found" });

        const newStatus = !existing.isActive;
        const [updated] = await db.update(heroBanners)
            .set({ isActive: newStatus, updatedAt: new Date() })
            .where(eq(heroBanners.id, id))
            .returning();

        // ✅ Fixed: Use userId from decoded token
        await createAuditLog({
            entityType: "hero_banner",
            entityId: id,
            action: newStatus ? "activate" : "deactivate",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            oldValue: { isActive: existing.isActive },
            newValue: { isActive: newStatus },
        });

        return res.json({ 
            success: true, 
            banner: updated,
            message: `Banner ${newStatus ? 'activated' : 'deactivated'} successfully`
        });
    } catch (error) {
        console.error("Error toggling banner status:", error);
        return res.status(500).json({ success: false, message: "Failed to toggle banner status" });
    }
};