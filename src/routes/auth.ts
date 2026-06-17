import { Router } from "express";
// OTP-based auth controller
import {
    sendOtp,
    verifyOtp,
    getMe,
    setUserRole,
    updateProfile,
    authenticateToken,
    refreshToken,
    logout,
    requestPhoneChange,
    verifyPhoneChange,
    registerDeviceToken,
    requestAccountDeletion,
    verifyAccountDeletion,
    forgotPassword,
    verifyForgotOtp,
    resetPassword
} from "../controllers/enhancedAuthController";
// Password-based auth controller
import {
    registerWithPassword,
    loginWithPassword,
    verifyOtpForVerification,
    resendOtp,
    checkUserExists,
    changePassword,
} from "../controllers/passwordAuthController";
import { createMistriProfile } from "../controllers/mistriController";

const router = Router();

// ============================================
// PASSWORD-BASED AUTHENTICATION (NEW)
// ============================================

// Register with password
router.post("/register", registerWithPassword);

// Login with password
router.post("/login", loginWithPassword);

// Verify phone number with OTP (after registration)
router.post("/verify-phone", verifyOtpForVerification);

// Resend OTP for verification
router.post("/resend-otp", resendOtp);

// Check if user exists (for registration flow)
router.get("/check-user", checkUserExists);

// Change password (authenticated)
router.post("/change-password", authenticateToken, changePassword);

// ============================================
// OTP-BASED AUTHENTICATION (LEGACY)
// ============================================

// Send OTP for login
router.post("/otp/send", sendOtp);

// Verify OTP for login
router.post("/otp/verify", verifyOtp);

// ============================================
// COMMON AUTHENTICATION ENDPOINTS
// ============================================

// Get current user info (works with both auth methods)
router.get("/me", authenticateToken, getMe);

// Set user role (customer/mistri)
router.post("/role", authenticateToken, setUserRole);

// Update user profile
router.put("/profile", authenticateToken, updateProfile);

// ============================================
// DEVICE & NOTIFICATION MANAGEMENT
// ============================================

// Register device token for push notifications
router.post("/register-device-token", authenticateToken, registerDeviceToken);

// ============================================
// PHONE NUMBER CHANGE (requires authentication)
// ============================================

// Request phone number change (OTP to new number)
router.post("/request-phone-change", authenticateToken, requestPhoneChange);

// Verify phone number change with OTP
router.post("/verify-phone-change", authenticateToken, verifyPhoneChange);

// ============================================
// ACCOUNT MANAGEMENT
// ============================================

// Refresh access token
router.post("/refresh-token", refreshToken);

// Logout (invalidate refresh token)
router.post("/logout", logout);

// Request account deletion (OTP to phone)
router.post("/request-account-deletion", authenticateToken, requestAccountDeletion);

// Verify and execute account deletion
router.post("/verify-account-deletion", authenticateToken, verifyAccountDeletion);

// ============================================
// MISTRI SPECIFIC
// ============================================

// Create mistri profile (after authentication)
router.post("/mistri/profile", authenticateToken, createMistriProfile);


router.post("/forgot-password", forgotPassword);

// Step 2: Verify OTP and get reset token
router.post("/verify-forgot-otp", verifyForgotOtp);

// Step 3: Reset password with token
router.post("/reset-password", resetPassword);

export default router;