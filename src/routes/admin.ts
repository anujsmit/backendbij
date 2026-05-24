import express from "express";

import { authenticate } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";

import {
    adminLogin,
    adminLogout,
} from "../controllers/adminAuthController";

import {
    getAdminStats,
    getUsers,
    getUserById,
    updateUser,
    toggleUserActive,
    getMistris,
    getMistrisCounts,
    toggleMistriFeatured,
    updateMistriService,
    approveMistri,
    rejectMistri,
    getAdminServiceRequests,
    getAuditLogs,
    getSmsStats,
    getSmsLogs,
} from "../controllers/adminController";

import {
    getAllServiceCategories,
    createServiceCategory,
    updateServiceCategory,
    getAllPlatformServices,
    createPlatformService,
    updatePlatformService,
    deletePlatformService,
} from "../controllers/adminServiceController";

import {
    getAdminRatings,
    approveRating,
    rejectRating,
} from "../controllers/adminRatingController";

import {
    getAdminHeroBanners,
    createHeroBanner,
    updateHeroBanner,
    deleteHeroBanner,
    reorderHeroBanners,
} from "../controllers/heroBannerController";

import { uploadAsset } from "../controllers/uploadController";

const router = express.Router();

/**
 * PUBLIC ADMIN AUTH ROUTES
 */

router.post("/auth/login", adminLogin);

router.post("/auth/logout", adminLogout);

/**
 * ALL ROUTES BELOW REQUIRE ADMIN AUTH
 */

router.use(authenticate, requireAdmin);

/**
 * DASHBOARD
 */

router.get("/stats", getAdminStats);

/**
 * USERS
 */

router.get("/users", getUsers);

router.get("/users/:id", getUserById);

router.patch("/users/:id", updateUser);

router.patch("/users/:id/toggle-active", toggleUserActive);

/**
 * MISTRIS
 */

router.get("/mistris/counts", getMistrisCounts);

router.get("/mistris", getMistris);

router.patch(
    "/mistris/:userId/toggle-featured",
    toggleMistriFeatured
);

router.patch(
    "/mistris/:userId/update-service",
    updateMistriService
);

router.patch(
    "/mistris/:userId/approve",
    approveMistri
);

router.patch(
    "/mistris/:userId/reject",
    rejectMistri
);

/**
 * SERVICE CATEGORIES
 */

router.get(
    "/service-categories",
    getAllServiceCategories
);

router.post(
    "/service-categories",
    createServiceCategory
);

router.patch(
    "/service-categories/:id",
    updateServiceCategory
);

/**
 * PLATFORM SERVICES
 */

router.get(
    "/platform-services",
    getAllPlatformServices
);

router.post(
    "/platform-services",
    createPlatformService
);

router.patch(
    "/platform-services/:id",
    updatePlatformService
);

router.delete(
    "/platform-services/:id",
    deletePlatformService
);

/**
 * CDN ASSET UPLOAD
 */

router.post("/upload", uploadAsset);

/**
 * HERO BANNERS
 */

router.get(
    "/hero-banners",
    getAdminHeroBanners
);

router.post(
    "/hero-banners",
    createHeroBanner
);

router.patch(
    "/hero-banners/reorder",
    reorderHeroBanners
);

router.patch(
    "/hero-banners/:id",
    updateHeroBanner
);

router.delete(
    "/hero-banners/:id",
    deleteHeroBanner
);

/**
 * RATINGS
 */

router.get("/ratings", getAdminRatings);

router.post(
    "/ratings/:id/approve",
    approveRating
);

router.post(
    "/ratings/:id/reject",
    rejectRating
);

/**
 * SERVICE REQUESTS
 */

router.get(
    "/service-requests",
    getAdminServiceRequests
);

/**
 * AUDIT LOGS
 */

router.get("/audit-logs", getAuditLogs);

/**
 * SMS
 */

router.get("/sms-stats", getSmsStats);

router.get("/sms-logs", getSmsLogs);

export default router;