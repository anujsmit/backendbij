import { Request, Response } from "express";
import { db } from "../db";
import { services, platformServices, serviceRequestPlatformServices } from "../db/schema";
import { eq, desc, and, asc } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../services/auditLog";

// ============================================
// SERVICE CATEGORIES
// ============================================

export const getAllServiceCategories = async (_req: Request, res: Response) => {
    try {
        const all = await db.select().from(services).orderBy(services.id);
        return res.json({ success: true, categories: all });
    } catch (error) {
        console.error("Error fetching service categories:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch categories" });
    }
};

export const getServiceCategoryById = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string);
        const [category] = await db.select().from(services).where(eq(services.id, id)).limit(1);
        
        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }
        
        return res.json({ success: true, category });
    } catch (error) {
        console.error("Error fetching service category:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch category" });
    }
};

const serviceCategorySchema = z.object({
    serviceName: z.string().min(1).max(100),
    description: z.string().optional(),
    mapIconColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    isActive: z.boolean().optional(),
    iconType: z.string().optional(),
    iconName: z.string().optional().nullable(),
    customIconUrl: z.string().url().optional().nullable(),
    iconColor: z.string().optional(),
});

export const createServiceCategory = async (req: Request, res: Response) => {
    try {
        const parsed = serviceCategorySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid data", 
                errors: parsed.error.format() 
            });
        }
        
        const [created] = await db.insert(services).values(parsed.data).returning();
        
        await createAuditLog({
            entityType: "service_category",
            entityId: String(created.id),
            action: "create",
            performedBy: req.user!.id,
            performedByRole: "admin",
            newValue: created,
        });
        
        return res.status(201).json({ success: true, category: created });
    } catch (error) {
        console.error("Error creating service category:", error);
        return res.status(500).json({ success: false, message: "Failed to create category" });
    }
};

export const updateServiceCategory = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string);
        const parsed = serviceCategorySchema.partial().safeParse(req.body);
        
        if (!parsed.success) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid data", 
                errors: parsed.error.format() 
            });
        }
        
        const [existing] = await db.select().from(services).where(eq(services.id, id)).limit(1);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        const [updated] = await db.update(services).set(parsed.data).where(eq(services.id, id)).returning();
        
        await createAuditLog({
            entityType: "service_category",
            entityId: String(id),
            action: "update",
            performedBy: req.user!.id,
            performedByRole: "admin",
            oldValue: existing,
            newValue: updated,
        });
        
        return res.json({ success: true, category: updated });
    } catch (error) {
        console.error("Error updating service category:", error);
        return res.status(500).json({ success: false, message: "Failed to update category" });
    }
};

export const deleteServiceCategory = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string);
        const [existing] = await db.select().from(services).where(eq(services.id, id)).limit(1);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        // Check if there are platform services using this category
        const linkedServices = await db
            .select()
            .from(platformServices)
            .where(eq(platformServices.serviceId, id))
            .limit(1);
        
        if (linkedServices.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Cannot delete category with existing platform services. Delete or reassign services first." 
            });
        }

        await db.delete(services).where(eq(services.id, id));
        
        await createAuditLog({
            entityType: "service_category",
            entityId: String(id),
            action: "delete",
            performedBy: req.user!.id,
            performedByRole: "admin",
            oldValue: existing,
        });
        
        return res.json({ success: true, message: "Category deleted successfully" });
    } catch (error) {
        console.error("Error deleting service category:", error);
        return res.status(500).json({ success: false, message: "Failed to delete category" });
    }
};

// ============================================
// PLATFORM SERVICES
// ============================================

export const getAllPlatformServices = async (_req: Request, res: Response) => {
    try {
        const all = await db
            .select({
                id: platformServices.id,
                serviceId: platformServices.serviceId,
                name: platformServices.name,
                description: platformServices.description,
                price: platformServices.price,
                imageUrl: platformServices.imageUrl,
                isActive: platformServices.isActive,
                isPopular: platformServices.isPopular, // ✅ ADDED
                createdAt: platformServices.createdAt,
                updatedAt: platformServices.updatedAt,
                duration_minutes: platformServices.duration_minutes,
                category: platformServices.category,
                thumbnail_url: platformServices.thumbnail_url,
                is_featured: platformServices.is_featured,
                categoryName: services.serviceName,
            })
            .from(platformServices)
            .innerJoin(services, eq(platformServices.serviceId, services.id))
            .orderBy(services.id, platformServices.name);

        return res.json({ success: true, services: all });
    } catch (error) {
        console.error("Error fetching platform services:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch services" });
    }
};

