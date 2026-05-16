import express from "express";
import { getServices } from "../controllers/servicesController";

const router = express.Router();

// GET /api/services - Get all active services (public endpoint)
router.get("/", getServices);

export default router;
