import { Request, Response } from "express";
import { db } from "../db";
import { 
  services, 
  platformServices, 
  serviceItems,
  serviceRequestPlatformServices 
} from "../db/schema";
import { eq, desc, and, asc, sql, count, sum, avg } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../services/auditLog";

// ============================================
// SERVICE CATEGORIES (Level 1)
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
    
    const [countResult] = await db
      .select({ count: count() })
      .from(platformServices)
      .where(eq(platformServices.serviceId, id));
    
    return res.json({ 
      success: true, 
      category,
      platformServiceCount: Number(countResult?.count || 0)
    });
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

    const linkedServices = await db
      .select()
      .from(platformServices)
      .where(eq(platformServices.serviceId, id))
      .limit(1);
    
    if (linkedServices.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Cannot delete category with existing sub-categories. Delete sub-categories first." 
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
// PLATFORM SERVICES (Level 2 - Sub-Categories)
// ============================================

// ✅ FIXED: Proper Drizzle query with conditions array
export const getAllPlatformServices = async (req: Request, res: Response) => {
  try {
    const serviceId = req.query.serviceId as string;
    
    const conditions = [];
    
    if (serviceId) {
      conditions.push(eq(platformServices.serviceId, parseInt(serviceId)));
    }
    
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await db
      .select({
        id: platformServices.id,
        serviceId: platformServices.serviceId,
        name: platformServices.name,
        description: platformServices.description,
        price: platformServices.price,
        imageUrl: platformServices.imageUrl,
        isActive: platformServices.isActive,
        isPopular: platformServices.isPopular,
        createdAt: platformServices.createdAt,
        updatedAt: platformServices.updatedAt,
        duration_minutes: platformServices.duration_minutes,
        category: platformServices.category,
        thumbnail_url: platformServices.thumbnail_url,
        is_featured: platformServices.is_featured,
        categoryName: services.serviceName,
        serviceItemsCount: sql<number>`(
          SELECT COUNT(*) FROM service_items 
          WHERE service_items.platform_service_id = platform_services.id
        )`,
      })
      .from(platformServices)
      .innerJoin(services, eq(platformServices.serviceId, services.id))
      .where(whereClause)
      .orderBy(services.id, platformServices.name);

    return res.json({ success: true, platformServices: results });
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
        isPopular: platformServices.isPopular,
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

    const [itemsCount] = await db
      .select({ count: count() })
      .from(serviceItems)
      .where(eq(serviceItems.platformServiceId, id));

    return res.json({ 
      success: true, 
      service,
      serviceItemsCount: Number(itemsCount?.count || 0)
    });
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
        isPopular: platformServices.isPopular,
        serviceItemsCount: sql<number>`(
          SELECT COUNT(*) FROM service_items 
          WHERE service_items.platform_service_id = platform_services.id
        )`,
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
// PLATFORM SERVICE SCHEMA
// ============================================
const platformServiceSchema = z.object({
  serviceId: z.number().int().positive(),
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  price: z.number().positive(),
  imageUrl: z.string().url().optional().nullable(),
  isActive: z.boolean().optional(),
  isPopular: z.boolean().optional(),
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
      isPopular: parsed.data.isPopular || false,
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
    
    return res.status(201).json({ success: true, platformService: created });
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

    const updateData: any = { updatedAt: new Date() };
    
    if (parsed.data.serviceId !== undefined) updateData.serviceId = parsed.data.serviceId;
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.price !== undefined) updateData.price = String(parsed.data.price);
    if (parsed.data.imageUrl !== undefined) updateData.imageUrl = parsed.data.imageUrl;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if (parsed.data.isPopular !== undefined) updateData.isPopular = parsed.data.isPopular;
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
    
    return res.json({ success: true, platformService: updated });
  } catch (error) {
    console.error("Error updating platform service:", error);
    return res.status(500).json({ success: false, message: "Failed to update service" });
  }
};

export const deletePlatformService = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const adminId = req.user!.id;

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
      return res.status(404).json({ 
        success: false, 
        message: "Service not found" 
      });
    }

    const [itemsCount] = await db
      .select({ count: count() })
      .from(serviceItems)
      .where(eq(serviceItems.platformServiceId, id));

    if (Number(itemsCount?.count || 0) > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete sub-category with ${itemsCount.count} service items. Delete service items first.`
      });
    }

    await db.delete(platformServices).where(eq(platformServices.id, id));

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
      message: `Service "${existing.name}" has been permanently deleted`,
    });
  } catch (error) {
    console.error("Error deleting platform service:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to delete service" 
    });
  }
};

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

    let deletedCount = 0;
    const failedIds: string[] = [];

    for (const serviceId of ids) {
      try {
        const [itemsCount] = await db
          .select({ count: count() })
          .from(serviceItems)
          .where(eq(serviceItems.platformServiceId, serviceId));

        if (Number(itemsCount?.count || 0) > 0) {
          failedIds.push(serviceId);
          continue;
        }

        const [existing] = await db
          .select({ id: platformServices.id })
          .from(platformServices)
          .where(eq(platformServices.id, serviceId))
          .limit(1);

        if (existing) {
          await db.delete(platformServices).where(eq(platformServices.id, serviceId));
          deletedCount++;
        } else {
          failedIds.push(serviceId);
        }
      } catch (err) {
        console.error(`Failed to delete service ${serviceId}:`, err);
        failedIds.push(serviceId);
      }
    }

    await createAuditLog({
      entityType: "platform_service",
      entityId: "bulk",
      action: "bulk_permanent_delete",
      performedBy: adminId,
      performedByRole: "admin",
      metadata: { deletedCount, failedIds, totalIds: ids.length },
    });

    return res.json({ 
      success: true, 
      message: `${deletedCount} service(s) permanently deleted${failedIds.length > 0 ? `, ${failedIds.length} failed` : ''}`,
      deletedCount,
      failedIds
    });
  } catch (error) {
    console.error("Error bulk deleting platform services:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to delete services" 
    });
  }
};

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
      platformService: updated 
    });
  } catch (error) {
    console.error("Error toggling platform service popular status:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to toggle popular status" 
    });
  }
};

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
      platformService: updated 
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

// ============================================
// SERVICE ITEMS (Level 3 - Individual Services)
// ============================================

const serviceItemSchema = z.object({
  platformServiceId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  price: z.number().positive(),
  durationMinutes: z.number().int().min(0).optional().nullable(),
  isActive: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  imageUrl: z.string().url().optional().nullable(),
});

export const getServiceItems = async (req: Request, res: Response) => {
  try {
    const platformServiceId = req.query.platformServiceId as string;
    const isActive = req.query.isActive === 'true' ? true : 
                     req.query.isActive === 'false' ? false : undefined;

    const conditions = [];
    
    if (platformServiceId) {
      conditions.push(eq(serviceItems.platformServiceId, platformServiceId));
    }
    
    if (isActive !== undefined) {
      conditions.push(eq(serviceItems.isActive, isActive));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db
      .select({
        id: serviceItems.id,
        platformServiceId: serviceItems.platformServiceId,
        name: serviceItems.name,
        description: serviceItems.description,
        price: serviceItems.price,
        durationMinutes: serviceItems.durationMinutes,
        isActive: serviceItems.isActive,
        isPopular: serviceItems.isPopular,
        imageUrl: serviceItems.imageUrl,
        createdAt: serviceItems.createdAt,
        updatedAt: serviceItems.updatedAt,
        platformServiceName: platformServices.name,
        categoryName: services.serviceName,
      })
      .from(serviceItems)
      .innerJoin(platformServices, eq(serviceItems.platformServiceId, platformServices.id))
      .innerJoin(services, eq(platformServices.serviceId, services.id))
      .where(whereClause)
      .orderBy(asc(serviceItems.name));

    return res.json({
      success: true,
      serviceItems: items,
    });
  } catch (error) {
    console.error("Error fetching service items:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch service items",
    });
  }
};

export const getServiceItemById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const [item] = await db
      .select({
        id: serviceItems.id,
        platformServiceId: serviceItems.platformServiceId,
        name: serviceItems.name,
        description: serviceItems.description,
        price: serviceItems.price,
        durationMinutes: serviceItems.durationMinutes,
        isActive: serviceItems.isActive,
        isPopular: serviceItems.isPopular,
        imageUrl: serviceItems.imageUrl,
        createdAt: serviceItems.createdAt,
        updatedAt: serviceItems.updatedAt,
        platformServiceName: platformServices.name,
        categoryName: services.serviceName,
      })
      .from(serviceItems)
      .innerJoin(platformServices, eq(serviceItems.platformServiceId, platformServices.id))
      .innerJoin(services, eq(platformServices.serviceId, services.id))
      .where(eq(serviceItems.id, id))
      .limit(1);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Service item not found",
      });
    }

    return res.json({
      success: true,
      serviceItem: item,
    });
  } catch (error) {
    console.error("Error fetching service item:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch service item",
    });
  }
};

export const createServiceItem = async (req: Request, res: Response) => {
  try {
    const parsed = serviceItemSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid data",
        errors: parsed.error.format(),
      });
    }

    const { platformServiceId, name, description, price, durationMinutes, isActive, isPopular, imageUrl } = parsed.data;

    const [platformService] = await db
      .select()
      .from(platformServices)
      .where(eq(platformServices.id, platformServiceId))
      .limit(1);

    if (!platformService) {
      return res.status(404).json({
        success: false,
        message: "Platform service not found",
      });
    }

    const [created] = await db
      .insert(serviceItems)
      .values({
        platformServiceId,
        name,
        description: description || null,
        price: String(price),
        durationMinutes: durationMinutes || null,
        isActive: isActive !== undefined ? isActive : true,
        isPopular: isPopular || false,
        imageUrl: imageUrl || null,
      })
      .returning();

    await createAuditLog({
      entityType: "service_item",
      entityId: created.id,
      action: "create",
      performedBy: req.user!.id,
      performedByRole: "admin",
      newValue: created,
    });

    return res.status(201).json({
      success: true,
      serviceItem: created,
    });
  } catch (error) {
    console.error("Error creating service item:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create service item",
    });
  }
};

export const updateServiceItem = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const parsed = serviceItemSchema.partial().safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid data",
        errors: parsed.error.format(),
      });
    }

    const [existing] = await db
      .select()
      .from(serviceItems)
      .where(eq(serviceItems.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Service item not found",
      });
    }

    const updateData: any = { updatedAt: new Date() };
    
    if (parsed.data.platformServiceId !== undefined) {
      const [ps] = await db
        .select()
        .from(platformServices)
        .where(eq(platformServices.id, parsed.data.platformServiceId))
        .limit(1);
      
      if (!ps) {
        return res.status(404).json({
          success: false,
          message: "Platform service not found",
        });
      }
      updateData.platformServiceId = parsed.data.platformServiceId;
    }
    
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.price !== undefined) updateData.price = String(parsed.data.price);
    if (parsed.data.durationMinutes !== undefined) updateData.durationMinutes = parsed.data.durationMinutes;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if (parsed.data.isPopular !== undefined) updateData.isPopular = parsed.data.isPopular;
    if (parsed.data.imageUrl !== undefined) updateData.imageUrl = parsed.data.imageUrl;

    const [updated] = await db
      .update(serviceItems)
      .set(updateData)
      .where(eq(serviceItems.id, id))
      .returning();

    await createAuditLog({
      entityType: "service_item",
      entityId: id,
      action: "update",
      performedBy: req.user!.id,
      performedByRole: "admin",
      oldValue: existing,
      newValue: updated,
    });

    return res.json({
      success: true,
      serviceItem: updated,
    });
  } catch (error) {
    console.error("Error updating service item:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update service item",
    });
  }
};

export const deleteServiceItem = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const adminId = req.user!.id;

    const [existing] = await db
      .select()
      .from(serviceItems)
      .where(eq(serviceItems.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Service item not found",
      });
    }

    await db.delete(serviceItems).where(eq(serviceItems.id, id));

    await createAuditLog({
      entityType: "service_item",
      entityId: id,
      action: "permanent_delete",
      performedBy: adminId,
      performedByRole: "admin",
      oldValue: existing,
      newValue: null,
    });

    return res.json({
      success: true,
      message: "Service item permanently deleted",
    });
  } catch (error) {
    console.error("Error deleting service item:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete service item",
    });
  }
};

export const bulkDeleteServiceItems = async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    const adminId = req.user!.id;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or empty service item IDs array",
      });
    }

    let deletedCount = 0;
    const failedIds: string[] = [];

    for (const itemId of ids) {
      try {
        const [existing] = await db
          .select({ id: serviceItems.id })
          .from(serviceItems)
          .where(eq(serviceItems.id, itemId))
          .limit(1);
        
        if (existing) {
          await db.delete(serviceItems).where(eq(serviceItems.id, itemId));
          deletedCount++;
        } else {
          failedIds.push(itemId);
        }
      } catch (err) {
        console.error(`Failed to delete service item ${itemId}:`, err);
        failedIds.push(itemId);
      }
    }

    await createAuditLog({
      entityType: "service_item",
      entityId: "bulk",
      action: "bulk_permanent_delete",
      performedBy: adminId,
      performedByRole: "admin",
      metadata: { deletedCount, failedIds, totalIds: ids.length },
    });

    return res.json({
      success: true,
      message: `${deletedCount} service item(s) permanently deleted${failedIds.length > 0 ? `, ${failedIds.length} failed` : ''}`,
      deletedCount,
      failedIds,
    });
  } catch (error) {
    console.error("Error bulk deleting service items:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete service items",
    });
  }
};

export const toggleServiceItemPopular = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const adminId = req.user!.id;

    const [existing] = await db
      .select()
      .from(serviceItems)
      .where(eq(serviceItems.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Service item not found",
      });
    }

    const newStatus = !existing.isPopular;
    const [updated] = await db
      .update(serviceItems)
      .set({ 
        isPopular: newStatus, 
        updatedAt: new Date() 
      })
      .where(eq(serviceItems.id, id))
      .returning();

    await createAuditLog({
      entityType: "service_item",
      entityId: id,
      action: newStatus ? "mark_popular" : "unmark_popular",
      performedBy: adminId,
      performedByRole: "admin",
      oldValue: { isPopular: existing.isPopular },
      newValue: { isPopular: newStatus },
    });

    return res.json({
      success: true,
      message: `Service item ${newStatus ? 'marked as' : 'removed from'} popular`,
      serviceItem: updated,
    });
  } catch (error) {
    console.error("Error toggling service item popular status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to toggle popular status",
    });
  }
};

export const toggleServiceItemActive = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const adminId = req.user!.id;

    const [existing] = await db
      .select()
      .from(serviceItems)
      .where(eq(serviceItems.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Service item not found",
      });
    }

    const newStatus = !existing.isActive;
    const [updated] = await db
      .update(serviceItems)
      .set({ 
        isActive: newStatus, 
        updatedAt: new Date() 
      })
      .where(eq(serviceItems.id, id))
      .returning();

    await createAuditLog({
      entityType: "service_item",
      entityId: id,
      action: newStatus ? "activate" : "deactivate",
      performedBy: adminId,
      performedByRole: "admin",
      oldValue: { isActive: existing.isActive },
      newValue: { isActive: newStatus },
    });

    return res.json({
      success: true,
      message: `Service item ${newStatus ? 'activated' : 'deactivated'}`,
      serviceItem: updated,
    });
  } catch (error) {
    console.error("Error toggling service item status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to toggle service item status",
    });
  }
};

export const getServiceItemsStats = async (req: Request, res: Response) => {
  try {
    const platformServiceId = req.query.platformServiceId as string;

    const conditions = [];
    if (platformServiceId) {
      conditions.push(eq(serviceItems.platformServiceId, platformServiceId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [stats] = await db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${serviceItems.isActive} = true)`,
        inactive: sql<number>`count(*) filter (where ${serviceItems.isActive} = false)`,
        popular: sql<number>`count(*) filter (where ${serviceItems.isPopular} = true)`,
        avgPrice: sql<string>`coalesce(avg(${serviceItems.price}), 0)`,
        minPrice: sql<string>`coalesce(min(${serviceItems.price}), 0)`,
        maxPrice: sql<string>`coalesce(max(${serviceItems.price}), 0)`,
      })
      .from(serviceItems)
      .where(whereClause);

    return res.json({
      success: true,
      stats: {
        total: Number(stats?.total || 0),
        active: Number(stats?.active || 0),
        inactive: Number(stats?.inactive || 0),
        popular: Number(stats?.popular || 0),
        avgPrice: parseFloat(stats?.avgPrice || '0'),
        minPrice: parseFloat(stats?.minPrice || '0'),
        maxPrice: parseFloat(stats?.maxPrice || '0'),
      },
    });
  } catch (error) {
    console.error("Error fetching service items stats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch service items stats",
    });
  }
};