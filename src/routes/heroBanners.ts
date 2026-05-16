import express from "express";
import { getPublicHeroBanners } from "../controllers/heroBannerController";

const router = express.Router();

// GET /api/hero-banners — public endpoint for mobile
router.get("/", getPublicHeroBanners);

export default router;
