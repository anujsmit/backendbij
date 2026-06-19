import { Request, Response } from "express";
import { db } from "../db";
import { sql, eq, and, desc, asc } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../services/auditLog";

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

    const conditions = [eq(sql`service_items.platform_service_id`, platformServiceId)];
    
    if (isActive !== undefined) {
      conditions.push(eq(sql`service_items.is_active`, isActive));
    }

    const items = await db.execute(sql`
      SELECT 
        si.id,
        si.platform_service_id as "platformServiceId",
        si.name,
        si.description,
        si.price,
        si.duration_minutes as "durationMinutes",
        si.is_active as "isActive",
        si.is_popular as "isPopular",
        si.image_url as "imageUrl",
        si.created_at as "createdAt",
        si.updated_at as "updatedAt",
        ps.name as "platformServiceName"
      FROM service_items si
      LEFT JOIN platform_services ps ON ps.id = si.platform_service_id
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY si.name ASC
    `);

    return res.json({
      success: true,
      serviceItems: items.rows,
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

    const [item] = await db.execute(sql`
      SELECT 
        si.id,
        si.platform_service_id as "platformServiceId",
        si.name,
        si.description,
        si.price,
        si.duration_minutes as "durationMinutes",
        si.is_active as "isActive",
        si.is_popular as "isPopular",
        si.image_url as "imageUrl",
        si.created_at as "createdAt",
        si.updated_at as "updatedAt",
        ps.name as "platformServiceName",
        ps.service_id as "serviceId",
        s.service_name as "categoryName"
      FROM service_items si
      LEFT JOIN platform_services ps ON ps.id = si.platform_service_id
      LEFT JOIN services s ON s.id = ps.service_id
      WHERE si.id = ${id}
      LIMIT 1
    `);

    if (!item || item.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Service item not found",
      });
    }

    return res.json({
      success: true,
      serviceItem: item.rows[0],
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
    const [platformService] = await db.execute(sql`
      SELECT id FROM platform_services WHERE id = ${platformServiceId}
    `);

    if (!platformService || platformService.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Platform service not found",
      });
    }

    const [created] = await db.execute(sql`
      INSERT INTO service_items (
        platform_service_id,
        name,
        description,
        price,
        duration_minutes,
        is_active,
        is_popular,
        image_url,
        created_at,
        updated_at
      ) VALUES (
        ${platformServiceId},
        ${name},
        ${description || null},
        ${price.toString()},
        ${durationMinutes || null},
        ${isActive !== undefined ? isActive : true},
        ${isPopular || false},
        ${imageUrl || null},
        NOW(),
        NOW()
      )
      RETURNING *
    `);

    await createAuditLog({
      entityType: "service_item",
      entityId: created.rows[0].id,
      action: "create",
      performedBy: req.user!.id,
      performedByRole: "admin",
      newValue: created.rows[0],
    });

    return res.status(201).json({
      success: true,
      serviceItem: created.rows[0],
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
    const [existing] = await db.execute(sql`
      SELECT * FROM service_items WHERE id = ${id}
    `);

    if (!existing || existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Service item not found",
      });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (parsed.data.platformServiceId !== undefined) {
      // Verify platform service exists
      const [ps] = await db.execute(sql`
        SELECT id FROM platform_services WHERE id = ${parsed.data.platformServiceId}
      `);
      if (!ps || ps.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Platform service not found",
        });
      }
      updates.push(`platform_service_id = $${paramIndex++}`);
      values.push(parsed.data.platformServiceId);
    }
    
    if (parsed.data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(parsed.data.name);
    }
    
    if (parsed.data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(parsed.data.description || null);
    }
    
    if (parsed.data.price !== undefined) {
      updates.push(`price = $${paramIndex++}`);
      values.push(parsed.data.price.toString());
    }
    
    if (parsed.data.durationMinutes !== undefined) {
      updates.push(`duration_minutes = $${paramIndex++}`);
      values.push(parsed.data.durationMinutes || null);
    }
    
    if (parsed.data.isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(parsed.data.isActive);
    }
    
    if (parsed.data.isPopular !== undefined) {
      updates.push(`is_popular = $${paramIndex++}`);
      values.push(parsed.data.isPopular);
    }
    
    if (parsed.data.imageUrl !== undefined) {
      updates.push(`image_url = $${paramIndex++}`);
      values.push(parsed.data.imageUrl || null);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const query = sql`
      UPDATE service_items 
      SET ${sql.raw(updates.join(', '))}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    // Rebuild the query with proper parameters
    const [updated] = await db.execute(sql`
      UPDATE service_items 
      SET 
        platform_service_id = COALESCE(${parsed.data.platformServiceId || null}, platform_service_id),
        name = COALESCE(${parsed.data.name || null}, name),
        description = COALESCE(${parsed.data.description || null}, description),
        price = COALESCE(${parsed.data.price ? parsed.data.price.toString() : null}, price),
        duration_minutes = COALESCE(${parsed.data.durationMinutes || null}, duration_minutes),
        is_active = COALESCE(${parsed.data.isActive !== undefined ? parsed.data.isActive : null}, is_active),
        is_popular = COALESCE(${parsed.data.isPopular !== undefined ? parsed.data.isPopular : null}, is_popular),
        image_url = COALESCE(${parsed.data.imageUrl || null}, image_url),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);

    await createAuditLog({
      entityType: "service_item",
      entityId: id,
      action: "update",
      performedBy: req.user!.id,
      performedByRole: "admin",
      oldValue: existing.rows[0],
      newValue: updated.rows[0],
    });

    return res.json({
      success: true,
      serviceItem: updated.rows[0],
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
    const [existing] = await db.execute(sql`
      SELECT * FROM service_items WHERE id = ${id}
    `);

    if (!existing || existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Service item not found",
      });
    }

    await db.execute(sql`
      DELETE FROM service_items WHERE id = ${id}
    `);

    await createAuditLog({
      entityType: "service_item",
      entityId: id,
      action: "permanent_delete",
      performedBy: adminId,
      performedByRole: "admin",
      oldValue: existing.rows[0],
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
        const [existing] = await db.execute(sql`
          SELECT id FROM service_items WHERE id = ${itemId}
        `);
        
        if (existing && existing.rows.length > 0) {
          await db.execute(sql`
            DELETE FROM service_items WHERE id = ${itemId}
          `);
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

    const [existing] = await db.execute(sql`
      SELECT * FROM service_items WHERE id = ${id}
    `);

    if (!existing || existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Service item not found",
      });
    }

    const newStatus = !existing.rows[0].is_popular;

    const [updated] = await db.execute(sql`
      UPDATE service_items 
      SET 
        is_popular = ${newStatus},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);

    await createAuditLog({
      entityType: "service_item",
      entityId: id,
      action: newStatus ? "mark_popular" : "unmark_popular",
      performedBy: adminId,
      performedByRole: "admin",
      oldValue: { isPopular: existing.rows[0].is_popular },
      newValue: { isPopular: newStatus },
    });

    return res.json({
      success: true,
      message: `Service item ${newStatus ? 'marked as' : 'removed from'} popular`,
      serviceItem: updated.rows[0],
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

    const [existing] = await db.execute(sql`
      SELECT * FROM service_items WHERE id = ${id}
    `);

    if (!existing || existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Service item not found",
      });
    }

    const newStatus = !existing.rows[0].is_active;

    const [updated] = await db.execute(sql`
      UPDATE service_items 
      SET 
        is_active = ${newStatus},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);

    await createAuditLog({
      entityType: "service_item",
      entityId: id,
      action: newStatus ? "activate" : "deactivate",
      performedBy: adminId,
      performedByRole: "admin",
      oldValue: { isActive: existing.rows[0].is_active },
      newValue: { isActive: newStatus },
    });

    return res.json({
      success: true,
      message: `Service item ${newStatus ? 'activated' : 'deactivated'}`,
      serviceItem: updated.rows[0],
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

    let whereClause = "";
    if (platformServiceId) {
      whereClause = `WHERE platform_service_id = '${platformServiceId}'`;
    }

    const [stats] = await db.execute(sql`
      SELECT 
        COUNT(*) as "total",
        COUNT(*) FILTER (WHERE is_active = true) as "active",
        COUNT(*) FILTER (WHERE is_active = false) as "inactive",
        COUNT(*) FILTER (WHERE is_popular = true) as "popular",
        COALESCE(AVG(price), 0) as "avgPrice",
        COALESCE(MIN(price), 0) as "minPrice",
        COALESCE(MAX(price), 0) as "maxPrice"
      FROM service_items
      ${whereClause ? sql.raw(whereClause) : sql``}
    `);

    return res.json({
      success: true,
      stats: stats.rows[0] || { total: 0, active: 0, inactive: 0, popular: 0, avgPrice: 0, minPrice: 0, maxPrice: 0 },
    });
  } catch (error) {
    console.error("Error fetching service items stats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch service items stats",
    });
  }
};