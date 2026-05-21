import { Router } from "express";
import {
    register,            
    verifyOtp,           
    loginWithPassword,   
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

const router = Router();

// Authentication Core Flow
router.post("/signup", register);
router.post("/otp/verify", verifyOtp);
router.post("/login", loginWithPassword);

// Account Operations 
router.get("/me", authenticateToken, getMe);
router.post("/role", authenticateToken, setUserRole);
router.put("/profile", authenticateToken, updateProfile);
router.post("/refresh-token", refreshToken);
router.post("/logout", logout);

export default router;