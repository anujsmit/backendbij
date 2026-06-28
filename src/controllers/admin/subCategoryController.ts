// backend/src/controllers/admin/subCategoryController.ts
import { Request, Response } from "express";
import { db } from "../../db";
import { serviceCategories, serviceSubCategories, serviceItems } from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../../services/auditLog";

const subCategorySchema = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

// ============================================
// GET ALL SUB-CATEGORIES
// ============================================

export const getAllSubCategories = async (req: Request, res: Response) => {
  try {
    const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
    
    console.log(`[subCategoryController] Fetching sub-categories for categoryId: ${categoryId}`);

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

    console.log(`[subCategoryController] Found ${subCategories.length} sub-categories`);

    const withCounts = await Promise.all(
      subCategories.map(async (sub) => {
        try {
          const result = await db
            .select({ count: sql<number>`count(*)` })
            .from(serviceItems)
            .where(eq(serviceItems.subCategoryId, sub.id));
          return {
            ...sub,
            serviceItemsCount: Number(result[0]?.count || 0),
          };
        } catch (err) {
          console.error(`[subCategoryController] Error counting items for sub ${sub.id}:`, err);
          return {
            ...sub,
            serviceItemsCount: 0,
          };
        }
      })
    );

    return res.json({ success: true, subCategories: withCounts });
  } catch (error) {
    console.error("[subCategoryController] Error fetching sub-categories:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to fetch sub-categories",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

// ============================================
// GET SUB-CATEGORY BY ID
// ============================================

export const getSubCategoryById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    console.log(`[subCategoryController] Fetching sub-category by ID: ${id}`);

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
    console.error("[subCategoryController] Error fetching sub-category:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to fetch sub-category",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

// ============================================
// CREATE SUB-CATEGORY
// ============================================

export const createSubCategory = async (req: Request, res: Response) => {
  try {
    const parsed = subCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
    }

    console.log(`[subCategoryController] Creating sub-category:`, parsed.data);

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

    // ✅ Fixed: Use userId from decoded token
    await createAuditLog({
      entityType: "service_sub_category",
      entityId: created.id,
      action: "create",
      performedBy: (req as any).user?.userId || 'system',
      performedByRole: "admin",
      newValue: created,
    });

    return res.status(201).json({ success: true, subCategory: created });
  } catch (error: any) {
    console.error("[subCategoryController] Error creating sub-category:", error);
    if (error?.code === "23505") {
      return res.status(409).json({ 
        success: false, 
        message: "Sub-category with this name already exists in this category" 
      });
    }
    return res.status(500).json({ 
      success: false, 
      message: "Failed to create sub-category",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

// ============================================
// UPDATE SUB-CATEGORY
// ============================================

export const updateSubCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const parsed = subCategorySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
    }

    console.log(`[subCategoryController] Updating sub-category ${id}:`, parsed.data);

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

    // ✅ Fixed: Use userId from decoded token
    await createAuditLog({
      entityType: "service_sub_category",
      entityId: id,
      action: "update",
      performedBy: (req as any).user?.userId || 'system',
      performedByRole: "admin",
      oldValue: existing,
      newValue: updated,
    });

    return res.json({ success: true, subCategory: updated });
  } catch (error) {
    console.error("[subCategoryController] Error updating sub-category:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to update sub-category",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

// ============================================
// DELETE SUB-CATEGORY
// ============================================

export const deleteSubCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    console.log(`[subCategoryController] Deleting sub-category ${id}`);

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

    // ✅ Fixed: Use userId from decoded token
    await createAuditLog({
      entityType: "service_sub_category",
      entityId: id,
      action: "delete",
      performedBy: (req as any).user?.userId || 'system',
      performedByRole: "admin",
      oldValue: existing,
    });

    return res.json({ success: true, message: "Sub-category deleted successfully" });
  } catch (error) {
    console.error("[subCategoryController] Error deleting sub-category:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to delete sub-category",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};