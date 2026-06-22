// backend/src/controllers/adminServiceController.ts
import { Request, Response } from "express";
import { db } from "../db";
import { 
  services, 
  platformServices, 
  serviceItems,
  serviceRequestPlatformServices,
  serviceCategories,  // ✅ ADD THIS IMPORT
  serviceSubCategories // ✅ ADD THIS IMPORT
} from "../db/schema";
import { eq, desc, and, asc, sql, count, sum, avg } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../services/auditLog";

// ============================================
// SERVICE CATEGORIES (Level 1)
// ============================================

export const getAllServiceCategories = async (_req: Request, res: Response) => {
  try {
    const all = await db.select().from(serviceCategories).orderBy(serviceCategories.displayOrder, serviceCategories.name);
    return res.json({ success: true, categories: all });
  } catch (error) {
    console.error("Error fetching service categories:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch categories" });
  }
};

export const getServiceCategoryById = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const [category] = await db.select().from(serviceCategories).where(eq(serviceCategories.id, id)).limit(1);
    
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }
    
    const [countResult] = await db
      .select({ count: count() })
      .from(serviceSubCategories)
      .where(eq(serviceSubCategories.categoryId, id));
    
    return res.json({ 
      success: true, 
      category,
      subCategoryCount: Number(countResult?.count || 0)
    });
  } catch (error) {
    console.error("Error fetching service category:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch category" });
  }
};

const serviceCategorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  iconUrl: z.string().optional().nullable(),
  iconColor: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
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
    
    const [created] = await db.insert(serviceCategories).values({
      name: parsed.data.name,
      description: parsed.data.description || null,
      iconUrl: parsed.data.iconUrl || null,
      iconColor: parsed.data.iconColor || '#1890ff',
      isActive: parsed.data.isActive ?? true,
      displayOrder: parsed.data.displayOrder ?? 0,
    }).returning();
    
    await createAuditLog({
      entityType: "service_category",
      entityId: String(created.id),
      action: "create",
      performedBy: req.user!.id,
      performedByRole: "admin",
      newValue: created,
    });
    
    return res.status(201).json({ success: true, category: created });
  } catch (error: any) {
    if (error?.code === "23505") {
      return res.status(409).json({ success: false, message: "Category name already exists" });
    }
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
    
    const [existing] = await db.select().from(serviceCategories).where(eq(serviceCategories.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const updateData: any = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.iconUrl !== undefined) updateData.iconUrl = parsed.data.iconUrl;
    if (parsed.data.iconColor !== undefined) updateData.iconColor = parsed.data.iconColor;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if (parsed.data.displayOrder !== undefined) updateData.displayOrder = parsed.data.displayOrder;

    const [updated] = await db.update(serviceCategories).set(updateData).where(eq(serviceCategories.id, id)).returning();
    
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
    const id = parseInt(req.params.id);
    const { cascade } = req.query;
    
    const [existing] = await db.select().from(serviceCategories).where(eq(serviceCategories.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    // Check if category has sub-categories
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(serviceSubCategories)
      .where(eq(serviceSubCategories.categoryId, id));

    const subCategoryCount = Number(result[0]?.count || 0);
    
    if (subCategoryCount > 0 && cascade !== 'true') {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category with ${subCategoryCount} existing sub-categories. Please delete sub-categories first or use cascade delete.`,
        subCategoryCount
      });
    }

    if (cascade === 'true') {
      // Cascade delete - delete all sub-categories and their items
      await db.transaction(async (tx) => {
        // Get all sub-categories
        const subCategories = await tx
          .select({ id: serviceSubCategories.id })
          .from(serviceSubCategories)
          .where(eq(serviceSubCategories.categoryId, id));
        
        // Delete all service items in each sub-category
        for (const sub of subCategories) {
          await tx
            .delete(serviceItems)
            .where(eq(serviceItems.subCategoryId, sub.id));
        }
        
        // Delete all sub-categories
        await tx
          .delete(serviceSubCategories)
          .where(eq(serviceSubCategories.categoryId, id));
        
        // Delete the category
        await tx
          .delete(serviceCategories)
          .where(eq(serviceCategories.id, id));
      });
    } else {
      // Regular delete (only if no sub-categories)
      await db.delete(serviceCategories).where(eq(serviceCategories.id, id));
    }

    await createAuditLog({
      entityType: "service_category",
      entityId: String(id),
      action: cascade === 'true' ? "cascade_delete" : "delete",
      performedBy: req.user!.id,
      performedByRole: "admin",
      oldValue: existing,
      metadata: { cascade, subCategoryCount }
    });

    return res.json({ 
      success: true, 
      message: cascade === 'true' 
        ? `Category "${existing.name}" and all its sub-categories deleted successfully` 
        : "Category deleted successfully" 
    });
  } catch (error) {
    console.error("Error deleting category:", error);
    return res.status(500).json({ success: false, message: "Failed to delete category" });
  }
};

// ============================================
// SERVICE SUB-CATEGORIES (Level 2)
// ============================================

const subCategorySchema = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const getAllSubCategories = async (req: Request, res: Response) => {
  try {
    const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
    
    const conditions = [];
    if (categoryId) {
      conditions.push(eq(serviceSubCategories.categoryId, categoryId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const subCategories = await db
      .select({
        id: serviceSubCategories.id,
        categoryId: serviceSubCategories.categoryId,
        name: serviceSubCategories.name,
        description: serviceSubCategories.description,
        imageUrl: serviceSubCategories.imageUrl,
        isActive: serviceSubCategories.isActive,
        isPopular: serviceSubCategories.isPopular,
        displayOrder: serviceSubCategories.displayOrder,
        createdAt: serviceSubCategories.createdAt,
        updatedAt: serviceSubCategories.updatedAt,
        categoryName: serviceCategories.name,
      })
      .from(serviceSubCategories)
      .leftJoin(serviceCategories, eq(serviceSubCategories.categoryId, serviceCategories.id))
      .where(whereClause)
      .orderBy(serviceSubCategories.displayOrder, serviceSubCategories.name);

    const withCounts = await Promise.all(
      subCategories.map(async (sub) => {
        const result = await db
          .select({ count: sql<number>`count(*)` })
          .from(serviceItems)
          .where(eq(serviceItems.subCategoryId, sub.id));
        return {
          ...sub,
          serviceItemsCount: Number(result[0]?.count || 0),
        };
      })
    );

    return res.json({ success: true, subCategories: withCounts });
  } catch (error) {
    console.error("Error fetching sub-categories:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch sub-categories" });
  }
};

export const getSubCategoryById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const [subCategory] = await db
      .select()
      .from(serviceSubCategories)
      .where(eq(serviceSubCategories.id, id))
      .limit(1);

    if (!subCategory) {
      return res.status(404).json({ success: false, message: "Sub-category not found" });
    }

    return res.json({ success: true, subCategory });
  } catch (error) {
    console.error("Error fetching sub-category:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch sub-category" });
  }
};

export const createSubCategory = async (req: Request, res: Response) => {
  try {
    const parsed = subCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
    }

    const [category] = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.id, parsed.data.categoryId))
      .limit(1);

    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const [created] = await db.insert(serviceSubCategories).values({
      categoryId: parsed.data.categoryId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      imageUrl: parsed.data.imageUrl || null,
      isActive: parsed.data.isActive ?? true,
      isPopular: parsed.data.isPopular ?? false,
      displayOrder: parsed.data.displayOrder ?? 0,
    }).returning();

    await createAuditLog({
      entityType: "service_sub_category",
      entityId: created.id,
      action: "create",
      performedBy: req.user!.id,
      performedByRole: "admin",
      newValue: created,
    });

    return res.status(201).json({ success: true, subCategory: created });
  } catch (error: any) {
    if (error?.code === "23505") {
      return res.status(409).json({ 
        success: false, 
        message: "Sub-category with this name already exists in this category" 
      });
    }
    console.error("Error creating sub-category:", error);
    return res.status(500).json({ success: false, message: "Failed to create sub-category" });
  }
};

export const updateSubCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const parsed = subCategorySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
    }

    const [existing] = await db.select().from(serviceSubCategories).where(eq(serviceSubCategories.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Sub-category not found" });
    }

    const updateData: any = { updatedAt: new Date() };
    if (parsed.data.categoryId !== undefined) updateData.categoryId = parsed.data.categoryId;
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.imageUrl !== undefined) updateData.imageUrl = parsed.data.imageUrl;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if (parsed.data.isPopular !== undefined) updateData.isPopular = parsed.data.isPopular;
    if (parsed.data.displayOrder !== undefined) updateData.displayOrder = parsed.data.displayOrder;

    const [updated] = await db
      .update(serviceSubCategories)
      .set(updateData)
      .where(eq(serviceSubCategories.id, id))
      .returning();

    await createAuditLog({
      entityType: "service_sub_category",
      entityId: id,
      action: "update",
      performedBy: req.user!.id,
      performedByRole: "admin",
      oldValue: existing,
      newValue: updated,
    });

    return res.json({ success: true, subCategory: updated });
  } catch (error) {
    console.error("Error updating sub-category:", error);
    return res.status(500).json({ success: false, message: "Failed to update sub-category" });
  }
};

export const deleteSubCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const [existing] = await db.select().from(serviceSubCategories).where(eq(serviceSubCategories.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Sub-category not found" });
    }

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(serviceItems)
      .where(eq(serviceItems.subCategoryId, id));

    if (Number(result[0]?.count || 0) > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete sub-category with existing service items. Delete service items first."
      });
    }

    await db.delete(serviceSubCategories).where(eq(serviceSubCategories.id, id));

    await createAuditLog({
      entityType: "service_sub_category",
      entityId: id,
      action: "delete",
      performedBy: req.user!.id,
      performedByRole: "admin",
      oldValue: existing,
    });

    return res.json({ success: true, message: "Sub-category deleted successfully" });
  } catch (error) {
    console.error("Error deleting sub-category:", error);
    return res.status(500).json({ success: false, message: "Failed to delete sub-category" });
  }
};

// ============================================
// SERVICE ITEMS (Level 3)
// ============================================

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

export const getServiceItems = async (req: Request, res: Response) => {
  try {
    const subCategoryId = req.query.subCategoryId as string;

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

    return res.json({ success: true, serviceItems: items });
  } catch (error) {
    console.error("Error fetching service items:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch service items" });
  }
};

export const getServiceItemById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
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
    console.error("Error fetching service item:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch service item" });
  }
};

export const createServiceItem = async (req: Request, res: Response) => {
  try {
    const parsed = serviceItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
    }

    const [subCategory] = await db
      .select()
      .from(serviceSubCategories)
      .where(eq(serviceSubCategories.id, parsed.data.subCategoryId))
      .limit(1);

    if (!subCategory) {
      return res.status(404).json({ success: false, message: "Sub-category not found" });
    }

    const [created] = await db.insert(serviceItems).values({
      subCategoryId: parsed.data.subCategoryId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      price: String(parsed.data.price),
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
    if (error?.code === "23505") {
      return res.status(409).json({ 
        success: false, 
        message: "Service item with this name already exists in this sub-category" 
      });
    }
    console.error("Error creating service item:", error);
    return res.status(500).json({ success: false, message: "Failed to create service item" });
  }
};

export const updateServiceItem = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const parsed = serviceItemSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
    }

    const [existing] = await db.select().from(serviceItems).where(eq(serviceItems.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Service item not found" });
    }

    const updateData: any = { updatedAt: new Date() };
    if (parsed.data.subCategoryId !== undefined) updateData.subCategoryId = parsed.data.subCategoryId;
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.price !== undefined) updateData.price = String(parsed.data.price);
    if (parsed.data.durationMinutes !== undefined) updateData.durationMinutes = parsed.data.durationMinutes;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if (parsed.data.isPopular !== undefined) updateData.isPopular = parsed.data.isPopular;
    if (parsed.data.imageUrl !== undefined) updateData.imageUrl = parsed.data.imageUrl;
    if (parsed.data.displayOrder !== undefined) updateData.displayOrder = parsed.data.displayOrder;

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
    console.error("Error updating service item:", error);
    return res.status(500).json({ success: false, message: "Failed to update service item" });
  }
};

export const deleteServiceItem = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
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
    console.error("Error deleting service item:", error);
    return res.status(500).json({ success: false, message: "Failed to delete service item" });
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
    console.error("Error toggling popular status:", error);
    return res.status(500).json({ success: false, message: "Failed to toggle popular status" });
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
    console.error("Error toggling active status:", error);
    return res.status(500).json({ success: false, message: "Failed to toggle active status" });
  }
};

export const getServiceItemsStats = async (req: Request, res: Response) => {
  try {
    const subCategoryId = req.query.subCategoryId as string;

    const conditions = [];
    if (subCategoryId) {
      conditions.push(eq(serviceItems.subCategoryId, subCategoryId));
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
    return res.status(500).json({ success: false, message: "Failed to fetch service items stats" });
  }
};