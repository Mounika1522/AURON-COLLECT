
import express from "express";
import {
  verifyEmailConnection,
  sendTestEmail
} from "../services/email.service.js";
import { isAllowedTestEmailRecipient } from "../config/runtime-safety.js";
import authMiddleware from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(authMiddleware, (req, res, next) => {
  if (!["ADMIN", "OWNER"].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Only administrators can access email testing."
    });
  }
  next();
});

export const getTestEmailRecipient = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid test email request.");
  }

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "to") {
    throw new Error("Only one test email recipient is allowed.");
  }

  if (!isAllowedTestEmailRecipient(body.to)) {
    throw new Error("Recipient is not allowlisted for test email.");
  }

  return body.to;
};

// Verify SMTP connection
router.get("/verify", async (req, res) => {
  try {
    await verifyEmailConnection();

    res.json({
      success: true,
      message: "Email SMTP connection successful"
    });
  } catch (error) {
    console.error("SMTP verification failed:", error.message);

    res.status(500).json({
      success: false,
      message: "Email SMTP connection failed. Check email configuration."
    });
  }
});

// Send test email
router.post("/send", async (req, res) => {
  let to;
  try {
    to = getTestEmailRecipient(req.body);
  } catch {
    return res.status(400).json({
      success: false,
      message: "Only one approved test email recipient is allowed."
    });
  }

  try {
    await sendTestEmail(to);
    res.json({
      success: true,
      message: "The SMTP server accepted the test message; delivery is not confirmed."
    });
  } catch (error) {
    console.error("Test email failed:", error.message);

    res.status(500).json({
      success: false,
      message: "Test email could not be sent. Check SMTP configuration."
    });
  }
});

export default router;
