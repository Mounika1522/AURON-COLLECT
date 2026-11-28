import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import {
  approvePlanConfiguration,
  createSubscriptionPlan,
  getCurrentSubscription,
  getPlanConfigurations,
  getSubscriptionPlans,
  getSubscriptionUsage,
  updatePlanConfiguration
} from "../controllers/subscription.controller.js";
import {
  createSubscriptionOrder,
  disableOrganizationAutoRenew,
  downloadBillingInvoice,
  enableOrganizationAutoRenew,
  getBillingHistory,
  verifySubscriptionPayment
} from "../controllers/subscription-billing.controller.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/plans", getSubscriptionPlans);
router.get("/plans/configuration", getPlanConfigurations);
router.post("/plans", createSubscriptionPlan);
router.patch("/plans/:code/configuration", updatePlanConfiguration);
router.post("/plans/:code/approve", approvePlanConfiguration);

router.get("/current", getCurrentSubscription);
router.get("/usage", getSubscriptionUsage);
router.post("/orders", createSubscriptionOrder);
router.post("/orders/verify", verifySubscriptionPayment);
router.post("/:id/enable-auto-renew", enableOrganizationAutoRenew);
router.post("/:id/disable-auto-renew", disableOrganizationAutoRenew);
router.get("/billing/history", getBillingHistory);
router.get("/billing/invoices/:id/pdf", downloadBillingInvoice);

export default router;
