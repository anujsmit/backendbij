// backend/src/controllers/admin/adminOrderController.ts
import { Request, Response } from "express";
import { db } from "../../db";
import {
    orders,
    orderItems,
    orderTimeline,
    subOrders,
    subOrderItems,
    subOrderTimeline,
    users,                // ✅ Unified users table (customers, mistris, admins)
    mistriProfiles,
    services,
    serviceRequests,
} from "../../db/schema";
import { eq, and, desc, sql, ilike, or, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createNotification } from "../users/notificationController";
import { createAuditLog } from "../../services/auditLog";
import { z } from "zod";

// ============================================
// ALIASES
// ============================================

// ✅ Use unified users table with accountType filters
const customer = alias(users, "customer");
const mistri = alias(users, "mistri");

// ============================================
// BATCH ASSIGNMENT SCHEMA
// ============================================

const batchAssignSchema = z.object({
    assignments: z.array(z.object({
        subOrderId: z.string().uuid(),
        mistriId: z.string().uuid(),
        note: z.string().optional(),
    })).min(1, "At least one assignment is required"),
});

// ============================================
// VALID ORDER STATUS TYPES
// ============================================

type OrderStatus = 'pending' | 'confirmed' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'rejected';
type SubOrderStatus = 'pending' | 'confirmed' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';

function isValidOrderStatus(status: string): status is OrderStatus {
    return ['pending', 'confirmed', 'assigned', 'in_progress', 'completed', 'cancelled', 'rejected'].includes(status);
}

function isValidSubOrderStatus(status: string): status is SubOrderStatus {
    return ['pending', 'confirmed', 'assigned', 'in_progress', 'completed', 'cancelled'].includes(status);
}

async function getServiceName(serviceId: number): Promise<string> {
    try {
        const [service] = await db
            .select({ serviceName: services.serviceName })
            .from(services)
            .where(eq(services.id, serviceId))
            .limit(1);
        return service?.serviceName || 'Unknown';
    } catch {
        return 'Unknown';
    }
}

// ============================================
// GET ALL ORDERS
// ============================================

