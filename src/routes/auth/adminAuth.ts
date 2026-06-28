// backend/src/routes/auth/adminAuth.ts
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

/**
 * POST /api/auth/admin/login
 * Login with phone and password
 * Body: { phone, password }
 */
router.post("/login", adminLogin);

/**
 * POST /api/auth/admin/logout
 * Logout admin
 * Body: { refreshToken? } (optional)
 */
router.post("/logout", adminLogout);

/**
 * POST /api/auth/admin/refresh-token
 * Refresh access token
 * Body: { refreshToken }
 */
router.post("/refresh-token", adminRefreshToken);

/**
 * GET /api/auth/admin/me
 * Get current admin profile
 * Headers: Authorization: Bearer <token>
 */
router.get("/me", authenticateAdmin, adminGetMe);

/**
 * POST /api/auth/admin/change-password
 * Change password
 * Headers: Authorization: Bearer <token>
 * Body: { currentPassword, newPassword }
 */
router.post("/change-password", authenticateAdmin, adminChangePassword);

export default router;