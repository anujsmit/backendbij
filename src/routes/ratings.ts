import express from "express";
import {
    createRating,
    getMistriRatings,
    getMyRatings,
    checkIfRated,
    getPendingRatings,
    approveRating,
    rejectRating,
} from "../controllers/ratingController";
import { authenticate } from "../middleware/auth";

const router = express.Router();

// GET /api/ratings/my - Get ratings for the authenticated mistri
router.get("/my", authenticate, getMyRatings);

// GET /api/ratings/mistri/:mistriId - Get all ratings for a mistri
router.get("/mistri/:mistriId", authenticate, getMistriRatings);

// GET /api/ratings/check/:serviceRequestId - Check if service request is rated
router.get("/check/:serviceRequestId", authenticate, checkIfRated);

// Admin routes
// GET /api/ratings/pending - Get all pending ratings (admin only)
router.get("/pending", authenticate, getPendingRatings);

// POST /api/ratings/:id/approve - Approve a rating (admin only)
router.post("/:id/approve", authenticate, approveRating);

// POST /api/ratings/:id/reject - Reject and delete a rating (admin only)
router.post("/:id/reject", authenticate, rejectRating);

// POST /api/ratings - Create a new rating (customer-only)
router.post("/", authenticate, createRating);

export default router;
