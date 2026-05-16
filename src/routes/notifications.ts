import express from "express";
import { getUserNotifications, markNotificationAsRead, markAllNotificationsAsRead } from "../controllers/notificationController";
import { authenticate } from "../middleware/auth";

const router = express.Router();

// GET /api/notifications - Get user's notifications
router.get("/", authenticate, getUserNotifications);

// POST /api/notifications/:id/read - Mark notification as read
router.post("/:id/read", authenticate, markNotificationAsRead);

// POST /api/notifications/read-all - Mark all notifications as read
router.post("/read-all", authenticate, markAllNotificationsAsRead);

export default router;
