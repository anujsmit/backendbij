// backend/src/controllers/platformServicesController.ts

import { Request, Response } from "express";
import { db } from "../../db";
import { platformServices, services } from "../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../../utils/logger";

/**
 * GET /api/platform-services
 * Get all platform services grouped by category
 */
export const getPlatformServices = async (req: Request, res: Response) => {
    try {
        const servicesWithCategory = await db
            .select({
                id: platformServices.id,
                name: platformServices.name,
                description: platformServices.description,
                price: platformServices.price,
                imageUrl: platformServices.imageUrl,
                isActive: platformServices.isActive,
                isPopular: platformServices.isPopular,
                isFeatured: platformServices.isFeatured,
                durationMinutes: platformServices.durationMinutes,
                categoryId: services.id,
                categoryName: services.serviceName,
                categoryIconUrl: services.customIconUrl,
                categoryIconColor: services.iconColor,
            })
            .from(platformServices)
            .innerJoin(services, eq(platformServices.serviceId, services.id))
            .where(eq(platformServices.isActive, true))
            .orderBy(services.id, platformServices.name);

        // Group services by category
        const categoryMap = new Map();

        servicesWithCategory.forEach((item) => {
            if (!categoryMap.has(item.categoryId)) {
                categoryMap.set(item.categoryId, {
                    categoryId: item.categoryId,
                    categoryName: item.categoryName,
                    categoryIconUrl: item.categoryIconUrl,
                    categoryIconColor: item.categoryIconColor,
                    services: [],
                });
            }

            categoryMap.get(item.categoryId).services.push({
                id: item.id,
                name: item.name,
                description: item.description,
                price: item.price,
                imageUrl: item.imageUrl,
                durationMinutes: item.durationMinutes,
                isPopular: item.isPopular,
                isFeatured: item.isFeatured,
            });
        });

        const categoriesWithServices = Array.from(categoryMap.values());

        return res.json({
            success: true,
            categories: categoriesWithServices,
        });
    } catch (error) {
        logger.error("Error fetching platform services:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch platform services",
        });
    }
};

/**
 * GET /api/platform-services/category/:categoryId
 * Get platform services by category ID
 */
export const getPlatformServicesByCategory = async (req: Request, res: Response) => {
    try {
        const categoryId = req.params.categoryId;

        // Validate categoryId is a number
        const categoryIdNum = parseInt(categoryId);
        if (isNaN(categoryIdNum)) {
            return res.status(400).json({
                success: false,
                message: "Invalid category ID. Must be a number.",
            });
        }

        // Get category services
        const categoryServices = await db
            .select({
                id: platformServices.id,
                name: platformServices.name,
                description: platformServices.description,
                price: platformServices.price,
                imageUrl: platformServices.imageUrl,
                durationMinutes: platformServices.durationMinutes,
                isActive: platformServices.isActive,
                isPopular: platformServices.isPopular,
                isFeatured: platformServices.isFeatured,
            })
            .from(platformServices)
            .where(
                and(
                    eq(platformServices.serviceId, categoryIdNum),
                    eq(platformServices.isActive, true)
                )
            )
            .orderBy(platformServices.name);

        // Get category info
        const [categoryInfo] = await db
            .select({
                id: services.id,
                name: services.serviceName,
                description: services.description,
                iconUrl: services.customIconUrl,
                iconColor: services.iconColor,
                iconName: services.iconName,
                iconType: services.iconType,
                isActive: services.isActive,
            })
            .from(services)
            .where(eq(services.id, categoryIdNum))
            .limit(1);

        if (!categoryInfo) {
            return res.status(404).json({
                success: false,
                message: "Category not found",
            });
        }

        return res.json({
            success: true,
            category: categoryInfo,
            services: categoryServices,
            count: categoryServices.length,
        });
    } catch (error) {
        logger.error("Error fetching platform services by category:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch platform services",
        });
    }
};

