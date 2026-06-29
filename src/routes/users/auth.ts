// backend/src/routes/users/auth.ts

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
// ✅ PUBLIC ROUTES (No authentication required)
// ============================================

// These should NOT have authenticateUser middleware
router.post("/register", registerUser);
router.post("/login", loginUser);  // ❌ Make sure NO middleware here
router.post("/verify-otp", verifyUserOtp);
router.post("/resend-otp", resendUserOtp);
router.post("/forgot-password", userForgotPassword);
router.post("/verify-forgot-otp", verifyUserForgotOtp);
router.post("/reset-password", resetUserPassword);
router.post("/refresh-token", refreshUserToken);

// ============================================
// ✅ PROTECTED ROUTES (Authentication required)
// ============================================

// These SHOULD have authenticateUser middleware
router.post("/logout", authenticateUser, logoutUser);
router.get("/profile", authenticateUser, getUserProfile);
router.put("/profile", authenticateUser, updateUserProfile);
router.post("/change-password", authenticateUser, changeUserPassword);

export default router;