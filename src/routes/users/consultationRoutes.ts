// backend/src/routes/consultationRoutes.ts
import { Router } from "express";
import {
    createConsultation,
    getMyConsultations,
    getConsultationById as getCustomerConsultationById,
    cancelConsultation,
} from "../../controllers/users/usersconsultationController";

import { authenticate } from "../../middleware/auth";
const router = Router();

// ============================================
// CUSTOMER ROUTES
// ============================================

// Create consultation
router.post('/consultations', authenticate, createConsultation);

// Get my consultations
router.get('/consultations/my', authenticate, getMyConsultations);

// Get consultation by ID (customer view)
router.get('/consultations/:id', authenticate, getCustomerConsultationById);

// Cancel consultation
router.patch('/consultations/:id/cancel', authenticate, cancelConsultation);

export default router;