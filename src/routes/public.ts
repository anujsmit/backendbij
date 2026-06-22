// backend/src/routes/public.ts

import express from "express";
import {
    getPublicCategories,
    getPublicCategoryById,
    getPublicSubCategoryById,
} from "../controllers/publicCategoryController";

const router = express.Router();

// GET /api/public/categories - Get all active categories
router.get("/categories", getPublicCategories);

// GET /api/public/categories/:id - Get a single category with sub-categories
router.get("/categories/:id", getPublicCategoryById);

// GET /api/public/categories/:id/sub-categories/:subId - Get sub-category with items
router.get("/categories/:id/sub-categories/:subId", getPublicSubCategoryById);

export default router;