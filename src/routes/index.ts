// backend/src/routes/index.ts

import { Router } from "express";
import { authenticate } from "../middleware/auth";
import adminRoutes from "./admin";
import adminAuthRoutes from "./admin/auth";
import mistriRoutes from "./mistri";
import mistriAuthRoutes from "./mistri/auth";
import usersRoutes from "./users";
import usersAuthRoutes from "./users/auth";
import publicRoutes from "./public";

const router = Router();

// ============================================
// ✅ PUBLIC ROUTES (No authentication)
// ============================================

// Auth routes are public
router.use("/users/auth", usersAuthRoutes);
router.use("/mistri/auth", mistriAuthRoutes);  
router.use("/admin/auth", adminAuthRoutes);
router.use("/public", publicRoutes);

// ============================================
// ✅ PROTECTED ROUTES (Authentication required)
// ============================================

// Protected routes - require authentication
router.use("/admin", authenticate, adminRoutes);
router.use("/mistri", authenticate, mistriRoutes);
router.use("/users", authenticate, usersRoutes);

export default router;