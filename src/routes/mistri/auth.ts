// backend/src/routes/mistri/auth.ts

import { Router } from "express";
import {
    registerMistri,
    loginMistri,
    verifyMistriOtp,
    resendMistriOtp,
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
// PUBLIC ROUTES (No authentication)
// ============================================
router.post("/register", registerMistri);
router.post("/login", loginMistri);
router.post("/otp/verify", verifyMistriOtp);
router.post("/resend-otp", resendMistriOtp); 
router.post("/forgot-password", mistriForgotPassword);
router.post("/verify-forgot-otp", verifyMistriForgotOtp);
router.post("/reset-password", resetMistriPassword);
router.post("/refresh-token", refreshMistriToken);

// ============================================
// PROTECTED ROUTES
// ============================================
router.get("/profile", authenticate, requireMistri, getMistriProfile);
router.post("/logout", authenticate, requireMistri, logoutMistri);
router.post("/change-password", authenticate, requireMistri, changeMistriPassword);

export default router;