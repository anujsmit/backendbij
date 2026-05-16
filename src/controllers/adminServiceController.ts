import { Request, Response } from "express";
import { db } from "../db";
import { services, platformServices } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { createAuditLog } from "../services/auditLog";

export const getAllServiceCategories = async (_req: Request, res: Response) => {
    try {
        const all = await db.select().from(services).orderBy(services.id);
        return res.json({ success: true, categories: all });
    } catch (error) {
        console.error("Error fetching service categories:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch categories" });
    }
};

const serviceCategorySchema = z.object({
    serviceName: z.string().min(1).max(100),
    description: z.string().optional(),
    mapIconColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    isActive: z.boolean().optional(),
});

export const createServiceCategory = async (req: Request, res: Response) => {
    try {
        const parsed = serviceCategorySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
        }
        const [created] = await db.insert(services).values(parsed.data).returning();
        return res.status(201).json({ success: true, category: created });
    } catch (error) {
        console.error("Error creating service category:", error);
        return res.status(500).json({ success: false, message: "Failed to create category" });
    }
};

export const updateServiceCategory = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string);
        const parsed = serviceCategorySchema.partial().safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
        }
        const [existing] = await db.select().from(services).where(eq(services.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Category not found" });

        const [updated] = await db.update(services).set(parsed.data).where(eq(services.id, id)).returning();
        return res.json({ success: true, category: updated });
    } catch (error) {
        console.error("Error updating service category:", error);
        return res.status(500).json({ success: false, message: "Failed to update category" });
    }
};

export const getAllPlatformServices = async (_req: Request, res: Response) => {
    try {
        const all = await db
            .select({
                id: platformServices.id,
                serviceId: platformServices.serviceId,
                name: platformServices.name,
                description: platformServices.description,
                price: platformServices.price,
                imageUrl: platformServices.imageUrl,
                isActive: platformServices.isActive,
                createdAt: platformServices.createdAt,
                updatedAt: platformServices.updatedAt,
                categoryName: services.serviceName,
            })
            .from(platformServices)
            .innerJoin(services, eq(platformServices.serviceId, services.id))
            .orderBy(services.id, platformServices.name);

        return res.json({ success: true, services: all });
    } catch (error) {
        console.error("Error fetching platform services:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch services" });
    }
};

const platformServiceSchema = z.object({
    serviceId: z.number().int().positive(),
    name: z.string().min(1).max(255),
    description: z.string().optional(),
    price: z.number().positive(),
    imageUrl: z.string().optional(),
    isActive: z.boolean().optional(),
});

export const createPlatformService = async (req: Request, res: Response) => {
    try {
        const parsed = platformServiceSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
        }
        const [created] = await db.insert(platformServices).values({
            ...parsed.data,
            price: String(parsed.data.price),
        }).returning();
        return res.status(201).json({ success: true, service: created });
    } catch (error) {
        console.error("Error creating platform service:", error);
        return res.status(500).json({ success: false, message: "Failed to create service" });
    }
};

export const updatePlatformService = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const parsed = platformServiceSchema.partial().safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.format() });
        }
        const [existing] = await db.select().from(platformServices).where(eq(platformServices.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Service not found" });

        const updateData: any = { ...parsed.data, updatedAt: new Date() };
        if (parsed.data.price !== undefined) {
            updateData.price = String(parsed.data.price);
        }

        const [updated] = await db.update(platformServices).set(updateData).where(eq(platformServices.id, id)).returning();
        return res.json({ success: true, service: updated });
    } catch (error) {
        console.error("Error updating platform service:", error);
        return res.status(500).json({ success: false, message: "Failed to update service" });
    }
};

export const deletePlatformService = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const adminId = req.user!.id;

        const [existing] = await db.select().from(platformServices).where(eq(platformServices.id, id)).limit(1);
        if (!existing) return res.status(404).json({ success: false, message: "Service not found" });

        const [updated] = await db.update(platformServices).set({ isActive: false, updatedAt: new Date() }).where(eq(platformServices.id, id)).returning();

        await createAuditLog({
            entityType: "platform_service",
            entityId: id,
            action: "deactivate",
            performedBy: adminId,
            performedByRole: "admin",
            oldValue: { isActive: true },
            newValue: { isActive: false },
        });

        return res.json({ success: true, service: updated });
    } catch (error) {
        console.error("Error deleting platform service:", error);
        return res.status(500).json({ success: false, message: "Failed to delete service" });
    }
};
