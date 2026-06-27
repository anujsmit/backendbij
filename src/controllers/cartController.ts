// backend/src/controllers/cartController.ts

import { Request, Response } from "express";
import { db } from "../db";
import { 
    carts, 
    cartItems, 
    serviceItems,
    serviceSubCategories,
    services,
    users
} from "../db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { z } from "zod";

// ============================================
// VALIDATION SCHEMAS
// ============================================

const addToCartSchema = z.object({
    serviceItemId: z.string().uuid(),
    quantity: z.number().int().min(1).default(1),
});

const updateCartItemSchema = z.object({
    quantity: z.number().int().min(0),
});

// ============================================
// HELPERS
// ============================================

async function getOrCreateCart(userId: string): Promise<string> {
    let cart = await db
        .select({ id: carts.id })
        .from(carts)
        .where(eq(carts.userId, userId))
        .limit(1);

    if (cart.length === 0) {
        const [newCart] = await db
            .insert(carts)
            .values({ userId })
            .returning({ id: carts.id });
        return newCart.id;
    }

    return cart[0].id;
}

// ============================================
// CONTROLLER FUNCTIONS
// ============================================

/**
 * Get user's cart with items
 */
export const getCart = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        // Get or create cart
        const cartId = await getOrCreateCart(userId);

        // Get cart items with service details
        const items = await db
            .select({
                id: cartItems.id,
                serviceItemId: cartItems.serviceItemId,
                quantity: cartItems.quantity,
                addedAt: cartItems.addedAt,
                updatedAt: cartItems.updatedAt,
                name: serviceItems.name,
                description: serviceItems.description,
                price: serviceItems.price,
                durationMinutes: serviceItems.durationMinutes,
                imageUrl: serviceItems.imageUrl,
                isPopular: serviceItems.isPopular,
                isActive: serviceItems.isActive,
                displayOrder: serviceItems.displayOrder,
                subCategoryId: serviceItems.subCategoryId,
                categoryId: services.id,
                categoryName: services.serviceName,
            })
            .from(cartItems)
            .innerJoin(serviceItems, eq(cartItems.serviceItemId, serviceItems.id))
            .leftJoin(serviceSubCategories, eq(serviceItems.subCategoryId, serviceSubCategories.id))
            .leftJoin(services, eq(serviceSubCategories.categoryId, services.id))
            .where(eq(cartItems.cartId, cartId))
            .orderBy(desc(cartItems.addedAt));

        // Calculate totals
        let subtotal = 0;
        const formattedItems = items.map(item => {
            const price = parseFloat(item.price);
            const itemTotal = price * item.quantity;
            subtotal += itemTotal;
            return {
                ...item,
                price: price,
                subtotal: itemTotal,
            };
        });

        // Update cart updated_at
        await db
            .update(carts)
            .set({ updatedAt: new Date() })
            .where(eq(carts.id, cartId));

        return res.json({
            success: true,
            cart: {
                id: cartId,
                items: formattedItems,
                itemCount: formattedItems.length,
                subtotal: subtotal,
                isEmpty: formattedItems.length === 0,
            },
        });
    } catch (error) {
        console.error("Error fetching cart:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch cart"
        });
    }
};

/**
 * Add item to cart
 */
export const addToCart = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const parsed = addToCartSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid data",
                errors: parsed.error.format()
            });
        }

        const { serviceItemId, quantity } = parsed.data;

        // Check if service item exists and is active
        const [serviceItem] = await db
            .select({ id: serviceItems.id, isActive: serviceItems.isActive })
            .from(serviceItems)
            .where(eq(serviceItems.id, serviceItemId))
            .limit(1);

        if (!serviceItem) {
            return res.status(404).json({
                success: false,
                message: "Service item not found"
            });
        }

        if (!serviceItem.isActive) {
            return res.status(400).json({
                success: false,
                message: "Service item is not available"
            });
        }

        // Get or create cart
        const cartId = await getOrCreateCart(userId);

        // Check if item already exists in cart
        const [existingItem] = await db
            .select()
            .from(cartItems)
            .where(
                and(
                    eq(cartItems.cartId, cartId),
                    eq(cartItems.serviceItemId, serviceItemId)
                )
            )
            .limit(1);

        let result;
        if (existingItem) {
            // Update quantity
            const newQuantity = existingItem.quantity + quantity;
            const [updated] = await db
                .update(cartItems)
                .set({ 
                    quantity: newQuantity,
                    updatedAt: new Date()
                })
                .where(eq(cartItems.id, existingItem.id))
                .returning();
            result = updated;
        } else {
            // Insert new item
            const [inserted] = await db
                .insert(cartItems)
                .values({
                    cartId,
                    serviceItemId,
                    quantity,
                })
                .returning();
            result = inserted;
        }

        // Update cart timestamp
        await db
            .update(carts)
            .set({ updatedAt: new Date() })
            .where(eq(carts.id, cartId));

        return res.status(201).json({
            success: true,
            message: "Item added to cart",
            cartItem: result,
        });
    } catch (error) {
        console.error("Error adding to cart:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to add to cart"
        });
    }
};

