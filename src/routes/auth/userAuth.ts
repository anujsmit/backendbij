// backend/src/routes/auth/userAuth.ts
import { Router } from "express";
import {
    registerUser,
    loginUser,
    verifyUserOtp,
    resendUserOtp,
    userForgotPassword,
    verifyUserForgotOtp,
    resetUserPassword,
    logoutUser,
    refreshUserToken,
    getUserProfile,
    changeUserPassword,
    updateUserProfile,
} from "../../controllers/auth/userAuthController";
import { authenticateUser } from "../../middleware/auth";

const router = Router();

// ============================================
// USER AUTHENTICATION ROUTES
// ============================================

/**
 * POST /api/auth/user/register
 * Register a new user
 * Body: { phone, fullName, password, dob? }
 */
router.post("/register", registerUser);

/**
 * POST /api/auth/user/login
 * Login user with phone and password
 * Body: { phone, password }
 */
router.post("/login", loginUser);

/**
 * POST /api/auth/user/verify-otp
 * Verify OTP for user
 * Body: { phone, otp }
 */
router.post("/verify-otp", verifyUserOtp);

/**
 * POST /api/auth/user/resend-otp
 * Resend OTP for user
 * Body: { phone }
 */
router.post("/resend-otp", resendUserOtp);

/**
 * POST /api/auth/user/forgot-password
 * Request password reset OTP
 * Body: { phone }
 */
router.post("/forgot-password", userForgotPassword);

/**
 * POST /api/auth/user/verify-forgot-otp
 * Verify forgot password OTP
 * Body: { phone, otp }
 */
router.post("/verify-forgot-otp", verifyUserForgotOtp);

/**
 * POST /api/auth/user/reset-password
 * Reset password with token
 * Body: { phone, token, newPassword }
 */
router.post("/reset-password", resetUserPassword);

/**
 * POST /api/auth/user/logout
 * Logout user
 * Body: { refreshToken? }
 */
router.post("/logout", logoutUser);

/**
 * POST /api/auth/user/refresh-token
 * Refresh access token
 * Body: { refreshToken }
 */
router.post("/refresh-token", refreshUserToken);

// ============================================
// PROTECTED ROUTES (Authentication required)
// ============================================

/**
 * GET /api/auth/user/profile
 * Get user profile
 * Headers: Authorization: Bearer <token>
 */
router.get("/profile", authenticateUser, getUserProfile);

/**
 * PUT /api/auth/user/profile
 * Update user profile
 * Body: { fullName, email?, defaultLocation?, preferences? }
 * Headers: Authorization: Bearer <token>
 */
router.put("/profile", authenticateUser, updateUserProfile);

/**
 * POST /api/auth/user/change-password
 * Change user password
 * Body: { currentPassword, newPassword }
 * Headers: Authorization: Bearer <token>
 */
router.post("/change-password", authenticateUser, changeUserPassword);

export default router;