// backend/src/routes/platformServices.ts

import express from "express";
import {
    getPlatformServices,
    getPlatformServicesByCategory,
    getPopularServices, 
} from "../../controllers/shared/platformServiceController";
import { 
    getServiceHierarchy,
    getCategoryHierarchy,
    getServiceItemDetails
} from "../../controllers/shared/serviceHierarchyController";

const router = express.Router();

// Legacy platform services routes
router.get("/", getPlatformServices);
router.get("/category/:categoryId", getPlatformServicesByCategory);
router.get("/popular", getPopularServices);

router.get("/service-hierarchy", getServiceHierarchy);
router.get("/service-hierarchy/:id", getCategoryHierarchy);
router.get("/service-hierarchy/item/:id", getServiceItemDetails);

export default router;