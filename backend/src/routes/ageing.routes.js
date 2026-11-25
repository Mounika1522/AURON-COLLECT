import express from "express";

import { getAgeingReport } from "../controllers/ageing.controller.js";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

const router = express.Router();

router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

router.get("/", getAgeingReport);

export default router;