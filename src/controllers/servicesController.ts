import { Request, Response } from "express";
import { db } from "../db";
import { services } from "../db/schema";
import { desc } from "drizzle-orm";

export const getServices = async (req: Request, res: Response) => {
    try {
        const allServices = await db
            .select({
                id: services.id,
                serviceName: services.serviceName,
                description: services.description,
                mapIconColor: services.mapIconColor,
                isActive: services.isActive,
            })
            .from(services)
            .orderBy(services.id);

        return res.status(200).json({
            success: true,
            services: allServices,
        });
    } catch (error) {
        console.error("Error fetching services:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch services",
        });
    }
};
