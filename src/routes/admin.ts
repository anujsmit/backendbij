import express from "express";
import { authenticate } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";
import { requirePermission } from "../middleware/requirePermission";
import {
    adminSendOtp,
    adminVerifyOtp,
    adminLogout,
    adminLoginWithPassword,
    checkAdminTwoFactorStatus
} from "../controllers/adminAuthController";
import {
    setupTwoFactor,
    enableTwoFactor,
    disableTwoFactor,
} from "../controllers/twoFactorController";
import {
    getMe,
    updateMe,
    getRolesMeta,
    getEmployees,
    createEmployee,
    updateEmployee,
    toggleEmployeeActive,
    removeEmployee,
} from "../controllers/employeeController";
import {
    getAdminStats,
    getUsers,
    getUserById,
    createUser,
    updateUser,
    toggleUserActive,
    getCustomerDetail,
    flagUser,
    messageUser,
    getMistris,
    getMistrisCounts,
    createMistri,
    toggleMistriFeatured,
    updateMistriService,
    approveMistri,
    rejectMistri,
    getAdminServiceRequests,
    getServiceRequestCounts,
    getAssignableMistris,
    assignServiceRequest,
    getAuditLogs,
    getSmsStats,
    getSmsLogs,
    getGlobalSearch,
    getMistriJobs,
} from "../controllers/adminController";
import {
    // Service Categories (Level 1)
    getAllServiceCategories,
    createServiceCategory,
    updateServiceCategory,
    deleteServiceCategory,
    getServiceCategoryById,
    // Platform Services (Level 2)
    getAllPlatformServices,
    createPlatformService,
    updatePlatformService,
    deletePlatformService,
    getPlatformServiceById,
    getPlatformServicesStats,
    togglePlatformServiceActive,
    togglePlatformServicePopular,
    bulkDeletePlatformServices,
    getPlatformServicesByCategory,
    deactivatePlatformService,
    reactivatePlatformService,
    // Service Items (Level 3)
    getServiceItems,
    getServiceItemById,
    createServiceItem,
    updateServiceItem,
    deleteServiceItem,
    bulkDeleteServiceItems,
    toggleServiceItemPopular,
    toggleServiceItemActive,
    getServiceItemsStats,
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
    bulkDeleteHeroBanners,
    duplicateHeroBanner,
    toggleBannerActive,
    getBannerStats,
    getBannersByAdType,
} from "../controllers/heroBannerController";
import { uploadAsset } from "../controllers/uploadController";
import {
    getExpenses,
    getExpenseReport,
    createExpense,
    updateExpense,
    deleteExpense,
} from "../controllers/expenseController";
import {
    getPayoutReport,
    getPayoutProviders,
    getPayouts,
    settleProvider,
    collectPayout,
    revertPayout,
    updatePayoutConfig,
} from "../controllers/payoutController";
import { getAnalytics } from "../controllers/analyticsController";
import {
    getBroadcastSegments,
    sendBroadcast,
    getBroadcastHistory,
} from "../controllers/broadcastController";
import { getBusinessSettings, updateBusinessSettings } from "../controllers/settingsController";
import { getPnlStatement } from "../controllers/pnlController";
import {
    getPendingApprovalRequests,
    getRequestForAssignment,
    getAvailableMistrisForAssignment,
    assignMistriToRequest,
    rejectPendingRequest,
    getAllRequests,
} from "../controllers/adminAssignmentController";

const router = express.Router();

// ============================================
// PUBLIC ADMIN AUTH ROUTES (no token required)
// ============================================

// OTP-based login (legacy)
router.post("/auth/send-otp", adminSendOtp);
router.post("/auth/verify-otp", adminVerifyOtp);
router.post("/auth/logout", adminLogout);

// Password-based login with 2FA (new)
router.post("/auth/login-with-password", adminLoginWithPassword);
router.post("/auth/check-two-factor-status", checkAdminTwoFactorStatus);

// ============================================
// PROTECTED ROUTES (authentication + admin role required)
// ============================================
router.use(authenticate, requireAdmin);

// ============================================
// 2FA MANAGEMENT (requires authentication)
// ============================================
router.post("/two-factor/setup", setupTwoFactor);
router.post("/two-factor/enable", enableTwoFactor);
router.post("/two-factor/disable", disableTwoFactor);

// ============================================
// CURRENT ADMIN IDENTITY
// ============================================

// Current admin identity + effective permissions
router.get("/me", getMe);
router.patch("/me", updateMe);

// Global search (Cmd-K) — any admin; destination pages enforce their own perms
router.get("/search", getGlobalSearch);

// ============================================
// BUSINESS / PLATFORM SETTINGS
// ============================================
router.get("/business-settings", requirePermission("settings.view"), getBusinessSettings);
router.patch("/business-settings", requirePermission("settings.manage"), updateBusinessSettings);

