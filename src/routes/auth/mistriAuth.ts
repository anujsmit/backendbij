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
import { authenticateMistri } from "../../middleware/auth";

const router = Router();

// ============================================
// MISTRI AUTHENTICATION ROUTES
// ============================================

// Public routes (no authentication required)
router.post("/register", registerMistri);
router.post("/login", loginMistri);
router.post("/otp/verify", verifyMistriOtp);
router.post("/forgot-password", mistriForgotPassword);
router.post("/verify-forgot-otp", verifyMistriForgotOtp);
router.post("/reset-password", resetMistriPassword);
router.post("/logout", logoutMistri);
router.post("/refresh-token", refreshMistriToken);

// Protected routes (authentication required)
router.get("/profile", authenticateMistri, getMistriProfile);
router.post("/change-password", authenticateMistri, changeMistriPassword);

export default router;