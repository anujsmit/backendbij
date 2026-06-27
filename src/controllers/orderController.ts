// backend/src/controllers/orderController.ts

import { Request, Response } from "express";
import { db } from "../db";
import { 
    orders, 
    orderItems, 
    orderTimeline,
    subOrders,
    subOrderItems,
    subOrderTimeline,
    serviceItems,
    serviceSubCategories,
    services,
    users, 
    mistriProfiles,
    cartItems,
    serviceCategories,
} from "../db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { createNotification } from "./notificationController";
import { createAuditLog } from "../services/auditLog";
import { sendOrderEmail, sendCustomerOrderEmail } from "../services/emailService";

// ============================================
// VALIDATION SCHEMAS
// ============================================

const createOrderSchema = z.object({
    items: z.array(z.object({
        serviceItemId: z.string().uuid(),
        quantity: z.number().int().min(1),
    })).min(1, "At least one item is required"),
    address: z.string().min(1, "Address is required"),
    city: z.string().optional(),
    zipCode: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    customerNotes: z.string().optional(),
    paymentMethod: z.enum(['cash', 'card', 'online']).default('cash'),
    scheduledDate: z.string().datetime().optional(),
    scheduledTime: z.string().optional(),
    email: z.string().email().optional(),
});

const updateOrderStatusSchema = z.object({
    status: z.enum(['pending', 'confirmed', 'assigned', 'in_progress', 'completed', 'cancelled', 'rejected']),
    note: z.string().optional(),
    mistriId: z.string().uuid().optional(),
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Ensure categories exist for service items
 */
async function ensureCategoriesForServiceItems(serviceItemsData: any[]): Promise<any[]> {
    const enrichedItems = [];

    for (const item of serviceItemsData) {
        // If item already has a category, use it
        if (item.categoryId) {
            enrichedItems.push(item);
            continue;
        }

        console.log(`🔍 Checking category for item: ${item.name} (${item.id})`);

        // Try to find category through sub-category
        if (item.subCategoryId) {
            // Check if sub-category exists
            let subCategory = await db
                .select({
                    id: serviceSubCategories.id,
                    categoryId: serviceSubCategories.categoryId,
                    name: serviceSubCategories.name,
                })
                .from(serviceSubCategories)
                .where(eq(serviceSubCategories.id, item.subCategoryId))
                .limit(1);

            // If sub-category doesn't exist, create it
            if (subCategory.length === 0) {
                console.log(`📝 Creating sub-category for item: ${item.name}`);
                
                // Create a category first
                const categoryName = determineCategoryFromItemName(item.name);
                let categoryId = await getOrCreateCategory(categoryName);
                
                // Create sub-category
                const [newSubCategory] = await db
                    .insert(serviceSubCategories)
                    .values({
                        categoryId: categoryId,
                        name: `${categoryName} Services`,
                        isActive: true,
                        isPopular: false,
                    })
                    .returning();
                
                subCategory = [newSubCategory];
                
                // Update the service item with the new sub-category
                await db
                    .update(serviceItems)
                    .set({ subCategoryId: newSubCategory.id })
                    .where(eq(serviceItems.id, item.id));
                
                console.log(`✅ Created sub-category: ${newSubCategory.name} with category ID: ${categoryId}`);
            }

            // Now get the category
            if (subCategory[0]?.categoryId) {
                const category = await db
                    .select({
                        id: services.id,
                        serviceName: services.serviceName,
                    })
                    .from(services)
                    .where(eq(services.id, subCategory[0].categoryId))
                    .limit(1);

                if (category.length > 0) {
                    enrichedItems.push({
                        ...item,
                        categoryId: category[0].id,
                        categoryName: category[0].serviceName,
                    });
                    continue;
                }
            }
        }

        // If still no category, create one based on item name
        console.log(`📝 Creating new category for item: ${item.name}`);
        const categoryName = determineCategoryFromItemName(item.name);
        const categoryId = await getOrCreateCategory(categoryName);
        
        // Create a sub-category for this item
        const [newSubCategory] = await db
            .insert(serviceSubCategories)
            .values({
                categoryId: categoryId,
                name: `${categoryName} Services`,
                isActive: true,
                isPopular: false,
            })
            .returning();

        // Update the service item
        await db
            .update(serviceItems)
            .set({ subCategoryId: newSubCategory.id })
            .where(eq(serviceItems.id, item.id));

        enrichedItems.push({
            ...item,
            categoryId: categoryId,
            categoryName: categoryName,
            subCategoryId: newSubCategory.id,
        });

        console.log(`✅ Created category: ${categoryName} with ID: ${categoryId}`);
    }

    return enrichedItems;
}

/**
 * Determine category name from item name
 */
function determineCategoryFromItemName(itemName: string): string {
    const name = itemName.toLowerCase();
    
    if (name.includes('plumb') || name.includes('pipe') || name.includes('tap')) {
        return 'Plumber';
    } else if (name.includes('electrical') || name.includes('electric') || name.includes('wire') || name.includes('repair')) {
        return 'Electrician';
    } else if (name.includes('paint')) {
        return 'Painter';
    } else if (name.includes('carpent') || name.includes('wood') || name.includes('furniture')) {
        return 'Carpenter';
    } else if (name.includes('clean') || name.includes('housekeeping')) {
        return 'Cleaner';
    } else if (name.includes('ac') || name.includes('air condition') || name.includes('cooling')) {
        return 'AC Repair';
    } else {
        return 'General Services';
    }
}

/**
 * Get or create a category
 */
async function getOrCreateCategory(categoryName: string): Promise<number> {
    // Check if category exists
    const existingCategory = await db
        .select({ id: services.id })
        .from(services)
        .where(eq(services.serviceName, categoryName))
        .limit(1);

    if (existingCategory.length > 0) {
        return existingCategory[0].id;
    }

    // Create new category
    console.log(`📝 Creating new service category: ${categoryName}`);
    const [newCategory] = await db
        .insert(services)
        .values({
            serviceName: categoryName,
            description: `${categoryName} services`,
            isActive: true,
            mapIconColor: getCategoryColor(categoryName),
        })
        .returning();

    return newCategory.id;
}

/**
 * Get color for category
 */
function getCategoryColor(categoryName: string): string {
    const colors: Record<string, string> = {
        'Plumber': '#e67e22',
        'Electrician': '#f1c40f',
        'Painter': '#3498db',
        'Carpenter': '#2ecc71',
        'Cleaner': '#1abc9c',
        'AC Repair': '#9b59b6',
        'General Services': '#95a5a6',
    };
    return colors[categoryName] || '#95a5a6';
}

/**
 * Create a new order with multiple items, split by category
 */
export const createOrder = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const parsed = createOrderSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid data",
                errors: parsed.error.format()
            });
        }

        const { 
            items, 
            address, 
            city, 
            zipCode, 
            latitude, 
            longitude, 
            customerNotes, 
            paymentMethod, 
            scheduledDate, 
            scheduledTime,
            email 
        } = parsed.data;

        // Log the items for debugging
        console.log('📦 Order items received:', JSON.stringify(items, null, 2));
        console.log('📦 Item IDs:', items.map(i => i.serviceItemId));

        // Get all service items with their details
        const itemIds = items.map(i => i.serviceItemId);
        
        // Get service items with category info
        let serviceItemsData = await db
            .select({
                id: serviceItems.id,
                name: serviceItems.name,
                description: serviceItems.description,
                price: serviceItems.price,
                durationMinutes: serviceItems.durationMinutes,
                imageUrl: serviceItems.imageUrl,
                subCategoryId: serviceItems.subCategoryId,
                categoryId: services.id,
                categoryName: services.serviceName,
            })
            .from(serviceItems)
            .leftJoin(serviceSubCategories, eq(serviceItems.subCategoryId, serviceSubCategories.id))
            .leftJoin(services, eq(serviceSubCategories.categoryId, services.id))
            .where(inArray(serviceItems.id, itemIds));

        // If no items found, try without joins
        if (serviceItemsData.length === 0) {
            console.log('⚠️ No service items found with joins, trying without...');
            
            const basicItems = await db
                .select({
                    id: serviceItems.id,
                    name: serviceItems.name,
                    description: serviceItems.description,
                    price: serviceItems.price,
                    durationMinutes: serviceItems.durationMinutes,
                    imageUrl: serviceItems.imageUrl,
                    subCategoryId: serviceItems.subCategoryId,
                })
                .from(serviceItems)
                .where(inArray(serviceItems.id, itemIds));

            if (basicItems.length === 0) {
                console.error('❌ No service items found for IDs:', itemIds);
                return res.status(400).json({
                    success: false,
                    message: "No valid service items found. Please refresh your cart and try again.",
                    itemIds: itemIds,
                });
            }

            serviceItemsData = basicItems.map(item => ({
                ...item,
                categoryId: null,
                categoryName: null,
            }));
        }

        console.log('✅ Found service items:', serviceItemsData.length);

        // Ensure all items have categories
        const enrichedItems = await ensureCategoriesForServiceItems(serviceItemsData);
        console.log('📊 Enriched items with categories:', enrichedItems.map(i => ({ name: i.name, category: i.categoryName })));

        // Group items by category
        const itemsByCategory: Record<string, {
            categoryId: number;
            categoryName: string;
            items: any[];
            subtotal: number;
        }> = {};

        let orderSubtotal = 0;

        for (const serviceItem of enrichedItems) {
            const quantity = items.find(i => i.serviceItemId === serviceItem.id)?.quantity || 1;
            const price = parseFloat(serviceItem.price);
            const itemSubtotal = price * quantity;
            orderSubtotal += itemSubtotal;

            // Ensure we have a category
            if (!serviceItem.categoryId) {
                console.error(`❌ Item still has no category after enrichment: ${serviceItem.name}`);
                continue;
            }

            const categoryKey = String(serviceItem.categoryId);
            
            if (!itemsByCategory[categoryKey]) {
                itemsByCategory[categoryKey] = {
                    categoryId: serviceItem.categoryId,
                    categoryName: serviceItem.categoryName || 'General',
                    items: [],
                    subtotal: 0,
                };
            }

            itemsByCategory[categoryKey].items.push({
                serviceItemId: serviceItem.id,
                name: serviceItem.name,
                description: serviceItem.description,
                price: price,
                quantity: quantity,
                subtotal: itemSubtotal,
                durationMinutes: serviceItem.durationMinutes,
                imageUrl: serviceItem.imageUrl,
                categoryId: serviceItem.categoryId,
                categoryName: serviceItem.categoryName,
            });

            itemsByCategory[categoryKey].subtotal += itemSubtotal;
        }

        // Check if we have any categories
        if (Object.keys(itemsByCategory).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid service items with categories found. Please ensure all services have proper categories.",
            });
        }

        console.log('📊 Items grouped by category:', Object.keys(itemsByCategory));

        // Calculate taxes and totals
        const orderTax = orderSubtotal * 0.13;
        const orderDeliveryFee = 50;
        const orderDiscount = 0;
        const orderTotal = orderSubtotal + orderTax + orderDeliveryFee - orderDiscount;

        // Get customer details for email
        const customer = await db.query.users.findFirst({
            where: eq(users.id, userId),
        });

        // Create order in transaction with sub-orders
        const result = await db.transaction(async (tx) => {
            // 1. Create the main order
            const [order] = await tx.insert(orders).values({
                customerId: userId,
                subtotal: orderSubtotal.toString(),
                tax: orderTax.toString(),
                deliveryFee: orderDeliveryFee.toString(),
                discount: orderDiscount.toString(),
                total: orderTotal.toString(),
                address: address,
                city: city || null,
                zipCode: zipCode || null,
                latitude: latitude?.toString() || null,
                longitude: longitude?.toString() || null,
                customerNotes: customerNotes || null,
                paymentMethod: paymentMethod,
                scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
                scheduledTime: scheduledTime || null,
                status: 'pending',
                paymentStatus: 'pending',
            }).returning();

            // 2. Create order items and sub-orders for each category
            const orderItemIds: string[] = [];

            for (const [categoryKey, categoryData] of Object.entries(itemsByCategory)) {
                const catItems = categoryData.items;
                const catSubtotal = categoryData.subtotal;
                const catTax = catSubtotal * 0.13;
                const catTotal = catSubtotal + catTax;

                // Create sub-order for this category
                const [subOrder] = await tx.insert(subOrders).values({
                    orderId: order.id,
                    categoryId: categoryData.categoryId,
                    categoryName: categoryData.categoryName,
                    status: 'pending',
                    subtotal: catSubtotal.toString(),
                    tax: catTax.toString(),
                    total: catTotal.toString(),
                }).returning();

                // Create order items and sub-order items
                for (const item of catItems) {
                    // Create main order item
                    const [orderItem] = await tx.insert(orderItems).values({
                        orderId: order.id,
                        serviceItemId: item.serviceItemId,
                        categoryId: categoryData.categoryId,
                        name: item.name,
                        description: item.description,
                        price: item.price.toString(),
                        quantity: item.quantity,
                        subtotal: item.subtotal.toString(),
                        durationMinutes: item.durationMinutes,
                        imageUrl: item.imageUrl,
                    }).returning();

                    orderItemIds.push(orderItem.id);

                    // Create sub-order item
                    await tx.insert(subOrderItems).values({
                        subOrderId: subOrder.id,
                        orderItemId: orderItem.id,
                        serviceItemId: item.serviceItemId,
                        name: item.name,
                        description: item.description,
                        price: item.price.toString(),
                        quantity: item.quantity,
                        subtotal: item.subtotal.toString(),
                        durationMinutes: item.durationMinutes,
                        imageUrl: item.imageUrl,
                    });
                }

                // Create sub-order timeline entry
                await tx.insert(subOrderTimeline).values({
                    subOrderId: subOrder.id,
                    status: 'pending',
                    note: `Sub-order created for ${categoryData.categoryName}`,
                    metadata: { items: catItems.length },
                });
            }

            // 3. Create main order timeline entry
            await tx.insert(orderTimeline).values({
                orderId: order.id,
                status: 'pending',
                note: `Order created with ${Object.keys(itemsByCategory).length} sub-orders`,
                metadata: { subOrderCount: Object.keys(itemsByCategory).length, items: orderItemIds.length },
            });

            return {
                order,
                subOrderCount: Object.keys(itemsByCategory).length,
                itemCount: orderItemIds.length,
            };
        });

        // ============================================
        // SEND EMAIL NOTIFICATIONS
        // ============================================
        
        try {
            const emailData = {
                orderId: result.order.id,
                customerName: customer?.fullName || 'Customer',
                customerPhone: customer?.phoneNumber || 'N/A',
                items: enrichedItems.map(item => ({
                    name: item.name,
                    quantity: items.find(i => i.serviceItemId === item.id)?.quantity || 1,
                    price: parseFloat(item.price),
                    subtotal: parseFloat(item.price) * (items.find(i => i.serviceItemId === item.id)?.quantity || 1),
                })),
                subtotal: orderSubtotal,
                tax: orderTax,
                deliveryFee: orderDeliveryFee,
                discount: orderDiscount,
                total: orderTotal,
                address: address,
                city: city || '',
                zipCode: zipCode || '',
                paymentMethod: paymentMethod,
                customerNotes: customerNotes || '',
                createdAt: new Date().toISOString(),
            };

            await sendOrderEmail(emailData);
            console.log('✅ Admin order email sent successfully');
        } catch (emailError) {
            console.error('❌ Failed to send order emails:', emailError);
        }

        // ============================================
        // SEND NOTIFICATIONS
        // ============================================

        // Notify admins
        const admins = await db.query.users.findMany({
            where: eq(users.role, "admin"),
        });

        for (const admin of admins) {
            try {
                await createNotification(
                    admin.id,
                    "New Order Received",
                    `Customer has placed a new order with ${result.subOrderCount} sub-orders. Total: NPR ${orderTotal.toLocaleString()}`,
                    "new_order",
                    result.order.id
                );
            } catch (error) {
                console.error('Failed to notify admin:', error);
            }
        }

        // Notify customer
        try {
            await createNotification(
                userId,
                "Order Confirmed",
                `Your order has been placed successfully. Order ID: #${result.order.id.slice(0, 8)}`,
                "order_confirmed",
                result.order.id
            );
        } catch (error) {
            console.error('Failed to notify customer:', error);
        }

        // Create audit log
        await createAuditLog({
            entityType: "order",
            entityId: result.order.id,
            action: "create",
            performedBy: userId,
            performedByRole: "user",
            newValue: {
                subOrderCount: result.subOrderCount,
                total: orderTotal,
                address: address,
            },
        });

        return res.status(201).json({
            success: true,
            message: "Order created successfully",
            order: {
                ...result.order,
                subOrderCount: result.subOrderCount,
                itemCount: result.itemCount,
            },
        });
    } catch (error) {
        console.error("Error creating order:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create order"
        });
    }
};

