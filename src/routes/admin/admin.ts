// backend/src/routes/adminRoutes.ts

import express from "express";
import { authenticate, requireAdmin } from "../../middleware/auth";

// ============================================
// AUTH CONTROLLERS
// ============================================
import {
    adminLogin,
    adminLogout,
    adminRefreshToken,
    adminGetMe,
    adminChangePassword,
} from "../../controllers/auth/adminAuthController";

// ============================================
// SERVICE HIERARCHY CONTROLLERS
// ============================================
import * as categoryController from "../../controllers/admin/serviceCategoryController";
import * as subCategoryController from "../../controllers/admin/subCategoryController";
import * as serviceItemController from "../../controllers/admin/serviceItemController";

// ============================================
// OTHER CONTROLLER IMPORTS
// ============================================
import {
    getMe,
    updateMe,
    getRolesMeta,
    getEmployees,
    createEmployee,
    updateEmployee,
    toggleEmployeeActive,
    removeEmployee,
} from "../../controllers/admin/employeeController";
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
} from "../../controllers/admin/adminController";
import {
    getAdminRatings,
    approveRating,
    rejectRating,
} from "../../controllers/admin/adminRatingController";
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
} from "../../controllers/admin/heroBannerController";
import { uploadAsset } from "../../controllers/uploadController";
import {
    getExpenses,
    getExpenseReport,
    createExpense,
    updateExpense,
    deleteExpense,
} from "../../controllers/admin/expenseController";
import {
    getPayoutReport,
    getPayoutProviders,
    getPayouts,
    settleProvider,
    collectPayout,
    revertPayout,
    updatePayoutConfig,
} from "../../controllers/admin/payoutController";
import { getAnalytics } from "../../controllers/admin/analyticsController";
import {
    getBroadcastSegments,
    sendBroadcast,
    getBroadcastHistory,
} from "../../controllers/admin/broadcastController";
import { getBusinessSettings, updateBusinessSettings } from "../../controllers/admin/settingsController";
import { getPnlStatement } from "../../controllers/pnlController";
import {
    getPendingApprovalRequests,
    getRequestForAssignment,
    getAvailableMistrisForAssignment,
    assignMistriToRequest,
    rejectPendingRequest,
    getAllRequests,
    getPendingRequestDetails,
} from "../../controllers/admin/adminAssignmentController";
import {
    getAllOrders,
    getOrderById,
    assignMistriToOrder,
    getOrderCounts,
    getSubOrdersByOrder,
    assignMistriToSubOrder,
    updateOrderStatus,
    getOrderAssignmentStatus,
    batchAssignSubOrders,
} from "../../controllers/admin/adminOrderController";

// ============================================
// CONSULTATION CONTROLLERS (Admin)
// ============================================
import {
    getAllConsultations,
    getConsultationById as getAdminConsultationById,
    assignConsultation,
    updateConsultationStatus,
    getConsultationStats,
    getConsultationCategories,
} from "../../controllers/admin/adminConsultationController";

const router = express.Router();

// ============================================
// ADMIN AUTH ROUTES (Public - No Auth Required)
// ============================================

/**
 * POST /api/admin/auth/login
 * Login with phone and password
 * Body: { phone, password }
 */
router.post("/auth/login", adminLogin);

/**
 * POST /api/admin/auth/logout
 * Logout admin
 * Body: { refreshToken? }
 */
router.post("/auth/logout", adminLogout);

/**
 * POST /api/admin/auth/refresh-token
 * Refresh access token
 * Body: { refreshToken }
 */
router.post("/auth/refresh-token", adminRefreshToken);

/**
 * GET /api/admin/auth/me
 * Get current admin profile
 */
router.get("/auth/me", authenticate, requireAdmin, adminGetMe);

/**
 * POST /api/admin/auth/change-password
 * Change password
 * Body: { currentPassword, newPassword }
 */
router.post("/auth/change-password", authenticate, requireAdmin, adminChangePassword);