/**
 * GET /api/platform-services/popular
 * Get popular platform services
 */
export const getPopularServices = async (req: Request, res: Response) => {
    try {
        const { limit = "10" } = req.query;
        const limitNum = parseInt(limit as string);

        const popularServices = await db
            .select({
                id: platformServices.id,
                name: platformServices.name,
                description: platformServices.description,
                price: platformServices.price,
                imageUrl: platformServices.imageUrl,
                thumbnailUrl: platformServices.thumbnailUrl,
                durationMinutes: platformServices.durationMinutes,
                isPopular: platformServices.isPopular,
                isFeatured: platformServices.isFeatured,
                categoryId: services.id,
                categoryName: services.serviceName,
                categoryIconUrl: services.customIconUrl,
                categoryIconColor: services.iconColor,
            })
            .from(platformServices)
            .innerJoin(services, eq(platformServices.serviceId, services.id))
            .where(
                and(
                    eq(platformServices.isActive, true),
                    eq(platformServices.isPopular, true)
                )
            )
            .orderBy(platformServices.name)
            .limit(isNaN(limitNum) ? 10 : limitNum);

        return res.json({
            success: true,
            services: popularServices,
            count: popularServices.length,
        });
    } catch (error) {
        logger.error("Error fetching popular services:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch popular services",
        });
    }
};

/**
 * GET /api/platform-services/featured
 * Get featured platform services
 */
export const getFeaturedServices = async (req: Request, res: Response) => {
    try {
        const { limit = "5" } = req.query;
        const limitNum = parseInt(limit as string);

        const featuredServices = await db
            .select({
                id: platformServices.id,
                name: platformServices.name,
                description: platformServices.description,
                price: platformServices.price,
                imageUrl: platformServices.imageUrl,
                thumbnailUrl: platformServices.thumbnailUrl,
                durationMinutes: platformServices.durationMinutes,
                isPopular: platformServices.isPopular,
                isFeatured: platformServices.isFeatured,
                categoryId: services.id,
                categoryName: services.serviceName,
                categoryIconUrl: services.customIconUrl,
                categoryIconColor: services.iconColor,
            })
            .from(platformServices)
            .innerJoin(services, eq(platformServices.serviceId, services.id))
            .where(
                and(
                    eq(platformServices.isActive, true),
                    eq(platformServices.isFeatured, true)
                )
            )
            .orderBy(desc(platformServices.createdAt))
            .limit(isNaN(limitNum) ? 5 : limitNum);

        return res.json({
            success: true,
            services: featuredServices,
            count: featuredServices.length,
        });
    } catch (error) {
        logger.error("Error fetching featured services:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch featured services",
        });
    }
};

/**
 * GET /api/platform-services/:id
 * Get a single platform service by ID
 */
export const getPlatformServiceById = async (req: Request, res: Response) => {
    try {
        const id = req.params.id;

        const [service] = await db
            .select({
                id: platformServices.id,
                name: platformServices.name,
                description: platformServices.description,
                price: platformServices.price,
                imageUrl: platformServices.imageUrl,
                thumbnailUrl: platformServices.thumbnailUrl,
                durationMinutes: platformServices.durationMinutes,
                isActive: platformServices.isActive,
                isPopular: platformServices.isPopular,
                isFeatured: platformServices.isFeatured,
                categoryId: services.id,
                categoryName: services.serviceName,
                categoryIconUrl: services.customIconUrl,
                categoryIconColor: services.iconColor,
                categoryDescription: services.description,
            })
            .from(platformServices)
            .innerJoin(services, eq(platformServices.serviceId, services.id))
            .where(eq(platformServices.id, id))
            .limit(1);

        if (!service) {
            return res.status(404).json({
                success: false,
                message: "Service not found",
            });
        }

        return res.json({
            success: true,
            service,
        });
    } catch (error) {
        logger.error("Error fetching platform service:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch service",
        });
    }
};