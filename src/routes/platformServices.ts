import express from "express";
import {
    getPlatformServices,
    getPlatformServicesByCategory,
} from "../controllers/platformServiceController";
import { authenticate } from "../middleware/auth";

const router = express.Router();

// GET /api/platform-services - Get all platform services grouped by category
router.get("/", authenticate, getPlatformServices);

// GET /api/platform-services/category/:categoryId - Get platform services for a specific category
router.get("/category/:categoryId", authenticate, getPlatformServicesByCategory);

export default router;
