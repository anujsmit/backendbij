// backend/src/routes/users/index.ts

import { Router } from "express";
import { authenticate } from "../../middleware/auth";

// ============================================
// IMPORT ALL USER CONTROLLERS
// ============================================

// Cart
import {
    getCart,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,
    getCartCount,
} from "../../controllers/users/cartController";

// Consultations
import {
    createConsultation,
    getMyConsultations,
    getConsultationById as getCustomerConsultationById,
    cancelConsultation,
} from "../../controllers/users/usersconsultationController";

// Notifications
import {
    getUserNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
} from "../../controllers/users/notificationController";

// Notification Preferences
import {
    getNotificationPreferences,
    updateNotificationPreferences,
} from "../../controllers/users/notificationPreferencesController";

// Orders
import {
    createOrder,
    getCustomerOrders,
    getOrderById,
    cancelOrder,
    getOrderCounts,
} from "../../controllers/users/orderController";

// Ratings
import {
    createRating,
    getMistriRatings,
    getMyRatings,
    checkIfRated,
    getPendingRatings,
    approveRating,
    rejectRating,
} from "../../controllers/mistri/ratingController";

// Service Requests
import {
    createServiceRequest,
    cancelServiceRequest,
    getUserServiceRequests,
    getPendingServiceRequests,
    getMistriAssignedRequests,
    getServiceRequestById,
    acceptServiceRequest,
    completeServiceRequest,
    toggleUnpaidServiceRequest,
    startWork,
    getJobHistory,
    getJobStats,
    getEarnings,
    markJobAsPaid,
} from "../../controllers/mistri/serviceRequestController";

const router = Router();

// All routes in this file require authentication
router.use(authenticate);

// ============================================
// CART ROUTES
// ============================================
// Base path: /api/users/cart

const cartRouter = Router();
cartRouter.get("/", getCart);
cartRouter.get("/count", getCartCount);
cartRouter.post("/add", addToCart);
cartRouter.patch("/items/:id", updateCartItem);
cartRouter.delete("/items/:id", removeFromCart);
cartRouter.delete("/clear", clearCart);
router.use("/cart", cartRouter);

// ============================================
// CONSULTATION ROUTES
// ============================================
// Base path: /api/users/consultations

const consultationRouter = Router();
consultationRouter.post("/", createConsultation);
consultationRouter.get("/my", getMyConsultations);
consultationRouter.get("/:id", getCustomerConsultationById);
consultationRouter.patch("/:id/cancel", cancelConsultation);
router.use("/consultations", consultationRouter);

// ============================================
// NOTIFICATION ROUTES
// ============================================
// Base path: /api/users/notifications

const notificationRouter = Router();
notificationRouter.get("/", getUserNotifications);
notificationRouter.post("/:id/read", markNotificationAsRead);
notificationRouter.post("/read-all", markAllNotificationsAsRead);
router.use("/notifications", notificationRouter);

// ============================================
// NOTIFICATION PREFERENCES ROUTES
// ============================================
// Base path: /api/users/notification-preferences

const preferenceRouter = Router();
preferenceRouter.get("/", getNotificationPreferences);
preferenceRouter.put("/", updateNotificationPreferences);
router.use("/notification-preferences", preferenceRouter);

// ============================================
// ORDER ROUTES
// ============================================
// Base path: /api/users/orders

const orderRouter = Router();
orderRouter.post("/", createOrder);
orderRouter.get("/", getCustomerOrders);
orderRouter.get("/counts", getOrderCounts);
orderRouter.get("/:id", getOrderById);
orderRouter.post("/:id/cancel", cancelOrder);
router.use("/orders", orderRouter);

// ============================================
// RATING ROUTES
// ============================================
// Base path: /api/users/ratings

const ratingRouter = Router();
ratingRouter.get("/my", getMyRatings);
ratingRouter.get("/mistri/:mistriId", getMistriRatings);
ratingRouter.get("/check/:serviceRequestId", checkIfRated);
ratingRouter.post("/", createRating);
// Admin rating routes (for users with admin role)
ratingRouter.get("/pending", getPendingRatings);
ratingRouter.post("/:id/approve", approveRating);
ratingRouter.post("/:id/reject", rejectRating);
router.use("/ratings", ratingRouter);

// ============================================
// SERVICE REQUEST ROUTES
// ============================================
// Base path: /api/users/service-requests

const serviceRequestRouter = Router();
serviceRequestRouter.get("/", getUserServiceRequests);
serviceRequestRouter.get("/pending", getPendingServiceRequests);
serviceRequestRouter.get("/assigned", getMistriAssignedRequests);
serviceRequestRouter.get("/history", getJobHistory);
serviceRequestRouter.get("/stats", getJobStats);
serviceRequestRouter.get("/earnings", getEarnings);
serviceRequestRouter.get("/:id", getServiceRequestById);
serviceRequestRouter.post("/", createServiceRequest);
serviceRequestRouter.post("/:id/accept", acceptServiceRequest);
serviceRequestRouter.post("/:id/start-work", startWork);
serviceRequestRouter.post("/:id/complete", completeServiceRequest);
serviceRequestRouter.post("/:id/toggle-unpaid", toggleUnpaidServiceRequest);
serviceRequestRouter.post("/:id/mark-paid", markJobAsPaid);
serviceRequestRouter.post("/:id/cancel", cancelServiceRequest);
router.use("/service-requests", serviceRequestRouter);

// ============================================
// EXPORT ROUTER
// ============================================

export default router;