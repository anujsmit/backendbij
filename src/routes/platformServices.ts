import express from "express";
import {
    getPlatformServices,
    getPlatformServicesByCategory,
    getPopularServices, 
} from "../controllers/platformServiceController";

const router = express.Router();
router.get("/", getPlatformServices);
router.get("/category/:categoryId", getPlatformServicesByCategory);
router.get("/popular", getPopularServices);

export default router;