
import express from "express";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

import {
  getDashboardSummary
} from "../controllers/dashboard.controller.js";

const router = express.Router();

router.get(
  "/",
  authMiddleware,
  dashboardAccessMiddleware,
  getDashboardSummary
);

export default router;
