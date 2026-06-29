// backend/src/routes/mistri/index.ts

import express from "express";
import { authenticate, requireMistri } from "../../middleware/auth";

// ============================================
// IMPORT ALL MISTRI CONTROLLERS
// ============================================

// Profile & Management
import {
    createMistriProfile,
    getNearbyMistris,
    getTargetedRequests,
    getMistriProfile,
    updateMistriProfile,
    getAcceptedJobs,
} from "../../controllers/mistri/mistriController";

// Service Requests (Mistri Actions)
import {
    acceptServiceRequest,
    completeServiceRequest,
    toggleUnpaidServiceRequest,
    startWork,
    getJobHistory,
    getJobStats,
    getEarnings,
    markJobAsPaid,
    getPendingServiceRequests,
    getMistriAssignedRequests,
    getServiceRequestById,
    declineServiceRequest,
    markArrived,
    completeServiceRequestWithPhotos,
    getCompletionPhotos,
    getWarrantyStatus,
} from "../../controllers/mistri/serviceRequestController";

// Ratings
import {
    getMyRatings,
    getMistriRatings,
} from "../../controllers/mistri/ratingController";

const router = express.Router();

// All mistri routes require authentication and mistri role
router.use(authenticate);
router.use(requireMistri);

// ============================================
// PROFILE MANAGEMENT
// ============================================
// Base path: /api/mistri

/**
 * POST /api/mistri/profile
 * Create mistri profile (onboarding)
 * Body: { serviceId, profilePhotoBase64, currentLocation, fullName, bio, experienceLevel, govtIdType, govtIdFrontBase64, govtIdBackBase64 }
 */
router.post("/profile", createMistriProfile);

/**
 * GET /api/mistri/profile
 * Get mistri profile
 */
router.get("/profile", getMistriProfile);

/**
 * PUT /api/mistri/profile
 * Update mistri profile
 * Body: { serviceId?, profilePhotoBase64?, currentLocation?, fullName?, bio?, isAvailable?, availabilityStatus? }
 */
router.put("/profile", updateMistriProfile);

// ============================================
// NEARBY & SEARCH
// ============================================

/**
 * POST /api/mistri/nearby
 * Get nearby available mistris (for customers)
 * Body: { lat, lng, maxDistanceKm? }
 * Note: This endpoint might be accessible by customers too
 */
router.post("/nearby", getNearbyMistris);

// ============================================
// SERVICE REQUESTS (Mistri Actions)
// ============================================
// Base path: /api/mistri/requests

/**
 * GET /api/mistri/requests/pending
 * Get all pending service requests (for mistri to accept)
 */
router.get("/requests/pending", getPendingServiceRequests);

/**
 * GET /api/mistri/requests/targeted
 * Get pending requests specifically assigned to this mistri
 */
router.get("/requests/targeted", getTargetedRequests);

/**
 * GET /api/mistri/requests/assigned
 * Get currently assigned requests for this mistri
 */
router.get("/requests/assigned", getMistriAssignedRequests);

/**
 * GET /api/mistri/requests/accepted-jobs
 * Get all accepted jobs (assigned + completed)
 */
router.get("/requests/accepted-jobs", getAcceptedJobs);

/**
 * GET /api/mistri/requests/:id
 * Get a single service request by ID (if assigned to this mistri)
 */
router.get("/requests/:id", getServiceRequestById);

/**
 * POST /api/mistri/requests/:id/accept
 * Accept a pending service request
 */
router.post("/requests/:id/accept", acceptServiceRequest);

/**
 * POST /api/mistri/requests/:id/decline
 * Decline a service request
 */
router.post("/requests/:id/decline", declineServiceRequest);

/**
 * POST /api/mistri/requests/:id/start-work
 * Mark when work starts on a request
 */
router.post("/requests/:id/start-work", startWork);

/**
 * POST /api/mistri/requests/:id/arrive
 * Mark arrival at customer location
 * Body: { lat?, lng? }
 */
router.post("/requests/:id/arrive", markArrived);

/**
 * POST /api/mistri/requests/:id/complete
 * Mark a service request as completed (legacy - no photos)
 */
router.post("/requests/:id/complete", completeServiceRequest);

/**
 * POST /api/mistri/requests/:id/complete-with-photos
 * Complete job with photos (new flow with warranty)
 * Body: { photos: string[], note?: string }
 */
router.post("/requests/:id/complete-with-photos", completeServiceRequestWithPhotos);

/**
 * POST /api/mistri/requests/:id/toggle-unpaid
 * Toggle unpaid status for a job
 */
router.post("/requests/:id/toggle-unpaid", toggleUnpaidServiceRequest);

/**
 * POST /api/mistri/requests/:id/mark-paid
 * Mark a job as paid
 */
router.post("/requests/:id/mark-paid", markJobAsPaid);

/**
 * GET /api/mistri/requests/:id/photos
 * Get completion photos
 */
router.get("/requests/:id/photos", getCompletionPhotos);

/**
 * GET /api/mistri/requests/:id/warranty
 * Get warranty status
 */
router.get("/requests/:id/warranty", getWarrantyStatus);

// ============================================
// JOB HISTORY & STATISTICS
// ============================================

/**
 * GET /api/mistri/jobs/history
 * Get job history with filters
 * Query: { startDate?, endDate?, status?, serviceType?, search?, page?, limit? }
 */
router.get("/jobs/history", getJobHistory);

/**
 * GET /api/mistri/jobs/stats
 * Get job statistics
 * Query: { period?: 'week' | 'month' | 'year' }
 */
router.get("/jobs/stats", getJobStats);

/**
 * GET /api/mistri/jobs/earnings
 * Get earnings data with trend
 * Query: { period?: 'week' | 'month' | 'year' | 'all', page?, limit? }
 */
router.get("/jobs/earnings", getEarnings);

// ============================================
// RATINGS
// ============================================

/**
 * GET /api/mistri/ratings/my
 * Get ratings for the authenticated mistri
 */
router.get("/ratings/my", getMyRatings);

/**
 * GET /api/mistri/ratings/:mistriId
 * Get all ratings for a specific mistri (public)
 * Note: This could be public or protected
 */
router.get("/ratings/:mistriId", getMistriRatings);

// ============================================
// EXPORT ROUTER
// ============================================

export default router;