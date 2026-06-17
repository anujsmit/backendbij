import express from "express";
import { 
    getPublicHeroBanners, 
    getBannersByAdType,
    getAdminHeroBanners,
    createHeroBanner,
    updateHeroBanner,
    deleteHeroBanner,
    reorderHeroBanners,
    getBannerStats,
    toggleBannerActive,
    bulkDeleteHeroBanners,
    duplicateHeroBanner
} from "../controllers/heroBannerController";
import { authenticate } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";

const router = express.Router();

// ============================================
// PUBLIC ENDPOINTS (no authentication required)
// ============================================
router.get("/", getPublicHeroBanners);
router.get("/type/:adType", getBannersByAdType);

// ============================================
// ADMIN ENDPOINTS (authentication + admin role required)
// ============================================
router.use(authenticate, requireAdmin);

// Stats and bulk operations
router.get("/admin", getAdminHeroBanners);
router.get("/stats", getBannerStats);
router.post("/bulk-delete", bulkDeleteHeroBanners);

// CRUD operations
router.post("/", createHeroBanner);
router.post("/:id/duplicate", duplicateHeroBanner);
router.patch("/reorder", reorderHeroBanners);
router.patch("/:id", updateHeroBanner);
router.patch("/:id/toggle-active", toggleBannerActive);
router.delete("/:id", deleteHeroBanner);

export default router;