export const getAllOrders = async (req: Request, res: Response) => {
    try {
        const { status, page = "1", limit = "20", search } = req.query;
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const offset = (pageNum - 1) * limitNum;

        const conditions: any[] = [];
        if (status && status !== "all") {
            conditions.push(eq(orders.status, status as any));
        }

        if (search) {
            conditions.push(
                or(
                    ilike(orders.address, `%${search}%`),
                    sql`${orders.id}::text ilike ${`%${search}%`}`
                )!
            );
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // ✅ Use unified users table with accountType filters
        const ordersList = await db
            .select({
                id: orders.id,
                customerId: orders.customerId,
                customerName: customer.fullName,
                customerPhone: customer.phoneNumber,
                status: orders.status,
                paymentStatus: orders.paymentStatus,
                subtotal: orders.subtotal,
                tax: orders.tax,
                deliveryFee: orders.deliveryFee,
                discount: orders.discount,
                total: orders.total,
                address: orders.address,
                city: orders.city,
                zipCode: orders.zipCode,
                createdAt: orders.createdAt,
                assignedAt: orders.assignedAt,
                completedAt: orders.completedAt,
                cancelledAt: orders.cancelledAt,
                assignedMistriId: orders.assignedMistriId,
                mistriName: mistri.fullName,
                subOrderCount: sql<number>`(SELECT COUNT(*) FROM sub_orders WHERE sub_orders.order_id = orders.id)`,
                itemCount: sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = orders.id)`,
                assignedSubOrderCount: sql<number>`(SELECT COUNT(*) FROM sub_orders WHERE sub_orders.order_id = orders.id AND sub_orders.status IN ('assigned', 'in_progress', 'completed'))`,
            })
            .from(orders)
            .innerJoin(customer, and(
                eq(orders.customerId, customer.id),
                eq(customer.accountType, "user")
            ))
            .leftJoin(mistri, and(
                eq(orders.assignedMistriId, mistri.id),
                eq(mistri.accountType, "mistri")
            ))
            .where(whereClause)
            .orderBy(desc(orders.createdAt))
            .limit(limitNum)
            .offset(offset);

        let total = 0;
        try {
            const countResult = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(orders)
                .where(whereClause);
            total = countResult[0]?.count || 0;
        } catch (countError) {
            console.warn('Could not get order count:', countError);
            total = ordersList.length || 0;
        }

        return res.json({
            success: true,
            orders: ordersList || [],
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: total,
            },
        });
    } catch (error) {
        console.error("Error fetching all orders:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch orders"
        });
    }
};

// ============================================
// GET ORDER BY ID
// ============================================

export const getOrderById = async (req: Request, res: Response) => {
    try {
        const orderId = req.params.id;
        console.log('📦 Fetching order by ID:', orderId);

        const orderData = await db
            .select()
            .from(orders)
            .where(eq(orders.id, orderId))
            .limit(1);

        if (!orderData || orderData.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        const order = orderData[0];

        // ✅ Get customer details from unified users table
        const customerData = await db
            .select({
                fullName: users.fullName,
                phoneNumber: users.phoneNumber,
            })
            .from(users)
            .where(and(eq(users.id, order.customerId), eq(users.accountType, "user")))
            .limit(1);

        const customerInfo = customerData[0] || { fullName: '', phoneNumber: '' };

        // ✅ Get mistri details from unified users table
        let mistriName = null;
        if (order.assignedMistriId) {
            const mistriData = await db
                .select({ fullName: users.fullName })
                .from(users)
                .where(and(eq(users.id, order.assignedMistriId), eq(users.accountType, "mistri")))
                .limit(1);
            mistriName = mistriData[0]?.fullName || null;
        }

        // Get sub-orders with mistri details
        const subOrdersList = await db
            .select({
                id: subOrders.id,
                orderId: subOrders.orderId,
                categoryId: subOrders.categoryId,
                categoryName: subOrders.categoryName,
                status: subOrders.status,
                subtotal: subOrders.subtotal,
                tax: subOrders.tax,
                total: subOrders.total,
                assignedMistriId: subOrders.assignedMistriId,
                assignedAt: subOrders.assignedAt,
                completedAt: subOrders.completedAt,
                createdAt: subOrders.createdAt,
                adminNotes: subOrders.adminNotes,
                mistriName: users.fullName,
                mistriPhone: users.phoneNumber,
                mistriRating: mistriProfiles.averageRating,
                itemCount: sql<number>`(SELECT COUNT(*) FROM sub_order_items WHERE sub_order_items.sub_order_id = sub_orders.id)`,
            })
            .from(subOrders)
            .leftJoin(users, and(
                eq(subOrders.assignedMistriId, users.id),
                eq(users.accountType, "mistri")
            ))
            .leftJoin(mistriProfiles, eq(subOrders.assignedMistriId, mistriProfiles.mistriId))
            .where(eq(subOrders.orderId, orderId))
            .orderBy(desc(subOrders.createdAt));

        const subOrdersWithItems = await Promise.all(
            subOrdersList.map(async (subOrder) => {
                const subItems = await db
                    .select({
                        id: subOrderItems.id,
                        name: subOrderItems.name,
                        description: subOrderItems.description,
                        price: subOrderItems.price,
                        quantity: subOrderItems.quantity,
                        subtotal: subOrderItems.subtotal,
                        durationMinutes: subOrderItems.durationMinutes,
                        imageUrl: subOrderItems.imageUrl,
                    })
                    .from(subOrderItems)
                    .where(eq(subOrderItems.subOrderId, subOrder.id));

                const timeline = await db
                    .select({
                        id: subOrderTimeline.id,
                        status: subOrderTimeline.status,
                        note: subOrderTimeline.note,
                        metadata: subOrderTimeline.metadata,
                        createdAt: subOrderTimeline.createdAt,
                    })
                    .from(subOrderTimeline)
                    .where(eq(subOrderTimeline.subOrderId, subOrder.id))
                    .orderBy(desc(subOrderTimeline.createdAt));

                return {
                    ...subOrder,
                    items: subItems,
                    timeline: timeline,
                };
            })
        );

        const items = await db
            .select({
                id: orderItems.id,
                serviceItemId: orderItems.serviceItemId,
                name: orderItems.name,
                description: orderItems.description,
                price: orderItems.price,
                quantity: orderItems.quantity,
                subtotal: orderItems.subtotal,
                durationMinutes: orderItems.durationMinutes,
                imageUrl: orderItems.imageUrl,
                categoryId: orderItems.categoryId,
            })
            .from(orderItems)
            .where(eq(orderItems.orderId, orderId));

        const timeline = await db
            .select({
                id: orderTimeline.id,
                status: orderTimeline.status,
                note: orderTimeline.note,
                metadata: orderTimeline.metadata,
                createdAt: orderTimeline.createdAt,
            })
            .from(orderTimeline)
            .where(eq(orderTimeline.orderId, orderId))
            .orderBy(desc(orderTimeline.createdAt));

        const responseOrder = {
            id: String(order.id || ''),
            customerId: String(order.customerId || ''),
            customerName: String(customerInfo.fullName || ''),
            customerPhone: String(customerInfo.phoneNumber || ''),
            status: String(order.status || 'pending'),
            paymentStatus: String(order.paymentStatus || 'pending'),
            subtotal: parseFloat(String(order.subtotal || '0')),
            tax: parseFloat(String(order.tax || '0')),
            deliveryFee: parseFloat(String(order.deliveryFee || '0')),
            discount: parseFloat(String(order.discount || '0')),
            total: parseFloat(String(order.total || '0')),
            address: String(order.address || ''),
            city: order.city ? String(order.city) : null,
            zipCode: order.zipCode ? String(order.zipCode) : null,
            customerNotes: order.customerNotes ? String(order.customerNotes) : null,
            adminNotes: order.adminNotes ? String(order.adminNotes) : null,
            paymentMethod: String(order.paymentMethod || 'cash'),
            paymentDetails: order.paymentDetails || null,
            scheduledDate: order.scheduledDate || null,
            scheduledTime: order.scheduledTime ? String(order.scheduledTime) : null,
            createdAt: order.createdAt || new Date().toISOString(),
            assignedAt: order.assignedAt || null,
            completedAt: order.completedAt || null,
            cancelledAt: order.cancelledAt || null,
            assignedMistriId: order.assignedMistriId ? String(order.assignedMistriId) : null,
            mistriName: mistriName,
            items: items || [],
            subOrders: subOrdersWithItems || [],
            timeline: timeline || [],
            itemCount: items?.length || 0,
            subOrderCount: subOrdersWithItems?.length || 0,
            assignedSubOrderCount: subOrdersWithItems?.filter(so =>
                ['assigned', 'in_progress', 'completed'].includes(so.status)
            ).length || 0,
        };

        return res.json({
            success: true,
            order: responseOrder,
        });
    } catch (error) {
        console.error("Error fetching order:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch order"
        });
    }
};

// ============================================
// GET SUB-ORDERS BY ORDER
// ============================================

export const getSubOrdersByOrder = async (req: Request, res: Response) => {
    try {
        const orderId = req.params.id;
        const adminId = (req as any).user?.userId;

        if (!adminId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const subOrdersList = await db
            .select({
                id: subOrders.id,
                orderId: subOrders.orderId,
                categoryId: subOrders.categoryId,
                categoryName: subOrders.categoryName,
                status: subOrders.status,
                subtotal: subOrders.subtotal,
                tax: subOrders.tax,
                total: subOrders.total,
                assignedMistriId: subOrders.assignedMistriId,
                assignedAt: subOrders.assignedAt,
                completedAt: subOrders.completedAt,
                createdAt: subOrders.createdAt,
                adminNotes: subOrders.adminNotes,
                mistriName: users.fullName,
                mistriPhone: users.phoneNumber,
                itemCount: sql<number>`(SELECT COUNT(*) FROM sub_order_items WHERE sub_order_items.sub_order_id = sub_orders.id)`,
            })
            .from(subOrders)
            .leftJoin(users, and(
                eq(subOrders.assignedMistriId, users.id),
                eq(users.accountType, "mistri")
            ))
            .where(eq(subOrders.orderId, orderId))
            .orderBy(desc(subOrders.createdAt));

        const subOrdersWithItems = await Promise.all(
            subOrdersList.map(async (subOrder) => {
                const items = await db
                    .select({
                        id: subOrderItems.id,
                        name: subOrderItems.name,
                        description: subOrderItems.description,
                        price: subOrderItems.price,
                        quantity: subOrderItems.quantity,
                        subtotal: subOrderItems.subtotal,
                        durationMinutes: subOrderItems.durationMinutes,
                        imageUrl: subOrderItems.imageUrl,
                    })
                    .from(subOrderItems)
                    .where(eq(subOrderItems.subOrderId, subOrder.id));

                const timeline = await db
                    .select({
                        id: subOrderTimeline.id,
                        status: subOrderTimeline.status,
                        note: subOrderTimeline.note,
                        metadata: subOrderTimeline.metadata,
                        createdAt: subOrderTimeline.createdAt,
                    })
                    .from(subOrderTimeline)
                    .where(eq(subOrderTimeline.subOrderId, subOrder.id))
                    .orderBy(desc(subOrderTimeline.createdAt));

                return {
                    ...subOrder,
                    items: items || [],
                    timeline: timeline || [],
                };
            })
        );

        const orderDetails = await db
            .select({
                id: orders.id,
                status: orders.status,
                address: orders.address,
                customerName: users.fullName,
                customerPhone: users.phoneNumber,
            })
            .from(orders)
            .innerJoin(users, and(
                eq(orders.customerId, users.id),
                eq(users.accountType, "user")
            ))
            .where(eq(orders.id, orderId))
            .limit(1);

        return res.json({
            success: true,
            subOrders: subOrdersWithItems || [],
            count: subOrdersWithItems.length,
            order: orderDetails[0] || null,
            summary: {
                total: subOrdersWithItems.length,
                assigned: subOrdersWithItems.filter(so => so.status === 'assigned' || so.status === 'in_progress').length,
                completed: subOrdersWithItems.filter(so => so.status === 'completed').length,
                pending: subOrdersWithItems.filter(so => so.status === 'pending').length,
            }
        });
    } catch (error) {
        console.error("Error fetching sub-orders:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch sub-orders"
        });
    }
};

// ============================================
// ASSIGN MISTRI TO SUB-ORDER
// ============================================

export const assignMistriToSubOrder = async (req: Request, res: Response) => {
    try {
        const adminId = (req as any).user?.userId;
        const subOrderId = req.params.id;
        const { mistriId, note } = req.body;

        if (!adminId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        if (!mistriId) {
            return res.status(400).json({
                success: false,
                message: "Mistri ID is required"
            });
        }

        const subOrderResult = await db
            .select({
                id: subOrders.id,
                status: subOrders.status,
                orderId: subOrders.orderId,
                categoryId: subOrders.categoryId,
                categoryName: subOrders.categoryName,
                subtotal: subOrders.subtotal,
            })
            .from(subOrders)
            .where(eq(subOrders.id, subOrderId))
            .limit(1);

        if (!subOrderResult || subOrderResult.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Sub-order not found"
            });
        }

        const subOrder = subOrderResult[0];

        if (!['pending', 'confirmed'].includes(subOrder.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot assign sub-order with status: ${subOrder.status}. Only pending or confirmed sub-orders can be assigned.`
            });
        }

        const [mainOrder] = await db
            .select()
            .from(orders)
            .where(eq(orders.id, subOrder.orderId))
            .limit(1);

        if (!mainOrder) {
            return res.status(404).json({
                success: false,
                message: "Main order not found"
            });
        }

        // ✅ Check mistri from unified users table
        const mistriResult = await db
            .select({
                id: users.id,
                fullName: users.fullName,
                phoneNumber: users.phoneNumber,
                approvalStatus: mistriProfiles.approvalStatus,
                serviceId: mistriProfiles.serviceId,
                isAvailable: mistriProfiles.isAvailable,
                availabilityStatus: mistriProfiles.availabilityStatus,
            })
            .from(users)
            .leftJoin(mistriProfiles, eq(users.id, mistriProfiles.mistriId))
            .where(and(eq(users.id, mistriId), eq(users.accountType, "mistri")))
            .limit(1);

        if (!mistriResult || mistriResult.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Mistri not found"
            });
        }

        const mistri = mistriResult[0];

        if (mistri.approvalStatus !== 'approved') {
            return res.status(400).json({
                success: false,
                message: "Mistri is not approved yet"
            });
        }

        if (!mistri.isAvailable) {
            return res.status(400).json({
                success: false,
                message: "Mistri is currently unavailable. Please select another professional."
            });
        }

        if (mistri.serviceId !== subOrder.categoryId) {
            const categoryResult = await db
                .select({ serviceName: services.serviceName })
                .from(services)
                .where(eq(services.id, subOrder.categoryId))
                .limit(1);
            const categoryName = categoryResult[0]?.serviceName || subOrder.categoryName;

            return res.status(400).json({
                success: false,
                message: `Mistri is not qualified for ${categoryName} work. Please select a ${categoryName} professional.`,
                requiredCategory: categoryName,
                mistriCategory: mistri.serviceId ? await getServiceName(mistri.serviceId) : 'Unknown'
            });
        }

        const activeJobs = await db
            .select({ id: serviceRequests.id })
            .from(serviceRequests)
            .where(
                and(
                    eq(serviceRequests.assignedMistriId, mistriId),
                    eq(serviceRequests.status, 'assigned')
                )
            );

        if (activeJobs.length > 0) {
            return res.status(409).json({
                success: false,
                message: `${mistri.fullName} already has an active job.`,
                activeJobId: activeJobs[0].id,
                forceAvailable: true
            });
        }

        const updatedResult = await db
            .update(subOrders)
            .set({
                status: 'assigned',
                assignedMistriId: mistriId,
                assignedAt: new Date(),
                updatedAt: new Date(),
                adminNotes: note || null,
            })
            .where(eq(subOrders.id, subOrderId))
            .returning();

        const updatedSubOrder = updatedResult[0];

        await db.insert(subOrderTimeline).values({
            subOrderId: subOrderId,
            status: 'assigned' as const,
            note: `Assigned to ${mistri.fullName}`,
            metadata: {
                mistriId,
                assignedBy: adminId,
                mistriName: mistri.fullName,
                mistriPhone: mistri.phoneNumber
            },
        });

        await db.update(mistriProfiles)
            .set({
                availabilityStatus: 'unavailable',
                isAvailable: false,
            })
            .where(eq(mistriProfiles.mistriId, mistriId));

        const allSubOrders = await db
            .select({
                status: subOrders.status,
                id: subOrders.id
            })
            .from(subOrders)
            .where(eq(subOrders.orderId, subOrder.orderId));

        const allAssigned = allSubOrders.every((so: any) =>
            ['assigned', 'in_progress', 'completed'].includes(so.status)
        );
        const anyAssigned = allSubOrders.some((so: any) =>
            ['assigned', 'in_progress', 'completed'].includes(so.status)
        );

        let orderStatusUpdate: { status?: OrderStatus; assignedAt?: Date; updatedAt?: Date } = {};
        if (allAssigned) {
            orderStatusUpdate = {
                status: 'assigned',
                assignedAt: new Date(),
                updatedAt: new Date(),
            };
        } else if (anyAssigned && mainOrder.status === 'pending') {
            orderStatusUpdate = {
                status: 'confirmed',
                updatedAt: new Date(),
            };
        }

        if (Object.keys(orderStatusUpdate).length > 0) {
            const updateData: any = { updatedAt: new Date() };
            if (orderStatusUpdate.status) {
                updateData.status = orderStatusUpdate.status;
            }
            if (orderStatusUpdate.assignedAt) {
                updateData.assignedAt = orderStatusUpdate.assignedAt;
            }

            await db.update(orders)
                .set(updateData)
                .where(eq(orders.id, subOrder.orderId));

            const timelineStatus = orderStatusUpdate.status || mainOrder.status;
            if (isValidOrderStatus(timelineStatus)) {
                await db.insert(orderTimeline).values({
                    orderId: subOrder.orderId,
                    status: timelineStatus,
                    note: allAssigned
                        ? `All sub-orders assigned. Order is now fully assigned.`
                        : `Sub-order assigned. Order is now confirmed.`,
                    metadata: {
                        subOrderId,
                        assignedMistriId: mistriId,
                    },
                });
            }
        }

        await createNotification(
            mistriId,
            "New Sub-Order Assigned",
            `You have been assigned a ${subOrder.categoryName} sub-order for order #${subOrder.orderId.slice(0, 8).toUpperCase()}.`,
            "sub_order_assigned",
            subOrderId
        );

        await createNotification(
            mainOrder.customerId,
            "Sub-Order Assigned",
            `A ${subOrder.categoryName} professional has been assigned to your order. ${mistri.fullName} will contact you shortly.`,
            "sub_order_assigned",
            subOrder.orderId
        );

        await createAuditLog({
            entityType: "sub_order",
            entityId: subOrderId,
            action: "assign_mistri",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            oldValue: {
                status: subOrder.status,
                assignedMistriId: null
            },
            newValue: {
                status: "assigned",
                assignedMistriId: mistriId,
                assignedAt: new Date().toISOString()
            },
            metadata: {
                note,
                mistriName: mistri.fullName,
                mistriPhone: mistri.phoneNumber,
                orderId: subOrder.orderId
            },
        });

        const finalSubOrder = await db
            .select({
                id: subOrders.id,
                status: subOrders.status,
                assignedMistriId: subOrders.assignedMistriId,
                assignedAt: subOrders.assignedAt,
                mistriName: users.fullName,
                mistriPhone: users.phoneNumber,
            })
            .from(subOrders)
            .leftJoin(users, and(
                eq(subOrders.assignedMistriId, users.id),
                eq(users.accountType, "mistri")
            ))
            .where(eq(subOrders.id, subOrderId))
            .limit(1);

        return res.json({
            success: true,
            message: "Sub-order assigned successfully",
            subOrder: finalSubOrder[0],
            orderStatus: orderStatusUpdate.status || mainOrder.status,
            allAssigned: allAssigned,
            pendingCount: allSubOrders.filter((so: any) => so.status === 'pending' || so.status === 'confirmed').length,
        });
    } catch (error) {
        console.error("Error assigning mistri to sub-order:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to assign mistri to sub-order"
        });
    }
};

