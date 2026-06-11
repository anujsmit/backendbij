import { Router } from "express";
// Use the enhanced auth controller
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
    verifyAccountDeletion
} from "../controllers/enhancedAuthController";
import { createMistriProfile } from "../controllers/mistriController";

const router = Router();

router.post("/otp/send", sendOtp);
router.post("/otp/verify", verifyOtp);
router.get("/me", authenticateToken, getMe);
router.post("/role", authenticateToken, setUserRole);
router.put("/profile", authenticateToken, updateProfile);
// Phone number change endpoints
router.post("/request-phone-change", authenticateToken, requestPhoneChange);
router.post("/verify-phone-change", authenticateToken, verifyPhoneChange);
// Device token registration for push notifications
router.post("/register-device-token", authenticateToken, registerDeviceToken);
// Token refresh endpoint
router.post("/refresh-token", refreshToken);
// Logout endpoint
router.post("/logout", logout);
// Account deletion endpoints
router.post("/request-account-deletion", authenticateToken, requestAccountDeletion);
router.post("/verify-account-deletion", authenticateToken, verifyAccountDeletion);
// Mistri profile creation
router.post("/mistri/profile", authenticateToken, createMistriProfile);

export default router;
