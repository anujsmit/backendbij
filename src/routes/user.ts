// src/routes/user.ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
    getMe,
    updateProfile,
    setUserRole,
} from '../controllers/authController';

const router = Router();

// Get current user profile
router.get('/me', authenticate, getMe);

// Update user profile
router.put('/profile', authenticate, updateProfile);

// Set user role
router.post('/role', authenticate, setUserRole);

export default router;