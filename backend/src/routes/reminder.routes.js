
import express from "express";

import {
  createReminderTemplate,
  getReminderTemplates,
  updateReminderTemplate,
  createReminder,
  getReminders,
  getReminderById,
  updateReminderStatus,
  deleteReminder,
  previewReminderEmail,
  sendReminderNow
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
router.get("/:id/preview", previewReminderEmail);
router.post("/:id/send-now", sendReminderNow);
router.get("/:id", getReminderById);
router.patch("/:id/status", updateReminderStatus);
router.delete("/:id", deleteReminder);

export default router;