// ============================================
// BATCH ASSIGN SUB-ORDERS
// ============================================

export const batchAssignSubOrders = async (req: Request, res: Response) => {
    try {
        const adminId = (req as any).user?.userId;
        const { orderId, assignments } = req.body;

        if (!adminId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        if (!orderId) {
            return res.status(400).json({
                success: false,
                message: "Order ID is required"
            });
        }

        const parsed = batchAssignSchema.safeParse({ assignments });
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid assignments data",
                errors: parsed.error.format()
            });
        }

        const subOrdersList = await db
            .select({
                id: subOrders.id,
                status: subOrders.status,
                categoryId: subOrders.categoryId,
                categoryName: subOrders.categoryName,
            })
            .from(subOrders)
            .where(eq(subOrders.orderId, orderId));

        if (subOrdersList.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No sub-orders found for this order"
            });
        }

        const results = [];
        const errors = [];

        for (const assignment of assignments) {
            try {
                const subOrder = subOrdersList.find(so => so.id === assignment.subOrderId);
                if (!subOrder) {
                    errors.push({
                        subOrderId: assignment.subOrderId,
                        error: "Sub-order not found or doesn't belong to this order"
                    });
                    continue;
                }

                if (['assigned', 'in_progress', 'completed'].includes(subOrder.status)) {
                    errors.push({
                        subOrderId: assignment.subOrderId,
                        error: `Sub-order already ${subOrder.status}`
                    });
                    continue;
                }

                // ✅ Check mistri from unified users table
                const mistriInfo = await db
                    .select({
                        id: users.id,
                        fullName: users.fullName,
                        phoneNumber: users.phoneNumber,
                        approvalStatus: mistriProfiles.approvalStatus,
                        serviceId: mistriProfiles.serviceId,
                        isAvailable: mistriProfiles.isAvailable,
                    })
                    .from(users)
                    .leftJoin(mistriProfiles, eq(users.id, mistriProfiles.mistriId))
                    .where(and(eq(users.id, assignment.mistriId), eq(users.accountType, "mistri")))
                    .limit(1);

                if (!mistriInfo || mistriInfo.length === 0) {
                    errors.push({
                        subOrderId: assignment.subOrderId,
                        error: "Mistri not found"
                    });
                    continue;
                }

                const mistri = mistriInfo[0];

                if (mistri.approvalStatus !== 'approved') {
                    errors.push({
                        subOrderId: assignment.subOrderId,
                        error: "Mistri is not approved yet"
                    });
                    continue;
                }

                if (!mistri.isAvailable) {
                    errors.push({
                        subOrderId: assignment.subOrderId,
                        error: "Mistri is currently unavailable"
                    });
                    continue;
                }

                if (mistri.serviceId !== subOrder.categoryId) {
                    const categoryResult = await db
                        .select({ serviceName: services.serviceName })
                        .from(services)
                        .where(eq(services.id, subOrder.categoryId))
                        .limit(1);
                    const categoryName = categoryResult[0]?.serviceName || subOrder.categoryName;

                    errors.push({
                        subOrderId: assignment.subOrderId,
                        error: `Mistri is not qualified for ${categoryName} work`
                    });
                    continue;
                }

                const updatedResult = await db
                    .update(subOrders)
                    .set({
                        status: 'assigned',
                        assignedMistriId: assignment.mistriId,
                        assignedAt: new Date(),
                        updatedAt: new Date(),
                        adminNotes: assignment.note || null,
                    })
                    .where(eq(subOrders.id, assignment.subOrderId))
                    .returning();

                if (updatedResult.length === 0) {
                    errors.push({
                        subOrderId: assignment.subOrderId,
                        error: "Failed to update sub-order"
                    });
                    continue;
                }

                const [mistriUser] = await db
                    .select({
                        fullName: users.fullName,
                        phoneNumber: users.phoneNumber,
                    })
                    .from(users)
                    .where(and(eq(users.id, assignment.mistriId), eq(users.accountType, "mistri")))
                    .limit(1);

                await db.insert(subOrderTimeline).values({
                    subOrderId: assignment.subOrderId,
                    status: 'assigned' as const,
                    note: `Assigned to ${mistriUser?.fullName || 'Mistri'} (batch assignment)`,
                    metadata: {
                        mistriId: assignment.mistriId,
                        assignedBy: adminId,
                        batch: true,
                        orderId
                    },
                });

                await db.update(mistriProfiles)
                    .set({
                        availabilityStatus: 'unavailable',
                        isAvailable: false,
                    })
                    .where(eq(mistriProfiles.mistriId, assignment.mistriId));

                results.push({
                    subOrderId: assignment.subOrderId,
                    mistriId: assignment.mistriId,
                    success: true,
                    mistriName: mistriUser?.fullName || 'Unknown',
                });

            } catch (error) {
                errors.push({
                    subOrderId: assignment.subOrderId,
                    error: error instanceof Error ? error.message : "Unknown error"
                });
            }
        }

        const allSubOrders = await db
            .select({ status: subOrders.status })
            .from(subOrders)
            .where(eq(subOrders.orderId, orderId));

        const allAssigned = allSubOrders.every((so: any) =>
            ['assigned', 'in_progress', 'completed'].includes(so.status)
        );

        if (allAssigned) {
            await db.update(orders)
                .set({
                    status: 'assigned',
                    assignedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(orders.id, orderId));

            const [orderInfo] = await db
                .select({ customerId: orders.customerId })
                .from(orders)
                .where(eq(orders.id, orderId))
                .limit(1);

            if (orderInfo) {
                await createNotification(
                    orderInfo.customerId,
                    "Order Fully Assigned",
                    `All services for your order have been assigned to professionals. They will contact you shortly.`,
                    "order_assigned",
                    orderId
                );
            }

            await createAuditLog({
                entityType: "order",
                entityId: orderId,
                action: "batch_assign_complete",
                performedBy: adminId || 'system',
                performedByRole: "admin",
                newValue: {
                    status: "assigned",
                    assignedAt: new Date().toISOString(),
                    subOrdersAssigned: results.length
                },
                metadata: {
                    totalSubOrders: allSubOrders.length,
                    successfulAssignments: results.length,
                    failedAssignments: errors.length
                },
            });
        }

        return res.json({
            success: true,
            message: allAssigned
                ? "All sub-orders assigned successfully. Order is now fully assigned."
                : `${results.length} sub-orders assigned. ${allSubOrders.length - results.length} sub-orders remaining.`,
            results,
            errors,
            summary: {
                total: allSubOrders.length,
                assigned: results.length,
                failed: errors.length,
                allAssigned,
            }
        });

    } catch (error) {
        console.error("Error in batch assignment:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to batch assign sub-orders"
        });
    }
};

