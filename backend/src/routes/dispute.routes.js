import express from "express";

import {
  createDispute,
  getDisputes,
  getDisputeById,
  updateDispute,
  updateDisputeStatus,
  resolveDispute
} from "../controllers/dispute.controller.js";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

const router = express.Router();

router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

router.post("/", createDispute);
router.get("/", getDisputes);
router.get("/:id", getDisputeById);
router.put("/:id", updateDispute);
router.patch("/:id/status", updateDisputeStatus);
router.patch("/:id/resolve", resolveDispute);

export default router;