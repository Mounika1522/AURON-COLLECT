import express from "express";

import {
  createReceipt,
  getReceipts,
  downloadReceiptPdf,
  getCustomerSubscriptionReceipts,
  downloadCustomerSubscriptionReceiptPdf,
  verifyCustomerSubscriptionReceipt,
  allocateReceipt,
  reverseAllocation
} from "../controllers/receipt.controller.js";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

const router = express.Router();

router.get("/verify/:token", verifyCustomerSubscriptionReceipt);
router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

router.post("/", createReceipt);
router.get("/", getReceipts);
router.get("/customer-subscriptions", getCustomerSubscriptionReceipts);
router.get(
  "/customer-subscriptions/:receiptId/pdf",
  downloadCustomerSubscriptionReceiptPdf
);
router.get("/:receiptId/pdf", downloadReceiptPdf);
router.post("/allocate", allocateReceipt);
router.post("/allocations/:allocationId/reverse", reverseAllocation);

export default router;