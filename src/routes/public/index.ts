// backend/src/routes/public/index.ts

import express from "express";
import {
    getPublicCategories,
    getPublicCategoryById,
    getPublicSubCategoryById,
} from "../../controllers/shared/publicCategoryController";
import {
    getServiceHierarchy,
    getCategoryHierarchy,
    getServiceItemDetails
} from "../../controllers/shared/serviceHierarchyController";
import {
    getPublicHeroBanners,
    getBannersByAdType,
} from "../../controllers/admin/heroBannerController";

const router = express.Router();

// ============================================
// PUBLIC CATEGORIES
// ============================================

// GET /api/public/categories - Get all active categories
router.get("/categories", getPublicCategories);

// GET /api/public/categories/:id - Get a single category with sub-categories
router.get("/categories/:id", getPublicCategoryById);

// GET /api/public/categories/:id/sub-categories/:subId - Get sub-category with items
router.get("/categories/:id/sub-categories/:subId", getPublicSubCategoryById);

// ============================================
// ✅ PUBLIC SERVICES HIERARCHY - ADD THIS
// ============================================

// GET /api/public/service-hierarchy - Get complete service hierarchy
// ✅ Note: This endpoint must exist
router.get("/service-hierarchy", getServiceHierarchy);

// GET /api/public/service-hierarchy/:id - Get category hierarchy by ID
router.get("/service-hierarchy/:id", getCategoryHierarchy);

// GET /api/public/service-hierarchy/item/:id - Get service item details
router.get("/service-hierarchy/item/:id", getServiceItemDetails);

// ============================================
// PUBLIC HERO BANNERS
// ============================================
router.get("/hero-banners", getPublicHeroBanners);
router.get("/hero-banners/type/:adType", getBannersByAdType);

export default router;