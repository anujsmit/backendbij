// src/routes/user.ts
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
} from '../controllers/auth/userAuthController';

const router = Router();

// ============================================
// USER AUTHENTICATION ROUTES
// ============================================

// Registration
router.post('/auth/user/register', registerUser);

// Login
router.post('/auth/user/login', loginUser);

// OTP Verification
router.post('/auth/user/otp/verify', verifyUserOtp);
router.post('/auth/user/otp/resend', resendUserOtp);

// Password Reset
router.post('/auth/user/forgot-password', userForgotPassword);
router.post('/auth/user/verify-forgot-otp', verifyUserForgotOtp);
router.post('/auth/user/reset-password', resetUserPassword);

// Token Management
router.post('/auth/user/refresh', refreshUserToken);
router.post('/auth/user/logout', logoutUser);

// Protected Routes
router.get('/auth/user/me', getUserProfile);
router.put('/auth/user/profile', updateUserProfile);
router.post('/auth/user/change-password', changeUserPassword);

export default router;