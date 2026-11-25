
import express from "express";

import {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  recordTaskOutcome
} from "../controllers/task.controller.js";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

const router = express.Router();

router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

router.post("/", createTask);
router.get("/", getTasks);
router.get("/:id", getTaskById);
router.put("/:id", updateTask);
router.post("/:id/outcome", recordTaskOutcome);

export default router;
