import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";
import {
  getAdminNotifications,
  getAutomatedEmailReminderHistory,
  markAdminNotificationRead,
} from "../controllers/admin-notification.controller.js";

const router = express.Router();

router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

router.get("/", getAdminNotifications);
router.get("/recent-email-reminders", getAutomatedEmailReminderHistory);
router.patch("/:sourceKey/read", markAdminNotificationRead);

export default router;
