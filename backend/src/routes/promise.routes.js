import express from "express";

import {
  createPromise,
  getPromises,
  getPromiseById,
  updatePromise,
  updatePromiseStatus
} from "../controllers/promise.controller.js";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

const router = express.Router();

router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

router.post("/", createPromise);
router.get("/", getPromises);
router.get("/:id", getPromiseById);
router.put("/:id", updatePromise);
router.patch("/:id/status", updatePromiseStatus);

export default router;