export const getPlatformServiceById = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const [service] = await db
            .select({
                id: platformServices.id,
                serviceId: platformServices.serviceId,
                name: platformServices.name,
                description: platformServices.description,
                price: platformServices.price,
                imageUrl: platformServices.imageUrl,
                isActive: platformServices.isActive,
                isPopular: platformServices.isPopular, // ✅ ADDED
                duration_minutes: platformServices.duration_minutes,
                createdAt: platformServices.createdAt,
                updatedAt: platformServices.updatedAt,
                categoryName: services.serviceName,
            })
            .from(platformServices)
            .innerJoin(services, eq(platformServices.serviceId, services.id))
            .where(eq(platformServices.id, id))
            .limit(1);
        
        if (!service) {
            return res.status(404).json({ success: false, message: "Service not found" });
        }
        
        return res.json({ success: true, service });
    } catch (error) {
        console.error("Error fetching platform service:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch service" });
    }
};

export const getPlatformServicesByCategory = async (req: Request, res: Response) => {
    try {
        const { categoryId } = req.params;

        if (!categoryId) {
            return res.status(400).json({
                success: false,
                message: "Category ID is required",
            });
        }

        const categoryServices = await db
            .select({
                id: platformServices.id,
                name: platformServices.name,
                description: platformServices.description,
                price: platformServices.price,
                imageUrl: platformServices.imageUrl,
                duration_minutes: platformServices.duration_minutes,
                isActive: platformServices.isActive,
                isPopular: platformServices.isPopular, // ✅ ADDED
            })
            .from(platformServices)
            .where(
                and(
                    eq(platformServices.serviceId, parseInt(categoryId)),
                    eq(platformServices.isActive, true)
                )
            )
            .orderBy(asc(platformServices.name));

        const [categoryInfo] = await db
            .select({
                id: services.id,
                name: services.serviceName,
                description: services.description,
                iconUrl: services.customIconUrl,
                iconColor: services.iconColor,
            })
            .from(services)
            .where(eq(services.id, parseInt(categoryId)))
            .limit(1);

        return res.json({
            success: true,
            category: categoryInfo,
            services: categoryServices,
        });
    } catch (error) {
        console.error("Error fetching platform services by category:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch platform services",
        });
    }
};

export const getPlatformServicesStats = async (_req: Request, res: Response) => {
    try {
        const allServices = await db
            .select({
                id: platformServices.id,
                isActive: platformServices.isActive,
                serviceId: platformServices.serviceId,
            })
            .from(platformServices);

        const totalCount = allServices.length;
        const activeCount = allServices.filter(s => s.isActive).length;
        const inactiveCount = totalCount - activeCount;

        const servicesByCategory = await db
            .select({
                categoryId: platformServices.serviceId,
                categoryName: services.serviceName,
                count: platformServices.id,
            })
            .from(platformServices)
            .innerJoin(services, eq(platformServices.serviceId, services.id))
            .groupBy(platformServices.serviceId, services.serviceName);

        const categoryStats = servicesByCategory.map(item => ({
            categoryId: item.categoryId,
            categoryName: item.categoryName,
            count: item.count,
        }));

        return res.json({
            success: true,
            stats: {
                total: totalCount,
                active: activeCount,
                inactive: inactiveCount,
                byCategory: categoryStats,
            },
        });
    } catch (error) {
        console.error("Error fetching platform services stats:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Failed to fetch service statistics" 
        });
    }
};

// ============================================
// PLATFORM SERVICE SCHEMA WITH ISPOPULAR
// ============================================
const platformServiceSchema = z.object({
    serviceId: z.number().int().positive(),
    name: z.string().min(1).max(255),
    description: z.string().optional().nullable(),
    price: z.number().positive(),
    imageUrl: z.string().url().optional().nullable(),
    isActive: z.boolean().optional(),
    isPopular: z.boolean().optional(), // ✅ ADDED
    duration_minutes: z.number().int().min(0).optional().nullable(),
    category: z.string().optional().nullable(),
    thumbnail_url: z.string().url().optional().nullable(),
    is_featured: z.boolean().optional(),
});

