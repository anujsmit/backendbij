import express from "express";
import { authenticate } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";
import { adminSendOtp, adminVerifyOtp, adminLogout } from "../controllers/adminAuthController";
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

// Public admin auth routes — no token required
router.post("/auth/send-otp", adminSendOtp);
router.post("/auth/verify-otp", adminVerifyOtp);
router.post("/auth/logout", adminLogout);

// All routes below require authentication + admin role
router.use(authenticate, requireAdmin);

// Dashboard
router.get("/stats", getAdminStats);

// Users
router.get("/users", getUsers);
router.get("/users/:id", getUserById);
router.patch("/users/:id", updateUser);
router.patch("/users/:id/toggle-active", toggleUserActive);

// Mistris (counts before list path — explicit segment)
router.get("/mistris/counts", getMistrisCounts);
router.get("/mistris", getMistris);
router.patch("/mistris/:userId/toggle-featured", toggleMistriFeatured);
router.patch("/mistris/:userId/update-service", updateMistriService);
router.patch("/mistris/:userId/approve", approveMistri);
router.patch("/mistris/:userId/reject", rejectMistri);

// Service Categories
router.get("/service-categories", getAllServiceCategories);
router.post("/service-categories", createServiceCategory);
router.patch("/service-categories/:id", updateServiceCategory);

// Platform Services
router.get("/platform-services", getAllPlatformServices);
router.post("/platform-services", createPlatformService);
router.patch("/platform-services/:id", updatePlatformService);
router.delete("/platform-services/:id", deletePlatformService);

// CDN Asset Upload
router.post("/upload", uploadAsset);

// Hero Banners
router.get("/hero-banners", getAdminHeroBanners);
router.post("/hero-banners", createHeroBanner);
router.patch("/hero-banners/reorder", reorderHeroBanners);
router.patch("/hero-banners/:id", updateHeroBanner);
router.delete("/hero-banners/:id", deleteHeroBanner);

// Ratings
router.get("/ratings", getAdminRatings);
router.post("/ratings/:id/approve", approveRating);
router.post("/ratings/:id/reject", rejectRating);

// Service Requests (monitoring)
router.get("/service-requests", getAdminServiceRequests);

// Audit Logs
router.get("/audit-logs", getAuditLogs);

// SMS
router.get("/sms-stats", getSmsStats);
router.get("/sms-logs", getSmsLogs);

export default router;
