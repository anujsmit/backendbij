// backend/src/controllers/serviceItemController.ts

import { Request, Response } from "express";
import { db } from "../db";
import { serviceItems, serviceSubCategories } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../services/auditLog";

const serviceItemSchema = z.object({
  subCategoryId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  price: z.number().positive(),
  durationMinutes: z.number().int().min(0).optional().nullable(),
  isActive: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  imageUrl: z.string().optional().nullable(),
  displayOrder: z.number().int().min(0).optional(),
});

export const getAllServiceItems = async (req: Request, res: Response) => {
  try {
    const subCategoryId = req.query.subCategoryId as string;
    
    console.log(`[serviceItemController] Fetching items for subCategoryId: ${subCategoryId}`);

    const conditions = [];
    if (subCategoryId) {
      conditions.push(eq(serviceItems.subCategoryId, subCategoryId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db
      .select({
        id: serviceItems.id,
        subCategoryId: serviceItems.subCategoryId,
        name: serviceItems.name,
        description: serviceItems.description,
        price: serviceItems.price,
        durationMinutes: serviceItems.durationMinutes,
        isActive: serviceItems.isActive,
        isPopular: serviceItems.isPopular,
        imageUrl: serviceItems.imageUrl,
        displayOrder: serviceItems.displayOrder,
        createdAt: serviceItems.createdAt,
        updatedAt: serviceItems.updatedAt,
        subCategoryName: serviceSubCategories.name,
        categoryId: serviceSubCategories.categoryId,
      })
      .from(serviceItems)
      .leftJoin(serviceSubCategories, eq(serviceItems.subCategoryId, serviceSubCategories.id))
      .where(whereClause)
      .orderBy(serviceItems.displayOrder, serviceItems.name);

    console.log(`[serviceItemController] Found ${items.length} items`);

    return res.json({ success: true, serviceItems: items });
  } catch (error) {
    console.error("[serviceItemController] Error fetching service items:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to fetch service items",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const getServiceItemById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    console.log(`[serviceItemController] Fetching service item by ID: ${id}`);

    const [item] = await db
      .select()
      .from(serviceItems)
      .where(eq(serviceItems.id, id))
      .limit(1);

    if (!item) {
      return res.status(404).json({ success: false, message: "Service item not found" });
    }

    return res.json({ success: true, serviceItem: item });
  } catch (error) {
    console.error("[serviceItemController] Error fetching service item:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to fetch service item",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const createServiceItem = async (req: Request, res: Response) => {
  try {
    const parsed = serviceItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
    }

    console.log(`[serviceItemController] Creating service item:`, parsed.data);

    const [subCategory] = await db
      .select()
      .from(serviceSubCategories)
      .where(eq(serviceSubCategories.id, parsed.data.subCategoryId))
      .limit(1);

    if (!subCategory) {
      return res.status(404).json({ success: false, message: "Sub-category not found" });
    }

    // ✅ Explicitly map all fields to avoid type issues
    const [created] = await db.insert(serviceItems).values({
      subCategoryId: parsed.data.subCategoryId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      price: String(parsed.data.price), // ✅ Convert price to string
      durationMinutes: parsed.data.durationMinutes || null,
      isActive: parsed.data.isActive ?? true,
      isPopular: parsed.data.isPopular ?? false,
      imageUrl: parsed.data.imageUrl || null,
      displayOrder: parsed.data.displayOrder ?? 0,
    }).returning();

    await createAuditLog({
      entityType: "service_item",
      entityId: created.id,
      action: "create",
      performedBy: req.user!.id,
      performedByRole: "admin",
      newValue: created,
    });

    return res.status(201).json({ success: true, serviceItem: created });
  } catch (error: any) {
    console.error("[serviceItemController] Error creating service item:", error);
    if (error?.code === "23505") {
      return res.status(409).json({ 
        success: false, 
        message: "Service item with this name already exists in this sub-category" 
      });
    }
    return res.status(500).json({ 
      success: false, 
      message: "Failed to create service item",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const updateServiceItem = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const parsed = serviceItemSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
    }

    console.log(`[serviceItemController] Updating service item ${id}:`, parsed.data);

    const [existing] = await db.select().from(serviceItems).where(eq(serviceItems.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Service item not found" });
    }

    // ✅ Build update object explicitly to avoid type issues
    const updateData: any = { updatedAt: new Date() };
    
    if (parsed.data.subCategoryId !== undefined) {
      updateData.subCategoryId = parsed.data.subCategoryId;
    }
    if (parsed.data.name !== undefined) {
      updateData.name = parsed.data.name;
    }
    if (parsed.data.description !== undefined) {
      updateData.description = parsed.data.description;
    }
    if (parsed.data.price !== undefined) {
      updateData.price = String(parsed.data.price); // ✅ Convert price to string
    }
    if (parsed.data.durationMinutes !== undefined) {
      updateData.durationMinutes = parsed.data.durationMinutes;
    }
    if (parsed.data.isActive !== undefined) {
      updateData.isActive = parsed.data.isActive;
    }
    if (parsed.data.isPopular !== undefined) {
      updateData.isPopular = parsed.data.isPopular;
    }
    if (parsed.data.imageUrl !== undefined) {
      updateData.imageUrl = parsed.data.imageUrl;
    }
    if (parsed.data.displayOrder !== undefined) {
      updateData.displayOrder = parsed.data.displayOrder;
    }

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

    return res.json({ success: true, serviceItem: updated });
  } catch (error) {
    console.error("[serviceItemController] Error updating service item:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to update service item",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const deleteServiceItem = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    console.log(`[serviceItemController] Deleting service item ${id}`);

    const [existing] = await db.select().from(serviceItems).where(eq(serviceItems.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Service item not found" });
    }

    await db.delete(serviceItems).where(eq(serviceItems.id, id));

    await createAuditLog({
      entityType: "service_item",
      entityId: id,
      action: "delete",
      performedBy: req.user!.id,
      performedByRole: "admin",
      oldValue: existing,
    });

    return res.json({ success: true, message: "Service item deleted successfully" });
  } catch (error) {
    console.error("[serviceItemController] Error deleting service item:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to delete service item",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const toggleServiceItemPopular = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const [existing] = await db.select().from(serviceItems).where(eq(serviceItems.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Service item not found" });
    }

    const newStatus = !existing.isPopular;
    const [updated] = await db
      .update(serviceItems)
      .set({ isPopular: newStatus, updatedAt: new Date() })
      .where(eq(serviceItems.id, id))
      .returning();

    await createAuditLog({
      entityType: "service_item",
      entityId: id,
      action: newStatus ? "mark_popular" : "unmark_popular",
      performedBy: req.user!.id,
      performedByRole: "admin",
      oldValue: { isPopular: existing.isPopular },
      newValue: { isPopular: newStatus },
    });

    return res.json({ success: true, serviceItem: updated });
  } catch (error) {
    console.error("[serviceItemController] Error toggling popular status:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to toggle popular status",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const toggleServiceItemActive = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const [existing] = await db.select().from(serviceItems).where(eq(serviceItems.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Service item not found" });
    }

    const newStatus = !existing.isActive;
    const [updated] = await db
      .update(serviceItems)
      .set({ isActive: newStatus, updatedAt: new Date() })
      .where(eq(serviceItems.id, id))
      .returning();

    await createAuditLog({
      entityType: "service_item",
      entityId: id,
      action: newStatus ? "activate" : "deactivate",
      performedBy: req.user!.id,
      performedByRole: "admin",
      oldValue: { isActive: existing.isActive },
      newValue: { isActive: newStatus },
    });

    return res.json({ success: true, serviceItem: updated });
  } catch (error) {
    console.error("[serviceItemController] Error toggling active status:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to toggle active status",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};