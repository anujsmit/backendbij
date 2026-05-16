import express from "express";
import {
    getNotificationPreferences,
    updateNotificationPreferences,
} from "../controllers/notificationPreferencesController";
import { authenticate } from "../middleware/auth";

const router = express.Router();

// GET /api/notification-preferences - Get user's notification preferences
router.get("/", authenticate, getNotificationPreferences);

// PUT /api/notification-preferences - Update user's notification preferences
router.put("/", authenticate, updateNotificationPreferences);

export default router;
