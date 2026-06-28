import express from "express";
import {
    createServiceRequest,
    cancelServiceRequest,
    getUserServiceRequests,
    getPendingServiceRequests,
    getMistriAssignedRequests,
    getServiceRequestById,
    acceptServiceRequest,
    completeServiceRequest,
    toggleUnpaidServiceRequest,
    startWork,
    getJobHistory,
    getJobStats,
    getEarnings,
    markJobAsPaid
} from "../controllers/users/serviceRequestController";
import { authenticate } from "../middleware/auth";

const router = express.Router();

// GET /api/service-requests - Get user's service requests
router.get("/", authenticate, getUserServiceRequests);
// GET /api/service-requests/pending - Get pending requests for mistri (currently returns empty for security)
router.get("/pending", authenticate, getPendingServiceRequests);
// GET /api/service-requests/assigned - Get assigned requests for mistri (currently returns empty for security)
router.get("/assigned", authenticate, getMistriAssignedRequests);

// GET /api/service-requests/history - Get job history with filters (mistri-only)
router.get("/history", authenticate, getJobHistory);

// GET /api/service-requests/stats - Get job statistics (mistri-only)
router.get("/stats", authenticate, getJobStats);

// GET /api/service-requests/earnings - Get earnings data with trend (mistri-only)
router.get("/earnings", authenticate, getEarnings);

// GET /api/service-requests/:id - Get single service request (owner or assigned mistri)
router.get("/:id", authenticate, getServiceRequestById);

// POST /api/service-requests - Create a new service request
router.post("/", authenticate, createServiceRequest);

// POST /api/service-requests/:id/accept - Accept a service request (mistri-only)
router.post("/:id/accept", authenticate, acceptServiceRequest);

// POST /api/service-requests/:id/start-work - Mark when work starts (mistri-only)
router.post("/:id/start-work", authenticate, startWork);

// POST /api/service-requests/:id/complete - Complete a service request (mistri-only)
router.post("/:id/complete", authenticate, completeServiceRequest);

// POST /api/service-requests/:id/toggle-unpaid - Toggle unpaid status (mistri-only)
router.post("/:id/toggle-unpaid", authenticate, toggleUnpaidServiceRequest);

// POST /api/service-requests/:id/mark-paid - Mark job as paid (mistri-only)
router.post("/:id/mark-paid", authenticate, markJobAsPaid);

// POST /api/service-requests/:id/cancel - Cancel a service request
router.post("/:id/cancel", authenticate, cancelServiceRequest);

export default router;