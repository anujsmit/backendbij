// backend/src/controllers/publicCategoryController.ts

import { Request, Response } from "express";
import { db } from "../../db";
import { 
    serviceCategories, 
    serviceSubCategories, 
    serviceItems
} from "../../db/schema";
import { eq, sql, and } from "drizzle-orm";

/**
 * GET /api/public/categories
 * Public endpoint for users to fetch all active service categories
 * No authentication required
 */
export const getPublicCategories = async (_req: Request, res: Response) => {
    try {
        const categories = await db
            .select()
            .from(serviceCategories)
            .where(eq(serviceCategories.isActive, true))
            .orderBy(serviceCategories.displayOrder, serviceCategories.name);

        // Get sub-category count for each category
        const categoriesWithCounts = await Promise.all(
            categories.map(async (cat) => {
                const result = await db
                    .select({ count: sql<number>`count(*)` })
                    .from(serviceSubCategories)
                    .where(
                        and(
                            eq(serviceSubCategories.categoryId, cat.id),
                            eq(serviceSubCategories.isActive, true)
                        )
                    );
                return {
                    ...cat,
                    subCategoryCount: Number(result[0]?.count || 0),
                };
            })
        );

        // Set cache headers for better performance
        res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes

        return res.json({
            success: true,
            categories: categoriesWithCounts,
        });
    } catch (error) {
        console.error("Error fetching public categories:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch categories",
        });
    }
};

/**
 * GET /api/public/categories/:id
 * Get a single category by ID with its sub-categories
 */
export const getPublicCategoryById = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid category ID"
            });
        }

        const [category] = await db
            .select()
            .from(serviceCategories)
            .where(
                and(
                    eq(serviceCategories.id, id),
                    eq(serviceCategories.isActive, true)
                )
            )
            .limit(1);

        if (!category) {
            return res.status(404).json({
                success: false,
                message: "Category not found"
            });
        }

        // Get sub-categories for this category
        const subCategories = await db
            .select({
                id: serviceSubCategories.id,
                name: serviceSubCategories.name,
                description: serviceSubCategories.description,
                imageUrl: serviceSubCategories.imageUrl,
                isActive: serviceSubCategories.isActive,
                isPopular: serviceSubCategories.isPopular,
                displayOrder: serviceSubCategories.displayOrder,
            })
            .from(serviceSubCategories)
            .where(
                and(
                    eq(serviceSubCategories.categoryId, id),
                    eq(serviceSubCategories.isActive, true)
                )
            )
            .orderBy(serviceSubCategories.displayOrder, serviceSubCategories.name);

        // Get item count for each sub-category
        const subCategoriesWithCounts = await Promise.all(
            subCategories.map(async (sub) => {
                try {
                    const result = await db
                        .select({ count: sql<number>`count(*)` })
                        .from(serviceItems)
                        .where(
                            and(
                                eq(serviceItems.subCategoryId, sub.id),
                                eq(serviceItems.isActive, true)
                            )
                        );
                    return {
                        ...sub,
                        itemCount: Number(result[0]?.count || 0),
                    };
                } catch (err) {
                    console.error(`Error counting items for sub-category ${sub.id}:`, err);
                    return {
                        ...sub,
                        itemCount: 0,
                    };
                }
            })
        );

        res.setHeader('Cache-Control', 'public, max-age=300');

        return res.json({
            success: true,
            category: {
                ...category,
                subCategories: subCategoriesWithCounts,
            },
        });
    } catch (error) {
        console.error("Error fetching public category:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch category",
        });
    }
};

/**
 * GET /api/public/categories/:id/sub-categories/:subId
 * Get a specific sub-category with its service items
 */
export const getPublicSubCategoryById = async (req: Request, res: Response) => {
    try {
        const categoryId = parseInt(req.params.id);
        const subCategoryId = req.params.subId;
        
        if (isNaN(categoryId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid category ID"
            });
        }

        // Get the sub-category
        const [subCategory] = await db
            .select()
            .from(serviceSubCategories)
            .where(
                and(
                    eq(serviceSubCategories.id, subCategoryId),
                    eq(serviceSubCategories.categoryId, categoryId),
                    eq(serviceSubCategories.isActive, true)
                )
            )
            .limit(1);

        if (!subCategory) {
            return res.status(404).json({
                success: false,
                message: "Sub-category not found"
            });
        }

        // Get service items for this sub-category
        const items = await db
            .select({
                id: serviceItems.id,
                name: serviceItems.name,
                description: serviceItems.description,
                price: serviceItems.price,
                durationMinutes: serviceItems.durationMinutes,
                isActive: serviceItems.isActive,
                isPopular: serviceItems.isPopular,
                imageUrl: serviceItems.imageUrl,
                displayOrder: serviceItems.displayOrder,
            })
            .from(serviceItems)
            .where(
                and(
                    eq(serviceItems.subCategoryId, subCategoryId),
                    eq(serviceItems.isActive, true)
                )
            )
            .orderBy(serviceItems.displayOrder, serviceItems.name);

        res.setHeader('Cache-Control', 'public, max-age=300');

        return res.json({
            success: true,
            subCategory: {
                ...subCategory,
                items,
                itemCount: items.length,
            },
        });
    } catch (error) {
        console.error("Error fetching public sub-category:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch sub-category",
        });
    }
};