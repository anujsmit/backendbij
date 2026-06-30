// backend/src/routes/admin/auth.ts

import { Router } from "express";
import {
    adminLogin,
    adminLogout,
    adminRefreshToken,
    adminGetMe,
    adminChangePassword,
} from "../../controllers/auth/adminAuthController";
import { authenticateAdmin } from "../../middleware/auth";

const router = Router();

// ============================================
// ADMIN AUTHENTICATION ROUTES
// ============================================

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

/**
 * POST /api/admin/auth/login
 * Login with phone and password
 * Body: { phone, password }
 */
router.post("/login", adminLogin);

/**
 * POST /api/admin/auth/login-with-password
 * Alias for /login to match frontend
 * Body: { phone, password }
 */
router.post("/login-with-password", adminLogin);

/**
 * POST /api/admin/auth/refresh-token
 * Refresh access token
 * Body: { refreshToken }
 */
router.post("/refresh-token", adminRefreshToken);

// ============================================
// PROTECTED ROUTES (Authentication required)
// ============================================

/**
 * POST /api/admin/auth/logout
 * Logout admin
 * Body: { refreshToken? } (optional)
 * Headers: Authorization: Bearer <token>
 */
router.post("/logout", authenticateAdmin, adminLogout);

/**
 * GET /api/admin/auth/me
 * Get current admin profile
 * Headers: Authorization: Bearer <token>
 */
router.get("/me", authenticateAdmin, adminGetMe);

/**
 * POST /api/admin/auth/change-password
 * Change password
 * Headers: Authorization: Bearer <token>
 * Body: { currentPassword, newPassword }
 */
router.post("/change-password", authenticateAdmin, adminChangePassword);

export default router;