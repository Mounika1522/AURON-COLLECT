import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import {
  approveCustomerSubscriptionPlanPricing,
  approveCustomerSubscriptionPlanTax,
  createCustomerSubscriptionPlan,
  getCustomerSubscriptionPlanManagement,
  requireCustomerPlanManager,
  updateCustomerSubscriptionPlan
} from "../controllers/customer-subscription-plan.controller.js";

const router = express.Router();

router.use(authMiddleware, requireCustomerPlanManager);
router.get("/", getCustomerSubscriptionPlanManagement);
router.post("/", createCustomerSubscriptionPlan);
router.patch("/:planId", updateCustomerSubscriptionPlan);
router.post("/:planId/approvals/pricing", approveCustomerSubscriptionPlanPricing);
router.post("/:planId/approvals/tax", approveCustomerSubscriptionPlanTax);

export default router;