export const createPlatformService = async (req: Request, res: Response) => {
    try {
        const parsed = platformServiceSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid data", 
                errors: parsed.error.format() 
            });
        }
        
        const [created] = await db.insert(platformServices).values({
            serviceId: parsed.data.serviceId,
            name: parsed.data.name,
            description: parsed.data.description || null,
            price: String(parsed.data.price),
            imageUrl: parsed.data.imageUrl || null,
            isActive: parsed.data.isActive !== undefined ? parsed.data.isActive : true,
            isPopular: parsed.data.isPopular || false, // ✅ ADDED
            duration_minutes: parsed.data.duration_minutes || null,
            category: parsed.data.category || null,
            thumbnail_url: parsed.data.thumbnail_url || null,
            is_featured: parsed.data.is_featured || false,
        }).returning();
        
        await createAuditLog({
            entityType: "platform_service",
            entityId: created.id,
            action: "create",
            performedBy: req.user!.id,
            performedByRole: "admin",
            newValue: created,
        });
        
        return res.status(201).json({ success: true, service: created });
    } catch (error) {
        console.error("Error creating platform service:", error);
        return res.status(500).json({ success: false, message: "Failed to create service" });
    }
};

export const updatePlatformService = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const parsed = platformServiceSchema.partial().safeParse(req.body);
        
        if (!parsed.success) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid data", 
                errors: parsed.error.format() 
            });
        }
        
        const [existing] = await db
            .select()
            .from(platformServices)
            .where(eq(platformServices.id, id))
            .limit(1);
            
        if (!existing) {
            return res.status(404).json({ success: false, message: "Service not found" });
        }

        const updateData: any = { 
            updatedAt: new Date() 
        };
        
        if (parsed.data.serviceId !== undefined) updateData.serviceId = parsed.data.serviceId;
        if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
        if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
        if (parsed.data.price !== undefined) updateData.price = String(parsed.data.price);
        if (parsed.data.imageUrl !== undefined) updateData.imageUrl = parsed.data.imageUrl;
        if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
        if (parsed.data.isPopular !== undefined) updateData.isPopular = parsed.data.isPopular; // ✅ ADDED
        if (parsed.data.duration_minutes !== undefined) updateData.duration_minutes = parsed.data.duration_minutes;
        if (parsed.data.category !== undefined) updateData.category = parsed.data.category;
        if (parsed.data.thumbnail_url !== undefined) updateData.thumbnail_url = parsed.data.thumbnail_url;
        if (parsed.data.is_featured !== undefined) updateData.is_featured = parsed.data.is_featured;

        const [updated] = await db
            .update(platformServices)
            .set(updateData)
            .where(eq(platformServices.id, id))
            .returning();
        
        await createAuditLog({
            entityType: "platform_service",
            entityId: id,
            action: "update",
            performedBy: req.user!.id,
            performedByRole: "admin",
            oldValue: existing,
            newValue: updated,
        });
        
        return res.json({ success: true, service: updated });
    } catch (error) {
        console.error("Error updating platform service:", error);
        return res.status(500).json({ success: false, message: "Failed to update service" });
    }
};

// ============================================
// PERMANENT DELETE - Works with ON DELETE CASCADE
// ============================================
export const deletePlatformService = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = req.user!.id;

        console.log(`[DELETE] Attempting to delete service with ID: ${id}`);

        // Check if service exists
        const [existing] = await db
            .select({
                id: platformServices.id,
                name: platformServices.name,
                serviceId: platformServices.serviceId,
            })
            .from(platformServices)
            .where(eq(platformServices.id, id))
            .limit(1);
            
        if (!existing) {
            console.log(`[DELETE] Service not found: ${id}`);
            return res.status(404).json({ 
                success: false, 
                message: "Service not found" 
            });
        }

        console.log(`[DELETE] Found service: ${existing.name}, deleting...`);

        // With ON DELETE CASCADE, this will automatically delete related records
        // in service_request_platform_services
        const result = await db
            .delete(platformServices)
            .where(eq(platformServices.id, id))
            .returning({ deletedId: platformServices.id });

        if (result.length === 0) {
            console.log(`[DELETE] No rows affected`);
            return res.status(404).json({ 
                success: false, 
                message: "Service could not be deleted" 
            });
        }

        console.log(`[DELETE] ✅ Successfully deleted service: ${existing.name}`);

        await createAuditLog({
            entityType: "platform_service",
            entityId: id,
            action: "permanent_delete",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: existing,
            newValue: null,
        });

        return res.json({ 
            success: true, 
            message: `Service "${existing.name}" has been PERMANENTLY deleted`,
            deletedService: { id, name: existing.name }
        });
    } catch (error) {
        console.error("[DELETE] Error:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Failed to delete service: " + (error as Error).message
        });
    }
};