/**
 * Get customer orders
 */
export const getCustomerOrders = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const { status, page = "1", limit = "20" } = req.query;
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const offset = (pageNum - 1) * limitNum;

        const conditions: any[] = [eq(orders.customerId, userId)];
        if (status && status !== "all") {
            conditions.push(eq(orders.status, status as any));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // Get orders with their items and sub-orders
        const ordersList = await db
            .select({
                id: orders.id,
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
                confirmedAt: orders.confirmedAt,
                assignedAt: orders.assignedAt,
                completedAt: orders.completedAt,
                assignedMistriId: orders.assignedMistriId,
                customerNotes: orders.customerNotes,
                paymentMethod: orders.paymentMethod,
                scheduledDate: orders.scheduledDate,
                scheduledTime: orders.scheduledTime,
            })
            .from(orders)
            .where(whereClause)
            .orderBy(desc(orders.createdAt))
            .limit(limitNum)
            .offset(offset);

        // Get items and sub-orders for each order
        const ordersWithDetails = await Promise.all(
            ordersList.map(async (order) => {
                // Get sub-orders
                const subOrdersList = await db
                    .select({
                        id: subOrders.id,
                        categoryName: subOrders.categoryName,
                        status: subOrders.status,
                        subtotal: subOrders.subtotal,
                        total: subOrders.total,
                        assignedMistriId: subOrders.assignedMistriId,
                        assignedAt: subOrders.assignedAt,
                        completedAt: subOrders.completedAt,
                        itemCount: sql<number>`(SELECT COUNT(*) FROM sub_order_items WHERE sub_order_items.sub_order_id = sub_orders.id)`,
                    })
                    .from(subOrders)
                    .where(eq(subOrders.orderId, order.id));

                // Get all items
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
                    })
                    .from(orderItems)
                    .where(eq(orderItems.orderId, order.id));

                return {
                    ...order,
                    items,
                    subOrders: subOrdersList,
                    itemCount: items.length,
                    subOrderCount: subOrdersList.length,
                };
            })
        );

        // Get total count
        const countResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(orders)
            .where(whereClause);

        const total = countResult[0]?.count || 0;

        return res.json({
            success: true,
            orders: ordersWithDetails,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: total,
            },
        });
    } catch (error) {
        console.error("Error fetching customer orders:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch orders"
        });
    }
};

