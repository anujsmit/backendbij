import express from "express";
import { createMistriProfile, getNearbyMistris, getTargetedRequests, getMistriProfile, updateMistriProfile, getAcceptedJobs } from "../controllers/mistriController";
import { authenticate } from "../middleware/auth";

const router = express.Router();

// POST /api/mistri/profile - Create mistri profile
router.post("/profile", authenticate, createMistriProfile);

// GET /api/mistri/profile - Get mistri profile
router.get("/profile", authenticate, getMistriProfile);

// PUT /api/mistri/profile - Update mistri profile
router.put("/profile", authenticate, updateMistriProfile);

// POST /api/mistri/nearby - Get nearby available mistris
router.post("/nearby", authenticate, getNearbyMistris);

// GET /api/mistri/targeted-requests - Get pending requests assigned to this mistri
router.get("/targeted-requests", authenticate, getTargetedRequests);

// GET /api/mistri/accepted-jobs - Get accepted jobs for this mistri
router.get("/accepted-jobs", authenticate, getAcceptedJobs);

export default router;
