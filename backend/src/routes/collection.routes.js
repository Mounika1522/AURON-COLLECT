
import express from "express";

import {
  getCollectionQueue
} from "../controllers/collection.controller.js";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

const router = express.Router();

router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

router.get("/queue", getCollectionQueue);

export default router;
