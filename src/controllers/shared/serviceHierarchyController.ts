// backend/src/controllers/serviceHierarchyController.ts

import { Request, Response } from "express";
import { db } from "../../db";
import { 
    serviceCategories, 
    serviceSubCategories, 
    serviceItems 
} from "../../db/schema";
import { eq, sql, and } from "drizzle-orm";



/**
 * GET /api/public/service-hierarchy
 * Returns complete service hierarchy: Categories → Sub-Categories → Items
 * No authentication required
 */
export const getServiceHierarchy = async (_req: Request, res: Response) => {
    try {
        console.log('[serviceHierarchy] Fetching service hierarchy...');
        
        // Fetch all active categories
        const categories = await db
            .select()
            .from(serviceCategories)
            .where(eq(serviceCategories.isActive, true))
            .orderBy(serviceCategories.displayOrder, serviceCategories.name);

        console.log(`[serviceHierarchy] Found ${categories.length} categories`);

        // For each category, fetch its sub-categories and items
        const hierarchy = await Promise.all(
            categories.map(async (category) => {
                // Fetch sub-categories for this category
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
                            eq(serviceSubCategories.categoryId, category.id),
                            eq(serviceSubCategories.isActive, true)
                        )
                    )
                    .orderBy(serviceSubCategories.displayOrder, serviceSubCategories.name);

                console.log(`[serviceHierarchy] Category ${category.name} has ${subCategories.length} sub-categories`);

                // For each sub-category, fetch its service items
                const subCategoriesWithItems = await Promise.all(
                    subCategories.map(async (subCategory) => {
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
                                    eq(serviceItems.subCategoryId, subCategory.id),
                                    eq(serviceItems.isActive, true)
                                )
                            )
                            .orderBy(serviceItems.displayOrder, serviceItems.name);

                        console.log(`[serviceHierarchy] Sub-category ${subCategory.name} has ${items.length} items`);

                        return {
                            ...subCategory,
                            items,
                            itemCount: items.length,
                        };
                    })
                );

                // Flatten all items for this category
                const allItems = subCategoriesWithItems.flatMap(sub => sub.items);

                return {
                    id: category.id,
                    name: category.name,
                    description: category.description,
                    iconUrl: category.iconUrl,
                    iconColor: category.iconColor,
                    displayOrder: category.displayOrder,
                    subCategories: subCategoriesWithItems,
                    totalItems: allItems.length,
                    popularItems: allItems
                        .filter(item => item.isPopular)
                        .slice(0, 6),
                };
            })
        );

        // Get all popular items across all categories
        const allPopularItems = hierarchy
            .flatMap(cat => cat.popularItems || [])
            .slice(0, 10);

        return res.json({
            success: true,
            hierarchy,
            popularServices: allPopularItems,
            totalCategories: hierarchy.length,
            totalItems: hierarchy.reduce((sum, cat) => sum + cat.totalItems, 0),
        });
    } catch (error) {
        console.error("[serviceHierarchy] Error fetching service hierarchy:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch services",
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * GET /api/public/service-hierarchy/:categoryId
 * Get a specific category with its sub-categories and items
 */
export const getCategoryHierarchy = async (req: Request, res: Response) => {
    try {
        const categoryId = parseInt(req.params.id);
        
        if (isNaN(categoryId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid category ID"
            });
        }

        // Get the category
        const [category] = await db
            .select()
            .from(serviceCategories)
            .where(
                and(
                    eq(serviceCategories.id, categoryId),
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

        // Fetch sub-categories with their items
        const subCategories = await db
            .select()
            .from(serviceSubCategories)
            .where(
                and(
                    eq(serviceSubCategories.categoryId, categoryId),
                    eq(serviceSubCategories.isActive, true)
                )
            )
            .orderBy(serviceSubCategories.displayOrder, serviceSubCategories.name);

        const subCategoriesWithItems = await Promise.all(
            subCategories.map(async (subCategory) => {
                const items = await db
                    .select()
                    .from(serviceItems)
                    .where(
                        and(
                            eq(serviceItems.subCategoryId, subCategory.id),
                            eq(serviceItems.isActive, true)
                        )
                    )
                    .orderBy(serviceItems.displayOrder, serviceItems.name);

                return {
                    ...subCategory,
                    items,
                    itemCount: items.length,
                };
            })
        );

        res.setHeader('Cache-Control', 'public, max-age=300');

        return res.json({
            success: true,
            category: {
                ...category,
                subCategories: subCategoriesWithItems,
                totalItems: subCategoriesWithItems.reduce((sum, sub) => sum + sub.itemCount, 0),
            },
        });
    } catch (error) {
        console.error("Error fetching category hierarchy:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch category",
        });
    }
};

/**
 * GET /api/public/service-hierarchy/item/:itemId
 * Get a single service item with its category and sub-category info
 */
export const getServiceItemDetails = async (req: Request, res: Response) => {
    try {
        const itemId = req.params.id;

        const [item] = await db
            .select({
                id: serviceItems.id,
                name: serviceItems.name,
                description: serviceItems.description,
                price: serviceItems.price,
                durationMinutes: serviceItems.durationMinutes,
                imageUrl: serviceItems.imageUrl,
                isPopular: serviceItems.isPopular,
                subCategoryId: serviceItems.subCategoryId,
                subCategoryName: serviceSubCategories.name,
                categoryId: serviceSubCategories.categoryId,
                categoryName: serviceCategories.name,
                categoryIconUrl: serviceCategories.iconUrl,
                categoryIconColor: serviceCategories.iconColor,
            })
            .from(serviceItems)
            .innerJoin(serviceSubCategories, eq(serviceItems.subCategoryId, serviceSubCategories.id))
            .innerJoin(serviceCategories, eq(serviceSubCategories.categoryId, serviceCategories.id))
            .where(
                and(
                    eq(serviceItems.id, itemId),
                    eq(serviceItems.isActive, true)
                )
            )
            .limit(1);

        if (!item) {
            return res.status(404).json({
                success: false,
                message: "Service item not found"
            });
        }

        // Get related items (same sub-category)
        const relatedItems = await db
            .select()
            .from(serviceItems)
            .where(
                and(
                    eq(serviceItems.subCategoryId, item.subCategoryId),
                    eq(serviceItems.isActive, true),
                    sql`${serviceItems.id} != ${itemId}`
                )
            )
            .orderBy(serviceItems.displayOrder, serviceItems.name)
            .limit(5);

        res.setHeader('Cache-Control', 'public, max-age=300');

        return res.json({
            success: true,
            item,
            relatedItems,
        });
    } catch (error) {
        console.error("Error fetching service item details:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch service item",
        });
    }
};
