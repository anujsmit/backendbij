import { Request, Response } from "express";
import { db } from "../db";
import { platformServices, services } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";

export const getPlatformServices = async (req: Request, res: Response) => {
    try {
        const servicesWithCategory = await db
            .select({
                serviceId: platformServices.id,
                serviceName: platformServices.name,
                serviceDescription: platformServices.description,
                servicePrice: platformServices.price,
                serviceImageUrl: platformServices.imageUrl,
                categoryId: services.id,
                categoryName: services.serviceName,
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
                    services: [],
                });
            }

            categoryMap.get(item.categoryId).services.push({
                id: item.serviceId,
                name: item.serviceName,
                description: item.serviceDescription,
                price: item.servicePrice,
                imageUrl: item.serviceImageUrl,
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
            })
            .from(platformServices)
            .where(
                and(
                    eq(platformServices.serviceId, parseInt(categoryId)),
                    eq(platformServices.isActive, true)
                )
            )
            .orderBy(platformServices.name);

        return res.json({
            success: true,
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