// ============================================
// DASHBOARD & ANALYTICS
// ============================================
router.get("/stats", requirePermission("dashboard.view"), getAdminStats);
router.get("/analytics", requirePermission("dashboard.view"), getAnalytics);

// ============================================
// USER MANAGEMENT
// ============================================
router.get("/users", requirePermission("users.view"), getUsers);
router.post("/users", requirePermission("users.manage"), createUser);
router.get("/users/:id", requirePermission("users.view"), getUserById);
router.patch("/users/:id", requirePermission("users.manage"), updateUser);
router.patch("/users/:id/toggle-active", requirePermission("users.manage"), toggleUserActive);
router.get("/users/:id/detail", requirePermission("users.view"), getCustomerDetail);
router.patch("/users/:id/flag", requirePermission("users.manage"), flagUser);
router.post("/users/:id/message", requirePermission("users.manage"), messageUser);

// ============================================
// MISTRI (PROVIDER) MANAGEMENT
// ============================================
router.get("/mistri-jobs/:id", requirePermission("requests.view"), getMistriJobs);
router.get("/mistris/counts", requirePermission("mistris.view"), getMistrisCounts);
router.get("/mistris", requirePermission("mistris.view"), getMistris);
router.post("/mistris", requirePermission("mistris.manage"), createMistri);
router.patch("/mistris/:userId/toggle-featured", requirePermission("mistris.manage"), toggleMistriFeatured);
router.patch("/mistris/:userId/update-service", requirePermission("mistris.manage"), updateMistriService);
router.patch("/mistris/:userId/approve", requirePermission("mistris.manage"), approveMistri);
router.patch("/mistris/:userId/reject", requirePermission("mistris.manage"), rejectMistri);

// ============================================
// SERVICE CATEGORIES (Level 1)
// ============================================
router.get("/service-categories", requirePermission("services.manage"), getAllServiceCategories);
router.get("/service-categories/:id", requirePermission("services.manage"), getServiceCategoryById);
router.post("/service-categories", requirePermission("services.manage"), createServiceCategory);
router.patch("/service-categories/:id", requirePermission("services.manage"), updateServiceCategory);
router.delete("/service-categories/:id", requirePermission("services.manage"), deleteServiceCategory);

// ============================================
// PLATFORM SERVICES (Level 2 - Sub-Categories)
// ============================================
// GET endpoints
router.get("/platform-services", requirePermission("services.manage"), getAllPlatformServices);
router.get("/platform-services/stats", requirePermission("services.manage"), getPlatformServicesStats);
router.get("/platform-services/:id", requirePermission("services.manage"), getPlatformServiceById);
router.get("/platform-services/category/:categoryId", requirePermission("services.manage"), getPlatformServicesByCategory);

// POST endpoints
router.post("/platform-services", requirePermission("services.manage"), createPlatformService);
router.post("/platform-services/bulk-delete", requirePermission("services.manage"), bulkDeletePlatformServices);

// PATCH endpoints
router.patch("/platform-services/:id", requirePermission("services.manage"), updatePlatformService);
router.patch("/platform-services/:id/toggle-active", requirePermission("services.manage"), togglePlatformServiceActive);
router.patch("/platform-services/:id/toggle-popular", requirePermission("services.manage"), togglePlatformServicePopular);
router.patch("/platform-services/:id/deactivate", requirePermission("services.manage"), deactivatePlatformService);
router.patch("/platform-services/:id/reactivate", requirePermission("services.manage"), reactivatePlatformService);

// DELETE endpoint - PERMANENT DELETE
router.delete("/platform-services/:id", requirePermission("services.manage"), deletePlatformService);

// ============================================
// SERVICE ITEMS (Level 3 - Individual Services)
// ============================================
// GET endpoints
router.get("/service-items", requirePermission("services.manage"), getServiceItems);
router.get("/service-items/stats", requirePermission("services.manage"), getServiceItemsStats);
router.get("/service-items/:id", requirePermission("services.manage"), getServiceItemById);

// POST endpoints
router.post("/service-items", requirePermission("services.manage"), createServiceItem);
router.post("/service-items/bulk-delete", requirePermission("services.manage"), bulkDeleteServiceItems);

// PATCH endpoints
router.patch("/service-items/:id", requirePermission("services.manage"), updateServiceItem);
router.patch("/service-items/:id/toggle-popular", requirePermission("services.manage"), toggleServiceItemPopular);
router.patch("/service-items/:id/toggle-active", requirePermission("services.manage"), toggleServiceItemActive);

// DELETE endpoint
router.delete("/service-items/:id", requirePermission("services.manage"), deleteServiceItem);

// ============================================
// CDN ASSET UPLOAD
// ============================================
router.post("/upload", uploadAsset);