// ============================================
// GET ORDER ASSIGNMENT STATUS
// ============================================

export const getOrderAssignmentStatus = async (req: Request, res: Response) => {
    try {
        const orderId = req.params.id;

        const [order] = await db
            .select({
                id: orders.id,
                status: orders.status,
                assignedAt: orders.assignedAt,
                completedAt: orders.completedAt,
            })
            .from(orders)
            .where(eq(orders.id, orderId))
            .limit(1);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        const subOrdersList = await db
            .select({
                id: subOrders.id,
                categoryName: subOrders.categoryName,
                status: subOrders.status,
                assignedMistriId: subOrders.assignedMistriId,
                assignedAt: subOrders.assignedAt,
                completedAt: subOrders.completedAt,
                mistriName: users.fullName,
                mistriPhone: users.phoneNumber,
            })
            .from(subOrders)
            .leftJoin(users, and(
                eq(subOrders.assignedMistriId, users.id),
                eq(users.accountType, "mistri")
            ))
            .where(eq(subOrders.orderId, orderId))
            .orderBy(desc(subOrders.createdAt));

        const summary = {
            total: subOrdersList.length,
            pending: subOrdersList.filter((so: any) => so.status === 'pending').length,
            confirmed: subOrdersList.filter((so: any) => so.status === 'confirmed').length,
            assigned: subOrdersList.filter((so: any) => so.status === 'assigned' || so.status === 'in_progress').length,
            completed: subOrdersList.filter((so: any) => so.status === 'completed').length,
            cancelled: subOrdersList.filter((so: any) => so.status === 'cancelled').length,
        };

        const isFullyAssigned = summary.assigned + summary.completed === summary.total;
        const isFullyCompleted = summary.completed === summary.total;

        return res.json({
            success: true,
            order: {
                id: order.id,
                status: order.status,
                isFullyAssigned,
                isFullyCompleted,
            },
            subOrders: subOrdersList,
            summary,
            canAssign: summary.pending > 0 || summary.confirmed > 0,
        });

    } catch (error) {
        console.error("Error fetching order assignment status:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch assignment status"
        });
    }
};