// ============================================
// PROTECTED ROUTES (Require Authentication + Admin)
// ============================================
router.use(authenticate, requireAdmin);

// ============================================
// CURRENT ADMIN IDENTITY
// ============================================
router.get("/me", getMe);
router.patch("/me", updateMe);
router.get("/search", getGlobalSearch);

// ============================================
// BUSINESS / PLATFORM SETTINGS
// ============================================
router.get("/business-settings", getBusinessSettings);
router.patch("/business-settings", updateBusinessSettings);

// ============================================
// DASHBOARD & ANALYTICS
// ============================================
router.get("/stats", getAdminStats);
router.get("/analytics", getAnalytics);

// ============================================
// USER MANAGEMENT (Admin users)
// ============================================
router.get("/users", getUsers);
router.post("/users", createUser);
router.get("/users/:id", getUserById);
router.patch("/users/:id", updateUser);
router.patch("/users/:id/toggle-active", toggleUserActive);
router.get("/users/:id/detail", getCustomerDetail);
router.patch("/users/:id/flag", flagUser);
router.post("/users/:id/message", messageUser);

// ============================================
// MISTRI (PROVIDER) MANAGEMENT
// ============================================
router.get("/mistri-jobs/:id", getMistriJobs);
router.get("/mistris/counts", getMistrisCounts);
router.get("/mistris", getMistris);
router.post("/mistris", createMistri);
router.patch("/mistris/:userId/toggle-featured", toggleMistriFeatured);
router.patch("/mistris/:userId/update-service", updateMistriService);
router.patch("/mistris/:userId/approve", approveMistri);
router.patch("/mistris/:userId/reject", rejectMistri);

// ============================================
// SERVICE HIERARCHY - LEVEL 1: CATEGORIES
// ============================================
router.get("/service-categories", categoryController.getAllCategories);
router.get("/service-categories/:id", categoryController.getCategoryById);
router.post("/service-categories", categoryController.createCategory);
router.patch("/service-categories/:id", categoryController.updateCategory);
router.delete("/service-categories/:id", categoryController.deleteCategory);

// ============================================
// SERVICE HIERARCHY - LEVEL 2: SUB-CATEGORIES
// ============================================
router.get("/sub-categories", subCategoryController.getAllSubCategories);
router.get("/sub-categories/:id", subCategoryController.getSubCategoryById);
router.post("/sub-categories", subCategoryController.createSubCategory);
router.patch("/sub-categories/:id", subCategoryController.updateSubCategory);
router.delete("/sub-categories/:id", subCategoryController.deleteSubCategory);

// ============================================
// SERVICE HIERARCHY - LEVEL 3: SERVICE ITEMS
// ============================================
router.get("/sub-category-items", serviceItemController.getAllServiceItems);
router.get("/sub-category-items/:id", serviceItemController.getServiceItemById);
router.post("/sub-category-items", serviceItemController.createServiceItem);
router.patch("/sub-category-items/:id", serviceItemController.updateServiceItem);
router.delete("/sub-category-items/:id", serviceItemController.deleteServiceItem);
router.patch("/sub-category-items/:id/toggle-popular", serviceItemController.toggleServiceItemPopular);
router.patch("/sub-category-items/:id/toggle-active", serviceItemController.toggleServiceItemActive);

// ============================================
// CDN ASSET UPLOAD
// ============================================
router.post("/upload", uploadAsset);

// ============================================
// HERO BANNERS
// ============================================
router.get("/hero-banners", getAdminHeroBanners);
router.get("/hero-banners/stats", getBannerStats);
router.get("/hero-banners/ad-type/:adType", getBannersByAdType);
router.post("/hero-banners", createHeroBanner);
router.patch("/hero-banners/reorder", reorderHeroBanners);
router.patch("/hero-banners/:id", updateHeroBanner);
router.patch("/hero-banners/:id/toggle-active", toggleBannerActive);
router.post("/hero-banners/:id/duplicate", duplicateHeroBanner);
router.post("/hero-banners/bulk-delete", bulkDeleteHeroBanners);
router.delete("/hero-banners/:id", deleteHeroBanner);

