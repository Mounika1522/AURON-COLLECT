
import express from "express";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

import {
  createCreditAdjustment,
  getCreditAdjustments,
  getCreditAdjustmentById,
  approveCreditAdjustment,
  rejectCreditAdjustment
} from "../controllers/credit-adjustment.controller.js";

const router = express.Router();

router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

router.post("/", createCreditAdjustment);
router.get("/", getCreditAdjustments);
router.get("/:id", getCreditAdjustmentById);
router.patch("/:id/approve", approveCreditAdjustment);
router.patch("/:id/reject", rejectCreditAdjustment);

export default router;
