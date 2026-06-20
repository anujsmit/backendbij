// backend/src/controllers/serviceItemsController.ts
import { Request, Response } from "express";
import { db } from "../db";
import { serviceItems, platformServices } from "../db/schema";
import { eq, and, desc, asc, sql, count } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../services/auditLog";

// ============================================
// SCHEMA
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

const updateServiceItemSchema = serviceItemSchema.partial();

// ============================================
// GET SERVICE ITEMS BY PLATFORM SERVICE ID
// ============================================

export const getServiceItems = async (req: Request, res: Response) => {
  try {
    const platformServiceId = req.query.platformServiceId as string;
    const isActive = req.query.isActive === 'true' ? true : 
                     req.query.isActive === 'false' ? false : undefined;

    if (!platformServiceId) {
      return res.status(400).json({
        success: false,
        message: "platformServiceId query parameter is required",
      });
    }

    const conditions = [eq(serviceItems.platformServiceId, platformServiceId)];
    
    if (isActive !== undefined) {
      conditions.push(eq(serviceItems.isActive, isActive));
    }

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
      })
      .from(serviceItems)
      .leftJoin(platformServices, eq(serviceItems.platformServiceId, platformServices.id))
      .where(and(...conditions))
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

// ============================================
// GET SERVICE ITEM BY ID
// ============================================

export const getServiceItemById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const item = await db
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
      })
      .from(serviceItems)
      .leftJoin(platformServices, eq(serviceItems.platformServiceId, platformServices.id))
      .where(eq(serviceItems.id, id))
      .limit(1);

    if (!item || item.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Service item not found",
      });
    }

    return res.json({
      success: true,
      serviceItem: item[0],
    });
  } catch (error) {
    console.error("Error fetching service item:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch service item",
    });
  }
};

// ============================================
// CREATE SERVICE ITEM
// ============================================

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

    // Verify platform service exists
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

// ============================================
// UPDATE SERVICE ITEM
// ============================================

export const updateServiceItem = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const parsed = updateServiceItemSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid data",
        errors: parsed.error.format(),
      });
    }

    // Check if service item exists
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
      // Verify platform service exists
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

// ============================================
// DELETE SERVICE ITEM
// ============================================

export const deleteServiceItem = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const adminId = req.user!.id;

    // Check if service item exists
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

// ============================================
// BULK DELETE SERVICE ITEMS
// ============================================

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

// ============================================
// TOGGLE POPULAR STATUS
// ============================================

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

// ============================================
// TOGGLE ACTIVE STATUS
// ============================================

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

// ============================================
// GET SERVICE ITEMS STATS
// ============================================

export const getServiceItemsStats = async (req: Request, res: Response) => {
  try {
    const platformServiceId = req.query.platformServiceId as string;

    const conditions = [];
    if (platformServiceId) {
      conditions.push(eq(serviceItems.platformServiceId, platformServiceId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const stats = await db
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

    const result = stats[0] || { total: 0, active: 0, inactive: 0, popular: 0, avgPrice: '0', minPrice: '0', maxPrice: '0' };

    return res.json({
      success: true,
      stats: {
        total: Number(result.total || 0),
        active: Number(result.active || 0),
        inactive: Number(result.inactive || 0),
        popular: Number(result.popular || 0),
        avgPrice: parseFloat(result.avgPrice || '0'),
        minPrice: parseFloat(result.minPrice || '0'),
        maxPrice: parseFloat(result.maxPrice || '0'),
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