/**
 * Get order by ID with items and sub-orders
 */
export const getOrderById = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const orderId = req.params.id;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const [order] = await db
            .select()
            .from(orders)
            .where(and(eq(orders.id, orderId), eq(orders.customerId, userId)))
            .limit(1);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        // Get order items
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
            })
            .from(orderItems)
            .where(eq(orderItems.orderId, orderId));

        // Get sub-orders
        const subOrdersList = await db
            .select({
                id: subOrders.id,
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
                itemCount: sql<number>`(SELECT COUNT(*) FROM sub_order_items WHERE sub_order_items.sub_order_id = sub_orders.id)`,
            })
            .from(subOrders)
            .where(eq(subOrders.orderId, orderId));

        // Get sub-order items
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

                return {
                    ...subOrder,
                    items: subItems,
                };
            })
        );

        // Get timeline
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

        // Get mistri details if assigned
        let mistriDetails = null;
        if (order.assignedMistriId) {
            const mistri = await db
                .select({
                    id: users.id,
                    fullName: users.fullName,
                    phoneNumber: users.phoneNumber,
                    profilePhotoUrl: mistriProfiles.profilePhotoUrl,
                    averageRating: mistriProfiles.averageRating,
                    jobsCompleted: mistriProfiles.jobsCompleted,
                })
                .from(users)
                .leftJoin(mistriProfiles, eq(users.id, mistriProfiles.userId))
                .where(eq(users.id, order.assignedMistriId))
                .limit(1);
            mistriDetails = mistri[0] || null;
        }

        return res.json({
            success: true,
            order: {
                ...order,
                items,
                subOrders: subOrdersWithItems,
                timeline,
                mistriDetails,
                itemCount: items.length,
                subOrderCount: subOrdersWithItems.length,
            },
        });
    } catch (error) {
        console.error("Error fetching order:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch order"
        });
    }
};