// ============================================
// BULK PERMANENT DELETE
// ============================================
export const bulkDeletePlatformServices = async (req: Request, res: Response) => {
    try {
        const { ids } = req.body;
        const adminId = req.user!.id;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid or empty service IDs array" 
            });
        }

        console.log(`[BULK DELETE] Deleting ${ids.length} services:`, ids);

        let deletedCount = 0;
        const failedIds: string[] = [];

        for (const serviceId of ids) {
            try {
                // Check if service exists
                const [existing] = await db
                    .select({ id: platformServices.id })
                    .from(platformServices)
                    .where(eq(platformServices.id, serviceId))
                    .limit(1);

                if (existing) {
                    await db
                        .delete(platformServices)
                        .where(eq(platformServices.id, serviceId));
                    deletedCount++;
                } else {
                    failedIds.push(serviceId);
                }
            } catch (err) {
                console.error(`Failed to delete service ${serviceId}:`, err);
                failedIds.push(serviceId);
            }
        }

        console.log(`[BULK DELETE] ✅ Deleted ${deletedCount} services, Failed: ${failedIds.length}`);

        // Log the bulk deletion for audit
        await createAuditLog({
            entityType: "platform_service",
            entityId: "bulk",
            action: "bulk_permanent_delete",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { count: ids.length, ids },
            newValue: null,
            metadata: { deletedCount, failedIds }
        });

        return res.json({ 
            success: true, 
            message: `${deletedCount} service(s) permanently deleted${failedIds.length > 0 ? `, ${failedIds.length} failed` : ''}`,
            deletedCount,
            failedIds
        });
    } catch (error) {
        console.error("[BULK DELETE] Error:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Failed to delete services: " + (error as Error).message
        });
    }
};

// ============================================
// TOGGLE POPULAR STATUS - NEW FUNCTION
// ============================================
export const togglePlatformServicePopular = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = req.user!.id;

        const [existing] = await db
            .select()
            .from(platformServices)
            .where(eq(platformServices.id, id))
            .limit(1);
            
        if (!existing) {
            return res.status(404).json({ 
                success: false, 
                message: "Service not found" 
            });
        }

        const newStatus = !existing.isPopular;
        const [updated] = await db
            .update(platformServices)
            .set({ 
                isPopular: newStatus, 
                updatedAt: new Date() 
            })
            .where(eq(platformServices.id, id))
            .returning();

        await createAuditLog({
            entityType: "platform_service",
            entityId: id,
            action: newStatus ? "mark_popular" : "unmark_popular",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { isPopular: existing.isPopular },
            newValue: { isPopular: newStatus },
        });

        return res.json({ 
            success: true, 
            message: `Service "${existing.name}" has been ${newStatus ? 'marked as' : 'removed from'} popular`,
            service: updated 
        });
    } catch (error) {
        console.error("Error toggling platform service popular status:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Failed to toggle popular status" 
        });
    }
};

// ============================================
// TOGGLE ACTIVE STATUS (Soft toggle)
// ============================================
export const togglePlatformServiceActive = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = req.user!.id;

        const [existing] = await db
            .select()
            .from(platformServices)
            .where(eq(platformServices.id, id))
            .limit(1);
            
        if (!existing) {
            return res.status(404).json({ 
                success: false, 
                message: "Service not found" 
            });
        }

        const newStatus = !existing.isActive;
        const [updated] = await db
            .update(platformServices)
            .set({ 
                isActive: newStatus, 
                updatedAt: new Date() 
            })
            .where(eq(platformServices.id, id))
            .returning();

        await createAuditLog({
            entityType: "platform_service",
            entityId: id,
            action: newStatus ? "activate" : "deactivate",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { isActive: existing.isActive },
            newValue: { isActive: newStatus },
        });

        return res.json({ 
            success: true, 
            message: `Service "${existing.name}" has been ${newStatus ? 'activated' : 'deactivated'}`,
            service: updated 
        });
    } catch (error) {
        console.error("Error toggling platform service status:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Failed to toggle service status" 
        });
    }
};

export const deactivatePlatformService = togglePlatformServiceActive;
export const reactivatePlatformService = togglePlatformServiceActive;