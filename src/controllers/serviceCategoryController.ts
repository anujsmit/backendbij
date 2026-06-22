// backend/src/controllers/serviceCategoryController.ts

import { Request, Response } from "express";
import { db } from "../db";
import { serviceCategories, serviceSubCategories } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../services/auditLog";

const categorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  iconUrl: z.string().optional().nullable(),
  iconColor: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const getAllCategories = async (_req: Request, res: Response) => {
  try {
    const categories = await db
      .select()
      .from(serviceCategories)
      .orderBy(serviceCategories.displayOrder, serviceCategories.name);
    
    const categoriesWithCounts = await Promise.all(
      categories.map(async (cat) => {
        const result = await db
          .select({ count: sql<number>`count(*)` })
          .from(serviceSubCategories)
          .where(eq(serviceSubCategories.categoryId, cat.id));
        return {
          ...cat,
          subCategoryCount: Number(result[0]?.count || 0),
        };
      })
    );

    return res.json({ success: true, categories: categoriesWithCounts });
  } catch (error) {
    console.error("Error fetching categories:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch categories" });
  }
};

export const getCategoryById = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [category] = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.id, id))
      .limit(1);

    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    return res.json({ success: true, category });
  } catch (error) {
    console.error("Error fetching category:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch category" });
  }
};

export const createCategory = async (req: Request, res: Response) => {
  try {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
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
    console.error("Error creating category:", error);
    return res.status(500).json({ success: false, message: "Failed to create category" });
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const parsed = categorySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
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

    const [updated] = await db
      .update(serviceCategories)
      .set(updateData)
      .where(eq(serviceCategories.id, id))
      .returning();

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
    console.error("Error updating category:", error);
    return res.status(500).json({ success: false, message: "Failed to update category" });
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(serviceCategories).where(eq(serviceCategories.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(serviceSubCategories)
      .where(eq(serviceSubCategories.categoryId, id));

    if (Number(result[0]?.count || 0) > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete category with existing sub-categories. Delete sub-categories first."
      });
    }

    await db.delete(serviceCategories).where(eq(serviceCategories.id, id));

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
    console.error("Error deleting category:", error);
    return res.status(500).json({ success: false, message: "Failed to delete category" });
  }
};