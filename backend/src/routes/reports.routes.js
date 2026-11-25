
import express from "express";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

import {
  getInvoiceReport,
  getCollectionReport,
  getOutstandingReport,
  getOverdueReport,
  getCustomerReport,
  getCreditAdjustmentReport,
  exportReport
} from "../controllers/reports.controller.js";

const router = express.Router();

// Protect all report APIs
router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

// Individual reports
router.get("/invoices", getInvoiceReport);
router.get("/collections", getCollectionReport);
router.get("/outstanding", getOutstandingReport);
router.get("/overdue", getOverdueReport);
router.get("/customers", getCustomerReport);
router.get("/credits", getCreditAdjustmentReport);

// CSV, Excel and PDF report exports
router.get("/export/:type", exportReport);

export default router;
