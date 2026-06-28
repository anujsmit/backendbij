// backend/src/routes/auth/index.ts
import { Router } from "express";
import mistriAuthRoutes from "./mistriAuth";
import userAuthRoutes from "./userAuth";
import adminAuthRoutes from "./adminAuth";

const router = Router();
router.use("/mistri", mistriAuthRoutes);
router.use("/user", userAuthRoutes);
router.use("/admin", adminAuthRoutes);

export default router;