// ============================================
// ASSIGN ENTIRE ORDER (Legacy)
// ============================================

export const assignMistriToOrder = async (req: Request, res: Response) => {
    try {
        const adminId = (req as any).user?.userId;
        const orderId = req.params.id;
        const { mistriId, note } = req.body;

        if (!adminId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        if (!mistriId) {
            return res.status(400).json({
                success: false,
                message: "Mistri ID is required"
            });
        }

        const orderResult = await db
            .select({
                id: orders.id,
                status: orders.status,
                customerId: orders.customerId,
                address: orders.address,
            })
            .from(orders)
            .where(eq(orders.id, orderId))
            .limit(1);

        if (!orderResult || orderResult.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        const order = orderResult[0];

        // ✅ Check mistri from unified users table
        const mistriResult = await db
            .select({
                id: users.id,
                fullName: users.fullName,
                phoneNumber: users.phoneNumber,
                approvalStatus: mistriProfiles.approvalStatus,
                serviceId: mistriProfiles.serviceId,
            })
            .from(users)
            .leftJoin(mistriProfiles, eq(users.id, mistriProfiles.mistriId))
            .where(and(eq(users.id, mistriId), eq(users.accountType, "mistri")))
            .limit(1);

        if (!mistriResult || mistriResult.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Mistri not found"
            });
        }

        const mistri = mistriResult[0];

        if (mistri.approvalStatus !== 'approved') {
            return res.status(400).json({
                success: false,
                message: "Mistri is not approved yet"
            });
        }

        const subOrdersList = await db
            .select({
                id: subOrders.id,
                categoryId: subOrders.categoryId,
                status: subOrders.status
            })
            .from(subOrders)
            .where(eq(subOrders.orderId, orderId));

        const mismatchedCategories = [];
        for (const subOrder of subOrdersList) {
            if (mistri.serviceId !== subOrder.categoryId) {
                const categoryName = await getServiceName(subOrder.categoryId);
                mismatchedCategories.push(categoryName);
            }
        }

        if (mismatchedCategories.length > 0) {
            if (subOrdersList.length > 1) {
                return res.status(400).json({
                    success: false,
                    message: `This order has multiple service categories (${mismatchedCategories.join(', ')}). Please assign each sub-order separately to the appropriate professional.`,
                    mismatchedCategories,
                    suggestion: "Use the 'Assign Sub-Order' feature for each service category.",
                    subOrders: subOrdersList.map(so => ({
                        id: so.id,
                        categoryId: so.categoryId,
                    })),
                });
            } else {
                return res.status(400).json({
                    success: false,
                    message: `Mistri is not qualified for ${mismatchedCategories[0]} work. Please select a ${mismatchedCategories[0]} professional.`,
                    requiredCategory: mismatchedCategories[0],
                });
            }
        }

        for (const subOrder of subOrdersList) {
            await db.update(subOrders)
                .set({
                    status: 'assigned',
                    assignedMistriId: mistriId,
                    assignedAt: new Date(),
                    updatedAt: new Date(),
                    adminNotes: note || null,
                })
                .where(eq(subOrders.id, subOrder.id));

            await db.insert(subOrderTimeline).values({
                subOrderId: subOrder.id,
                status: 'assigned' as const,
                note: `Assigned to ${mistri.fullName}`,
                metadata: { mistriId, assignedBy: adminId },
            });
        }

        const updatedResult = await db
            .update(orders)
            .set({
                status: 'assigned',
                assignedMistriId: mistriId,
                assignedAt: new Date(),
                updatedAt: new Date(),
                adminNotes: note || null,
            })
            .where(eq(orders.id, orderId))
            .returning();

        const updatedOrder = updatedResult[0];

        await db.update(mistriProfiles)
            .set({
                availabilityStatus: 'unavailable',
                isAvailable: false,
            })
            .where(eq(mistriProfiles.mistriId, mistriId));

        await createNotification(
            mistriId,
            "New Order Assigned",
            `You have been assigned a new order. Address: ${order.address}`,
            "order_assigned",
            orderId
        );

        await createNotification(
            order.customerId,
            "Order Assigned",
            `Your order has been assigned to ${mistri.fullName}. They will contact you shortly.`,
            "order_assigned",
            orderId
        );

        await createAuditLog({
            entityType: "order",
            entityId: orderId,
            action: "assign_mistri",
            performedBy: adminId || 'system',
            performedByRole: "admin",
            oldValue: { status: order.status, assignedMistriId: null },
            newValue: { status: "assigned", assignedMistriId: mistriId },
            metadata: { note, subOrdersAssigned: subOrdersList.length },
        });

        return res.json({
            success: true,
            message: "Order assigned successfully",
            order: updatedOrder,
        });
    } catch (error) {
        console.error("Error assigning mistri to order:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to assign mistri to order"
        });
    }
};

