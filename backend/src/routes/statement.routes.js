import express from "express";

import {
  generateCustomerStatement,
  downloadCustomerStatementPdf
} from "../controllers/statement.controller.js";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

const router = express.Router();

router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

router.get("/:customerId/pdf", downloadCustomerStatementPdf);
router.get("/:customerId", generateCustomerStatement);

export default router;