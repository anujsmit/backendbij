// src/controllers/servicesController.ts
import { Request, Response } from "express";
import { db } from "../../db";
import { services } from "../../db/schema";
import { eq } from "drizzle-orm";

export const getServices = async (req: Request, res: Response) => {
    try {
        const allServices = await db
            .select({
                id: services.id,
                serviceName: services.serviceName,
                description: services.description,
                mapIconColor: services.mapIconColor,
                isActive: services.isActive,
                iconType: services.iconType,
                iconName: services.iconName,
                customIconUrl: services.customIconUrl,
                iconColor: services.iconColor,
            })
            .from(services)
            .where(eq(services.isActive, true))
            .orderBy(services.id);

        console.log('Services found:', allServices.length); // Debug log

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

export const getServiceById = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        
        const [service] = await db
            .select({
                id: services.id,
                serviceName: services.serviceName,
                description: services.description,
                mapIconColor: services.mapIconColor,
                isActive: services.isActive,
                iconType: services.iconType,
                iconName: services.iconName,
                customIconUrl: services.customIconUrl,
                iconColor: services.iconColor,
            })
            .from(services)
            .where(eq(services.id, id))
            .limit(1);

        if (!service) {
            return res.status(404).json({
                success: false,
                message: "Service not found",
            });
        }

        return res.status(200).json({
            success: true,
            service,
        });
    } catch (error) {
        console.error("Error fetching service by ID:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch service",
        });
    }
};

export const getActiveServices = async (req: Request, res: Response) => {
    try {
        const activeServices = await db
            .select({
                id: services.id,
                serviceName: services.serviceName,
                description: services.description,
                mapIconColor: services.mapIconColor,
                isActive: services.isActive,
                iconType: services.iconType,
                iconName: services.iconName,
                customIconUrl: services.customIconUrl,
                iconColor: services.iconColor,
            })
            .from(services)
            .where(eq(services.isActive, true))
            .orderBy(services.id);

        return res.status(200).json({
            success: true,
            count: activeServices.length,
            services: activeServices,
        });
    } catch (error) {
        console.error("Error fetching active services:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch active services",
        });
    }
};