/**
 * Update cart item quantity
 */
export const updateCartItem = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const itemId = req.params.id;
        const parsed = updateCartItemSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid data",
                errors: parsed.error.format()
            });
        }

        const { quantity } = parsed.data;

        // Get cart for user
        const cart = await db
            .select({ id: carts.id })
            .from(carts)
            .where(eq(carts.userId, userId))
            .limit(1);

        if (cart.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Cart not found"
            });
        }

        // Check if item exists in cart
        const [item] = await db
            .select()
            .from(cartItems)
            .where(
                and(
                    eq(cartItems.id, itemId),
                    eq(cartItems.cartId, cart[0].id)
                )
            )
            .limit(1);

        if (!item) {
            return res.status(404).json({
                success: false,
                message: "Cart item not found"
            });
        }

        let result;
        if (quantity <= 0) {
            // Remove item
            await db
                .delete(cartItems)
                .where(eq(cartItems.id, itemId));
            result = { removed: true };
        } else {
            // Update quantity
            const [updated] = await db
                .update(cartItems)
                .set({ 
                    quantity,
                    updatedAt: new Date()
                })
                .where(eq(cartItems.id, itemId))
                .returning();
            result = updated;
        }

        // Update cart timestamp
        await db
            .update(carts)
            .set({ updatedAt: new Date() })
            .where(eq(carts.id, cart[0].id));

        return res.json({
            success: true,
            message: quantity <= 0 ? "Item removed from cart" : "Cart updated",
            cartItem: result,
        });
    } catch (error) {
        console.error("Error updating cart:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update cart"
        });
    }
};

/**
 * Remove item from cart
 */
export const removeFromCart = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const itemId = req.params.id;

        // Get cart for user
        const cart = await db
            .select({ id: carts.id })
            .from(carts)
            .where(eq(carts.userId, userId))
            .limit(1);

        if (cart.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Cart not found"
            });
        }

        // Check if item exists in cart
        const [item] = await db
            .select()
            .from(cartItems)
            .where(
                and(
                    eq(cartItems.id, itemId),
                    eq(cartItems.cartId, cart[0].id)
                )
            )
            .limit(1);

        if (!item) {
            return res.status(404).json({
                success: false,
                message: "Cart item not found"
            });
        }

        // Remove item
        await db
            .delete(cartItems)
            .where(eq(cartItems.id, itemId));

        // Update cart timestamp
        await db
            .update(carts)
            .set({ updatedAt: new Date() })
            .where(eq(carts.id, cart[0].id));

        return res.json({
            success: true,
            message: "Item removed from cart",
        });
    } catch (error) {
        console.error("Error removing from cart:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to remove from cart"
        });
    }
};

/**
 * Clear cart
 */
export const clearCart = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        // Get cart for user
        const cart = await db
            .select({ id: carts.id })
            .from(carts)
            .where(eq(carts.userId, userId))
            .limit(1);

        if (cart.length === 0) {
            return res.json({
                success: true,
                message: "Cart is already empty"
            });
        }

        // Delete all items from cart
        await db
            .delete(cartItems)
            .where(eq(cartItems.cartId, cart[0].id));

        // Update cart timestamp
        await db
            .update(carts)
            .set({ updatedAt: new Date() })
            .where(eq(carts.id, cart[0].id));

        return res.json({
            success: true,
            message: "Cart cleared successfully",
        });
    } catch (error) {
        console.error("Error clearing cart:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to clear cart"
        });
    }
};

/**
 * Get cart item count
 */
export const getCartCount = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const cart = await db
            .select({ id: carts.id })
            .from(carts)
            .where(eq(carts.userId, userId))
            .limit(1);

        if (cart.length === 0) {
            return res.json({
                success: true,
                count: 0,
            });
        }

        const items = await db
            .select({ count: cartItems.id })
            .from(cartItems)
            .where(eq(cartItems.cartId, cart[0].id));

        return res.json({
            success: true,
            count: items.length,
        });
    } catch (error) {
        console.error("Error fetching cart count:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch cart count"
        });
    }
};