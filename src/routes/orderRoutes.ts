// backend/src/routes/orderRoutes.ts

import { Router } from "express";
import {
    createOrder,
    getCustomerOrders,
    getOrderById,
    cancelOrder,
    getOrderCounts,
} from "../controllers/orderController";
import { authenticate } from "../middleware/auth";

const router = Router();

// All order routes require authentication
router.use(authenticate);

// Customer routes
router.post("/", createOrder);
router.get("/", getCustomerOrders);
router.get("/counts", getOrderCounts);
router.get("/:id", getOrderById);
router.post("/:id/cancel", cancelOrder);

export default router;