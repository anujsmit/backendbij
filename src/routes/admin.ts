import express from "express";
import { authenticate } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";
import { requirePermission } from "../middleware/requirePermission";
import { adminSendOtp, adminVerifyOtp, adminLogout } from "../controllers/adminAuthController";
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

const router = express.Router();

// Public admin auth routes — no token required
router.post("/auth/send-otp", adminSendOtp);
router.post("/auth/verify-otp", adminVerifyOtp);
router.post("/auth/logout", adminLogout);

// All routes below require authentication + admin role
router.use(authenticate, requireAdmin);

// Current admin identity + effective permissions (no extra perm — every admin needs it)
router.get("/me", getMe);
router.patch("/me", updateMe);

// Global search (Cmd-K) — any admin; destination pages enforce their own perms
router.get("/search", getGlobalSearch);

// Business / platform settings
router.get("/business-settings", requirePermission("settings.view"), getBusinessSettings);
router.patch("/business-settings", requirePermission("settings.manage"), updateBusinessSettings);

// Dashboard
router.get("/stats", requirePermission("dashboard.view"), getAdminStats);

// Analytics & insights (extends the dashboard — same view permission)
router.get("/analytics", requirePermission("dashboard.view"), getAnalytics);

// Users
router.get("/users", requirePermission("users.view"), getUsers);
router.post("/users", requirePermission("users.manage"), createUser);
router.get("/users/:id", requirePermission("users.view"), getUserById);
router.patch("/users/:id", requirePermission("users.manage"), updateUser);
router.patch("/users/:id/toggle-active", requirePermission("users.manage"), toggleUserActive);
router.get("/users/:id/detail", requirePermission("users.view"), getCustomerDetail);
router.patch("/users/:id/flag", requirePermission("users.manage"), flagUser);
router.post("/users/:id/message", requirePermission("users.manage"), messageUser);

// Mistris (counts before list path — explicit segment)
router.get("/mistris/counts", requirePermission("mistris.view"), getMistrisCounts);
router.get("/mistris", requirePermission("mistris.view"), getMistris);
router.post("/mistris", requirePermission("mistris.manage"), createMistri);
router.patch("/mistris/:userId/toggle-featured", requirePermission("mistris.manage"), toggleMistriFeatured);
router.patch("/mistris/:userId/update-service", requirePermission("mistris.manage"), updateMistriService);
router.patch("/mistris/:userId/approve", requirePermission("mistris.manage"), approveMistri);
router.patch("/mistris/:userId/reject", requirePermission("mistris.manage"), rejectMistri);

// Service Categories
router.get("/service-categories", requirePermission("services.manage"), getAllServiceCategories);
router.post("/service-categories", requirePermission("services.manage"), createServiceCategory);
router.patch("/service-categories/:id", requirePermission("services.manage"), updateServiceCategory);

// Platform Services
router.get("/platform-services", requirePermission("services.manage"), getAllPlatformServices);
router.post("/platform-services", requirePermission("services.manage"), createPlatformService);
router.patch("/platform-services/:id", requirePermission("services.manage"), updatePlatformService);
router.delete("/platform-services/:id", requirePermission("services.manage"), deletePlatformService);

// CDN Asset Upload (used by services + banners editors)
router.post("/upload", uploadAsset);

// Hero Banners
router.get("/hero-banners", requirePermission("banners.manage"), getAdminHeroBanners);
router.post("/hero-banners", requirePermission("banners.manage"), createHeroBanner);
router.patch("/hero-banners/reorder", requirePermission("banners.manage"), reorderHeroBanners);
router.patch("/hero-banners/:id", requirePermission("banners.manage"), updateHeroBanner);
router.delete("/hero-banners/:id", requirePermission("banners.manage"), deleteHeroBanner);

// Ratings
router.get("/ratings", requirePermission("ratings.view"), getAdminRatings);
router.post("/ratings/:id/approve", requirePermission("ratings.moderate"), approveRating);
router.post("/ratings/:id/reject", requirePermission("ratings.moderate"), rejectRating);

// Service Requests (ops console — monitor, counts, manual assign)
router.get("/service-requests/counts", requirePermission("requests.view"), getServiceRequestCounts);
router.get("/service-requests/assignable-mistris", requirePermission("requests.assign"), getAssignableMistris);
router.get("/service-requests", requirePermission("requests.view"), getAdminServiceRequests);
router.post("/service-requests/:id/assign", requirePermission("requests.assign"), assignServiceRequest);

// Audit Logs
router.get("/audit-logs", requirePermission("audit.view"), getAuditLogs);

// SMS
router.get("/sms-stats", requirePermission("sms.view"), getSmsStats);
router.get("/sms-logs", requirePermission("sms.view"), getSmsLogs);

// Broadcast (engagement — push / SMS / in-app to segments)
router.get("/broadcast/segments", requirePermission("broadcast.send"), getBroadcastSegments);
router.get("/broadcast/history", requirePermission("broadcast.send"), getBroadcastHistory);
router.post("/broadcast/send", requirePermission("broadcast.send"), sendBroadcast);

// Expenses (finance — report before list path so the literal segment wins)
router.get("/expenses/report", requirePermission("expenses.view"), getExpenseReport);
router.get("/expenses", requirePermission("expenses.view"), getExpenses);
router.post("/expenses", requirePermission("expenses.manage"), createExpense);
router.patch("/expenses/:id", requirePermission("expenses.manage"), updateExpense);
router.delete("/expenses/:id", requirePermission("expenses.manage"), deleteExpense);

// Profit & Loss statement (finance — commission income vs operating expenses)
router.get("/pnl", requirePermission("expenses.view"), getPnlStatement);

// Payouts (finance — provider commission settlements; specific paths before generic)
router.get("/payouts/report", requirePermission("payouts.view"), getPayoutReport);
router.get("/payouts/providers", requirePermission("payouts.view"), getPayoutProviders);
router.get("/payouts", requirePermission("payouts.view"), getPayouts);
router.post("/payouts/settle", requirePermission("payouts.manage"), settleProvider);
router.patch("/payouts/config", requirePermission("payouts.manage"), updatePayoutConfig);
router.patch("/payouts/:id/collect", requirePermission("payouts.manage"), collectPayout);
router.patch("/payouts/:id/revert", requirePermission("payouts.manage"), revertPayout);

// Employees (RBAC — admin team management)
router.get("/employees/roles-meta", requirePermission("employees.view"), getRolesMeta);
router.get("/employees", requirePermission("employees.view"), getEmployees);
router.post("/employees", requirePermission("employees.manage"), createEmployee);
router.patch("/employees/:id", requirePermission("employees.manage"), updateEmployee);
router.patch("/employees/:id/toggle-active", requirePermission("employees.manage"), toggleEmployeeActive);
router.delete("/employees/:id", requirePermission("employees.manage"), removeEmployee);

export default router;