/**
 * Cancel order (Customer only)
 */
export const cancelOrder = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const orderId = req.params.id;
        const { reason } = req.body;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const [order] = await db
            .select()
            .from(orders)
            .where(and(eq(orders.id, orderId), eq(orders.customerId, userId)))
            .limit(1);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        if (order.status !== 'pending' && order.status !== 'confirmed') {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel order with status: ${order.status}`
            });
        }

        const [cancelledOrder] = await db
            .update(orders)
            .set({
                status: 'cancelled',
                cancelledAt: new Date(),
                updatedAt: new Date(),
                adminNotes: reason || null,
            })
            .where(eq(orders.id, orderId))
            .returning();

        // Cancel all sub-orders
        await db.update(subOrders)
            .set({
                status: 'cancelled',
                updatedAt: new Date(),
            })
            .where(eq(subOrders.orderId, orderId));

        // Add to timeline
        await db.insert(orderTimeline).values({
            orderId: orderId,
            status: 'cancelled',
            note: `Cancelled by customer: ${reason || 'No reason provided'}`,
        });

        // Notify customer
        try {
            await createNotification(
                userId,
                "Order Cancelled",
                `Your order has been cancelled. ${reason || ''}`,
                "order_cancelled",
                orderId
            );
        } catch (error) {
            console.error('Failed to notify customer about cancellation:', error);
        }

        return res.json({
            success: true,
            message: "Order cancelled successfully",
            order: cancelledOrder,
        });
    } catch (error) {
        console.error("Error cancelling order:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to cancel order"
        });
    }
};

/**
 * Get order counts by status
 */
export const getOrderCounts = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const counts = await db
            .select({
                status: orders.status,
                count: sql<number>`count(*)::int`,
            })
            .from(orders)
            .where(eq(orders.customerId, userId))
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