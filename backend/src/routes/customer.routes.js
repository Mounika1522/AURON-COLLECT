
import express from "express";

import {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer
} from "../controllers/customer.controller.js";

import authMiddleware from "../middleware/auth.middleware.js";
import dashboardAccessMiddleware from "../middleware/dashboard-access.middleware.js";

const router = express.Router();

// All customer routes require login
router.use(authMiddleware);
router.use(dashboardAccessMiddleware);

// ADD CUSTOMER
router.post("/", createCustomer);

// GET ALL CUSTOMERS
router.get("/", getCustomers);

// GET SINGLE CUSTOMER
router.get("/:id", getCustomerById);

// UPDATE CUSTOMER
router.put("/:id", updateCustomer);

// DELETE CUSTOMER
router.delete("/:id", deleteCustomer);

export default router;