// ============================================
// RATINGS & REVIEWS
// ============================================
router.get("/ratings", getAdminRatings);
router.post("/ratings/:id/approve", approveRating);
router.post("/ratings/:id/reject", rejectRating);

// ============================================
// SERVICE REQUESTS
// ============================================
router.get("/service-requests/counts", getServiceRequestCounts);
router.get("/service-requests/assignable-mistris", getAssignableMistris);
router.get("/service-requests", getAdminServiceRequests);
router.post("/service-requests/:id/assign", assignServiceRequest);

// ============================================
// PENDING REQUESTS MANAGEMENT
// ============================================
router.get("/pending-requests", getPendingApprovalRequests);
router.get("/pending-requests/:id", getRequestForAssignment);
router.get("/available-mistris", getAvailableMistrisForAssignment);
router.post("/pending-requests/:id/assign", assignMistriToRequest);
router.post("/pending-requests/:id/reject", rejectPendingRequest);
router.get("/all-requests", getAllRequests);

// ============================================
// AUDIT LOGS
// ============================================
router.get("/audit-logs", getAuditLogs);

// ============================================
// SMS MANAGEMENT
// ============================================
router.get("/sms-stats", getSmsStats);
router.get("/sms-logs", getSmsLogs);

// ============================================
// BROADCAST
// ============================================
router.get("/broadcast/segments", getBroadcastSegments);
router.get("/broadcast/history", getBroadcastHistory);
router.post("/broadcast/send", sendBroadcast);

// ============================================
// EXPENSES
// ============================================
router.get("/expenses/report", getExpenseReport);
router.get("/expenses", getExpenses);
router.post("/expenses", createExpense);
router.patch("/expenses/:id", updateExpense);
router.delete("/expenses/:id", deleteExpense);

// ============================================
// PROFIT & LOSS
// ============================================
router.get("/pnl", getPnlStatement);

// ============================================
// PAYOUTS
// ============================================
router.get("/payouts/report", getPayoutReport);
router.get("/payouts/providers", getPayoutProviders);
router.get("/payouts", getPayouts);
router.post("/payouts/settle", settleProvider);
router.patch("/payouts/config", updatePayoutConfig);
router.patch("/payouts/:id/collect", collectPayout);
router.patch("/payouts/:id/revert", revertPayout);

// ============================================
// EMPLOYEES (RBAC)
// ============================================
router.get("/employees/roles-meta", getRolesMeta);
router.get("/employees", getEmployees);
router.post("/employees", createEmployee);
router.patch("/employees/:id", updateEmployee);
router.patch("/employees/:id/toggle-active", toggleEmployeeActive);
router.delete("/employees/:id", removeEmployee);

// ============================================
// ORDER MANAGEMENT (Admin only)
// ============================================
router.get("/orders", getAllOrders);
router.get("/orders/counts", getOrderCounts);
router.get("/orders/:id", getOrderById);
router.get("/orders/:id/sub-orders", getSubOrdersByOrder);
router.get("/orders/:id/assignment-status", getOrderAssignmentStatus);
router.patch("/orders/:id/assign", assignMistriToOrder);
router.patch("/orders/sub-order/:id/assign", assignMistriToSubOrder);
router.patch("/orders/:id/status", updateOrderStatus);
router.post("/orders/:id/batch-assign", batchAssignSubOrders);

// ============================================
// CONSULTATION MANAGEMENT (Admin only)
// ============================================
router.get("/consultations", getAllConsultations);
router.get("/consultations/:id", getAdminConsultationById);
router.patch("/consultations/:id/assign", assignConsultation);
router.patch("/consultations/:id/status", updateConsultationStatus);
router.get("/consultations/stats", getConsultationStats);
router.get("/consultations/categories", getConsultationCategories);

export default router;