import express from 'express';
import { getServices, getServiceById, getActiveServices } from '../controllers/servicesController';

const router = express.Router();

router.get('/', getServices);
router.get('/active', getActiveServices);
router.get('/:id', getServiceById);

export default router;