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
// PUBLIC SERVICES HIERARCHY
// ============================================

// GET /api/public/services-hierarchy - Get complete service hierarchy
router.get("/services-hierarchy", getServiceHierarchy);

// GET /api/public/services-hierarchy/:id - Get category hierarchy by ID
router.get("/services-hierarchy/:id", getCategoryHierarchy);

// GET /api/public/services-hierarchy/item/:id - Get service item details
router.get("/services-hierarchy/item/:id", getServiceItemDetails);

// ============================================
// PUBLIC HERO BANNERS
// ============================================

// GET /api/public/hero-banners - Get all active hero banners
router.get("/hero-banners", getPublicHeroBanners);

// GET /api/public/hero-banners/type/:adType - Get banners by ad type
router.get("/hero-banners/type/:adType", getBannersByAdType);

export default router;