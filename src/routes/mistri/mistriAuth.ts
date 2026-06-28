// backend/src/routes/auth/mistriAuth.ts
import { Router } from "express";
import {
    registerMistri,
    loginMistri,
    verifyMistriOtp,
    mistriForgotPassword,
    verifyMistriForgotOtp,
    resetMistriPassword,
    logoutMistri,
    refreshMistriToken,
    getMistriProfile,
    changeMistriPassword,
} from "../../controllers/auth/mistriAuthController";
import { authenticate, requireMistri } from "../../middleware/auth";

const router = Router();

// ============================================
// MISTRI AUTHENTICATION ROUTES
// ============================================

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

/**
 * POST /api/auth/mistri/register
 * Register a new mistri
 * Body: { phone, fullName, password, dob? }
 */
router.post("/register", registerMistri);

/**
 * POST /api/auth/mistri/login
 * Login mistri with phone and password
 * Body: { phone, password }
 */
router.post("/login", loginMistri);

/**
 * POST /api/auth/mistri/otp/verify
 * Verify OTP for mistri
 * Body: { phone, otp }
 */
router.post("/otp/verify", verifyMistriOtp);

/**
 * POST /api/auth/mistri/forgot-password
 * Request password reset OTP
 * Body: { phone }
 */
router.post("/forgot-password", mistriForgotPassword);

/**
 * POST /api/auth/mistri/verify-forgot-otp
 * Verify forgot password OTP
 * Body: { phone, otp }
 */
router.post("/verify-forgot-otp", verifyMistriForgotOtp);

/**
 * POST /api/auth/mistri/reset-password
 * Reset password with token
 * Body: { phone, token, newPassword }
 */
router.post("/reset-password", resetMistriPassword);

// ============================================
// PROTECTED ROUTES (Authentication required)
// ============================================

/**
 * GET /api/auth/mistri/profile
 * Get mistri profile
 * Headers: Authorization: Bearer <token>
 */
router.get("/profile", authenticate, requireMistri, getMistriProfile);

/**
 * POST /api/auth/mistri/logout
 * Logout mistri
 * Body: { refreshToken? }
 * Headers: Authorization: Bearer <token>
 */
router.post("/logout", authenticate, requireMistri, logoutMistri);

/**
 * POST /api/auth/mistri/refresh
 * Refresh access token
 * Body: { refreshToken }
 */
router.post("/refresh", refreshMistriToken);

/**
 * POST /api/auth/mistri/change-password
 * Change mistri password
 * Body: { currentPassword, newPassword }
 * Headers: Authorization: Bearer <token>
 */
router.post("/change-password", authenticate, requireMistri, changeMistriPassword);

export default router;