// backend/src/routes/publicServices.ts

import express from "express";
import { 
    getServiceHierarchy,
    getCategoryHierarchy,
    getServiceItemDetails
} from "../controllers/serviceHierarchyController";

const router = express.Router();

// Public routes for service hierarchy - accessible without authentication
router.get("/service-hierarchy", getServiceHierarchy);
router.get("/service-hierarchy/:id", getCategoryHierarchy);
router.get("/service-hierarchy/item/:id", getServiceItemDetails);

export default router;