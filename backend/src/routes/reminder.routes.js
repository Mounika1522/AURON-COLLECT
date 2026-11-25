
import express from "express";

import {
  createReminderTemplate,
  getReminderTemplates,
  updateReminderTemplate,
  createReminder,
  getReminders,
  getReminderById,
  updateReminderStatus
} from "../controllers/reminder.controller.js";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

const router = express.Router();

router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

// Reminder templates
router.post("/templates", createReminderTemplate);
router.get("/templates", getReminderTemplates);
router.patch("/templates/:id", updateReminderTemplate);

// Scheduled reminders
router.post("/", createReminder);
router.get("/", getReminders);
router.get("/:id", getReminderById);
router.patch("/:id/status", updateReminderStatus);

export default router;
