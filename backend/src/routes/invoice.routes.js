import express from "express";

import {
  createInvoice,
  getInvoices,
  getInvoiceById,
  updateInvoice,
  deleteInvoice
} from "../controllers/invoice.controller.js";
import uploadInvoiceFile from "../middleware/upload.middleware.js";

import {
  previewInvoiceImport,
  confirmInvoiceImport
} from "../controllers/invoice-import.controller.js";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

const router = express.Router();

router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

router.post("/", createInvoice);
router.post(
  "/import/preview",
  uploadInvoiceFile.single("file"),
  previewInvoiceImport
);

router.post(
  "/import/confirm",
  uploadInvoiceFile.single("file"),
  confirmInvoiceImport
);
router.get("/", getInvoices);
router.get("/:id", getInvoiceById);
router.put("/:id", updateInvoice);
router.delete("/:id", deleteInvoice);

export default router;