// ============================================
// HERO BANNERS
// ============================================
router.get("/hero-banners", requirePermission("banners.manage"), getAdminHeroBanners);
router.get("/hero-banners/stats", requirePermission("banners.manage"), getBannerStats);
router.get("/hero-banners/ad-type/:adType", requirePermission("banners.manage"), getBannersByAdType);
router.post("/hero-banners", requirePermission("banners.manage"), createHeroBanner);
router.patch("/hero-banners/reorder", requirePermission("banners.manage"), reorderHeroBanners);
router.patch("/hero-banners/:id", requirePermission("banners.manage"), updateHeroBanner);
router.patch("/hero-banners/:id/toggle-active", requirePermission("banners.manage"), toggleBannerActive);
router.post("/hero-banners/:id/duplicate", requirePermission("banners.manage"), duplicateHeroBanner);
router.post("/hero-banners/bulk-delete", requirePermission("banners.manage"), bulkDeleteHeroBanners);
router.delete("/hero-banners/:id", requirePermission("banners.manage"), deleteHeroBanner);

// ============================================
// RATINGS & REVIEWS
// ============================================
router.get("/ratings", requirePermission("ratings.view"), getAdminRatings);
router.post("/ratings/:id/approve", requirePermission("ratings.moderate"), approveRating);
router.post("/ratings/:id/reject", requirePermission("ratings.moderate"), rejectRating);

// ============================================
// SERVICE REQUESTS (OPS CONSOLE)
// ============================================
router.get("/service-requests/counts", requirePermission("requests.view"), getServiceRequestCounts);
router.get("/service-requests/assignable-mistris", requirePermission("requests.assign"), getAssignableMistris);
router.get("/service-requests", requirePermission("requests.view"), getAdminServiceRequests);
router.post("/service-requests/:id/assign", requirePermission("requests.assign"), assignServiceRequest);

// ============================================
// PENDING REQUESTS MANAGEMENT
// ============================================
router.get("/pending-requests", requirePermission("requests.view"), getPendingApprovalRequests);
router.get("/pending-requests/:id", requirePermission("requests.view"), getRequestForAssignment);
router.get("/available-mistris", requirePermission("requests.view"), getAvailableMistrisForAssignment);
router.post("/pending-requests/:id/assign", requirePermission("requests.manage"), assignMistriToRequest);
router.post("/pending-requests/:id/reject", requirePermission("requests.manage"), rejectPendingRequest);
router.get("/all-requests", requirePermission("requests.view"), getAllRequests);

// ============================================
// AUDIT LOGS
// ============================================
router.get("/audit-logs", requirePermission("audit.view"), getAuditLogs);

// ============================================
// SMS MANAGEMENT
// ============================================
router.get("/sms-stats", requirePermission("sms.view"), getSmsStats);
router.get("/sms-logs", requirePermission("sms.view"), getSmsLogs);

// ============================================
// BROADCAST (ENGAGEMENT)
// ============================================
router.get("/broadcast/segments", requirePermission("broadcast.send"), getBroadcastSegments);
router.get("/broadcast/history", requirePermission("broadcast.send"), getBroadcastHistory);
router.post("/broadcast/send", requirePermission("broadcast.send"), sendBroadcast);

// ============================================
// EXPENSES (FINANCE)
// ============================================
router.get("/expenses/report", requirePermission("expenses.view"), getExpenseReport);
router.get("/expenses", requirePermission("expenses.view"), getExpenses);
router.post("/expenses", requirePermission("expenses.manage"), createExpense);
router.patch("/expenses/:id", requirePermission("expenses.manage"), updateExpense);
router.delete("/expenses/:id", requirePermission("expenses.manage"), deleteExpense);

// ============================================
// PROFIT & LOSS STATEMENT
// ============================================
router.get("/pnl", requirePermission("expenses.view"), getPnlStatement);

// ============================================
// PAYOUTS (COMMISSION SETTLEMENTS)
// ============================================
router.get("/payouts/report", requirePermission("payouts.view"), getPayoutReport);
router.get("/payouts/providers", requirePermission("payouts.view"), getPayoutProviders);
router.get("/payouts", requirePermission("payouts.view"), getPayouts);
router.post("/payouts/settle", requirePermission("payouts.manage"), settleProvider);
router.patch("/payouts/config", requirePermission("payouts.manage"), updatePayoutConfig);
router.patch("/payouts/:id/collect", requirePermission("payouts.manage"), collectPayout);
router.patch("/payouts/:id/revert", requirePermission("payouts.manage"), revertPayout);

// ============================================
// EMPLOYEES (RBAC - ADMIN TEAM MANAGEMENT)
// ============================================
router.get("/employees/roles-meta", requirePermission("employees.view"), getRolesMeta);
router.get("/employees", requirePermission("employees.view"), getEmployees);
router.post("/employees", requirePermission("employees.manage"), createEmployee);
router.patch("/employees/:id", requirePermission("employees.manage"), updateEmployee);
router.patch("/employees/:id/toggle-active", requirePermission("employees.manage"), toggleEmployeeActive);
router.delete("/employees/:id", requirePermission("employees.manage"), removeEmployee);

export default router;