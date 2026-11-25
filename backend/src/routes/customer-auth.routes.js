import express from "express";
import rateLimit from "express-rate-limit";
import {
  registerCustomer,
  loginCustomer,
  verifyCustomerEmail,
  resendCustomerVerification,
  requestCustomerPasswordReset,
  resetCustomerPassword,
  logoutCustomer
} from "../controllers/customer-auth.controller.js";
import customerAuthMiddleware from "../middleware/customer-auth.middleware.js";

const router = express.Router();
const customerAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  message: {
    success: false,
    message: "Too many account requests. Please wait before trying again."
  }
});

router.post("/register", customerAuthLimiter, registerCustomer);
router.post("/login", customerAuthLimiter, loginCustomer);
router.post("/verify-email", customerAuthLimiter, verifyCustomerEmail);
router.post("/resend-verification", customerAuthLimiter, resendCustomerVerification);
router.post("/password/forgot", customerAuthLimiter, requestCustomerPasswordReset);
router.post("/password/reset", customerAuthLimiter, resetCustomerPassword);
router.post("/logout", customerAuthMiddleware, logoutCustomer);

export default router;