// ============================================
// UPDATE ORDER STATUS
// ============================================

export const updateOrderStatus = async (req: Request, res: Response) => {
    try {
        const adminId = (req as any).user?.userId;
        const orderId = req.params.id;
        const { status, note } = req.body;

        if (!adminId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        if (!status) {
            return res.status(400).json({
                success: false,
                message: "Status is required"
            });
        }

        if (!isValidOrderStatus(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status: ${status}. Must be one of: pending, confirmed, assigned, in_progress, completed, cancelled, rejected`
            });
        }

        const orderResult = await db
            .select({ status: orders.status })
            .from(orders)
            .where(eq(orders.id, orderId))
            .limit(1);

        if (!orderResult || orderResult.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        const currentStatus = orderResult[0].status;

        const updateData: any = {
            status: status,
            updatedAt: new Date(),
        };

        if (status === 'confirmed') updateData.confirmedAt = new Date();
        if (status === 'completed') updateData.completedAt = new Date();
        if (status === 'cancelled') updateData.cancelledAt = new Date();

        if (note) updateData.adminNotes = note;

        const updatedResult = await db
            .update(orders)
            .set(updateData)
            .where(eq(orders.id, orderId))
            .returning();

        const updatedOrder = updatedResult[0];

        if (isValidSubOrderStatus(status)) {
            await db.update(subOrders)
                .set({
                    status: status as SubOrderStatus,
                    updatedAt: new Date(),
                })
                .where(eq(subOrders.orderId, orderId));
        }

        await db.insert(orderTimeline).values({
            orderId: orderId,
            status: status,
            note: note || `Status updated to ${status}`,
            metadata: { updatedBy: adminId, previousStatus: currentStatus },
        });

        await createAuditLog({
            entityType: "order",
            entityId: orderId,
            action: `status_update_${status}`,
            performedBy: adminId || 'system',
            performedByRole: "admin",
            oldValue: { status: currentStatus },
            newValue: { status: status },
            metadata: { note },
        });

        return res.json({
            success: true,
            message: `Order ${status} successfully`,
            order: updatedOrder,
        });
    } catch (error) {
        console.error("Error updating order status:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update order status"
        });
    }
};

// ============================================
// GET ORDER COUNTS
// ============================================

export const getOrderCounts = async (req: Request, res: Response) => {
    try {
        const counts = await db
            .select({
                status: orders.status,
                count: sql<number>`count(*)::int`,
            })
            .from(orders)
            .groupBy(orders.status);

        const result: Record<string, number> = {
            pending: 0,
            confirmed: 0,
            assigned: 0,
            in_progress: 0,
            completed: 0,
            cancelled: 0,
            rejected: 0,
        };

        counts.forEach((row) => {
            result[row.status] = row.count;
        });

        return res.json({
            success: true,
            counts: result,
        });
    } catch (error) {
        console.error("Error fetching order counts:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch order counts"
        });
    }
};