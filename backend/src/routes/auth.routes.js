
import express from "express";
import rateLimit from "express-rate-limit";
import { changePassword, register, login } from "../controllers/auth.controller.js";
import {
  forgotStaffPassword,
  resetStaffPassword
} from "../controllers/staff-password-reset.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";

const router = express.Router();
const authRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication requests. Please wait before trying again."
  }
});
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password change attempts. Please wait before trying again."
  }
});
const passwordRecoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password recovery attempts. Please wait before trying again."
  }
});

router.post("/register", authRequestLimiter, register);
router.post("/login", authRequestLimiter, login);
router.post("/change-password", authMiddleware, passwordChangeLimiter, changePassword);
router.post("/password/forgot", passwordRecoveryLimiter, forgotStaffPassword);
router.post("/password/reset", passwordRecoveryLimiter, resetStaffPassword);

export default router;
