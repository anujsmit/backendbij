// backend/src/routes/config.ts

import express from 'express';
import { authenticate } from '../../middleware/auth';

const router = express.Router();

// Protected endpoint - requires authentication to get API key
router.get('/maps-key', authenticate, (req, res) => {
    res.json({ key: process.env.GOOGLE_MAPS_API_KEY });
});

export default router;