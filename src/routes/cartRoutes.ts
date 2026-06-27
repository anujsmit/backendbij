// backend/src/routes/cartRoutes.ts

import { Router } from "express";
import {
    getCart,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,
    getCartCount,
} from "../controllers/cartController";
import { authenticate } from "../middleware/auth";

const router = Router();

// All cart routes require authentication
router.use(authenticate);

router.get("/", getCart);
router.get("/count", getCartCount);
router.post("/add", addToCart);
router.patch("/items/:id", updateCartItem);
router.delete("/items/:id", removeFromCart);
router.delete("/clear", clearCart);

export default router;