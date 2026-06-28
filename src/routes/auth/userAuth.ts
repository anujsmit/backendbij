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

// Public routes (no authentication required)
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/verify-otp", verifyUserOtp);
router.post("/resend-otp", resendUserOtp);
router.post("/forgot-password", userForgotPassword);
router.post("/verify-forgot-otp", verifyUserForgotOtp);
router.post("/reset-password", resetUserPassword);
router.post("/logout", logoutUser);
router.post("/refresh-token", refreshUserToken);

// Protected routes (authentication required)
router.get("/profile", authenticateUser, getUserProfile);
router.put("/profile", authenticateUser, updateUserProfile);
router.post("/change-password", authenticateUser, changeUserPassword);

export default router;