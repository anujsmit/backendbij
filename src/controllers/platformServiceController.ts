import { Request, Response } from "express";
import { db } from "../db";
import { platformServices, services } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";

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
                duration_minutes: platformServices.duration_minutes,
                categoryId: services.id,
                categoryName: services.serviceName,
                categoryIconUrl: services.customIconUrl,
                categoryIconColor: services.iconColor,
            })
            .from(platformServices)
            .innerJoin(services, eq(platformServices.serviceId, services.id))
            .where(eq(platformServices.isActive, true))
            .orderBy(services.id, platformServices.name);

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
                duration_minutes: item.duration_minutes,
                isPopular: item.isPopular,
            });
        });

        const categoriesWithServices = Array.from(categoryMap.values());

        return res.json({
            success: true,
            categories: categoriesWithServices,
        });
    } catch (error) {
        console.error("Error fetching platform services:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch platform services",
        });
    }
};

export const getPlatformServicesByCategory = async (req: Request, res: Response) => {
    try {
        const categoryId = req.params.categoryId as string;

        const categoryServices = await db
            .select({
                id: platformServices.id,
                name: platformServices.name,
                description: platformServices.description,
                price: platformServices.price,
                imageUrl: platformServices.imageUrl,
                duration_minutes: platformServices.duration_minutes,
                isActive: platformServices.isActive,
                isPopular: platformServices.isPopular, // Add this line
            })
            .from(platformServices)
            .where(
                and(
                    eq(platformServices.serviceId, parseInt(categoryId)),
                    eq(platformServices.isActive, true)
                )
            )
            .orderBy(platformServices.name);

        // Also get category info
        const [categoryInfo] = await db
            .select({
                id: services.id,
                name: services.serviceName,
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

export const getPopularServices = async (req: Request, res: Response) => {
    try {
        const popularServices = await db
            .select({
                id: platformServices.id,
                name: platformServices.name,
                description: platformServices.description,
                price: platformServices.price,
                imageUrl: platformServices.imageUrl,
                duration_minutes: platformServices.duration_minutes,
                isPopular: platformServices.isPopular,
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
            .orderBy(platformServices.name);

        return res.json({
            success: true,
            services: popularServices,
        });
    } catch (error) {
        console.error("Error fetching popular services:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch popular services",
        });
    }
};