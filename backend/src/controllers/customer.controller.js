
import prisma from "../config/prisma.js";
import {
  assertSubscriptionCapacity,
  SubscriptionLimitError
} from "../services/subscription-limits.service.js";
import {
  buildCustomerDataWhere,
} from "../services/dashboard-access.service.js";

const ALLOWED_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

// ADD CUSTOMER
export const createCustomer = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const {
      customerCode,
      name,
      type,
      contactPerson,
      email,
      phone,
      billingAddress,
      shippingAddress,
      taxRegistration,
      paymentTerms,
      creditLimit,
      status,
      riskLevel,
      notes
    } = req.body;

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Customer name is required"
      });
    }

    if (
      creditLimit !== undefined &&
      creditLimit !== null &&
      (!Number.isFinite(Number(creditLimit)) ||
        Number(creditLimit) < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Credit limit must be a valid non-negative number"
      });
    }

    const selectedRiskLevel = riskLevel ?? "LOW";

    if (!ALLOWED_RISK_LEVELS.includes(selectedRiskLevel)) {
      return res.status(400).json({
        success: false,
        message: "Invalid risk level. Allowed: LOW, MEDIUM, HIGH, CRITICAL"
      });
    }

    const customer = await prisma.$transaction(async (tx) => {
      await assertSubscriptionCapacity(
        tx,
        req.user.organisationId,
        "customers"
      );
      return tx.customer.create({
        data: {
          customerCode,
          name: name.trim(),
          type,
          contactPerson,
          email,
          phone,
          billingAddress,
          shippingAddress,
          taxRegistration,
          paymentTerms,
          creditLimit:
            creditLimit !== undefined && creditLimit !== null
              ? creditLimit
              : undefined,
          status,
          riskLevel: selectedRiskLevel,
          notes,
          organisationId: access.organisationId
        }
      });
    }, { isolationLevel: "Serializable" });

    return res.status(201).json({
      success: true,
      message: "Customer created successfully",
      customer
    });

  } catch (error) {
    if (error instanceof SubscriptionLimitError) {
      return res.status(409).json({
        success: false,
        code: error.code,
        message: error.message,
        limit: error.limit
      });
    }

    if (error.code === "P2034") {
      return res.status(409).json({
        success: false,
        message: "Customer creation conflicted with another update. Please retry."
      });
    }

    console.error("Create customer error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create customer"
    });
  }
};

// GET ALL CUSTOMERS
export const getCustomers = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const customers = await prisma.customer.findMany({
      where: buildCustomerDataWhere(access),
      orderBy: {
        createdAt: "desc"
      }
    });

    return res.json({
      success: true,
      count: customers.length,
      customers
    });

  } catch (error) {
    console.error("Get customers error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch customers"
    });
  }
};

// GET SINGLE CUSTOMER
export const getCustomerById = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const customer = await prisma.customer.findFirst({
      where: buildCustomerDataWhere(access, { id: req.params.id })
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found"
      });
    }

    return res.json({
      success: true,
      customer
    });

  } catch (error) {
    console.error("Get customer error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer"
    });
  }
};

// UPDATE CUSTOMER
export const updateCustomer = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const allowedFields = [
      "customerCode",
      "name",
      "type",
      "contactPerson",
      "email",
      "phone",
      "billingAddress",
      "shippingAddress",
      "taxRegistration",
      "paymentTerms",
      "creditLimit",
      "status",
      "riskLevel",
      "notes"
    ];

    const data = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        data[field] = req.body[field];
      }
    }

    if (data.name !== undefined) {
      if (typeof data.name !== "string" || !data.name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Customer name cannot be empty"
        });
      }

      data.name = data.name.trim();
    }

    if (
      data.creditLimit !== undefined &&
      data.creditLimit !== null &&
      (!Number.isFinite(Number(data.creditLimit)) ||
        Number(data.creditLimit) < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Credit limit must be a valid non-negative number"
      });
    }

    if (
      data.riskLevel !== undefined &&
      !ALLOWED_RISK_LEVELS.includes(data.riskLevel)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid risk level. Allowed: LOW, MEDIUM, HIGH, CRITICAL"
      });
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one field is required to update"
      });
    }

    const result = await prisma.customer.updateMany({
      where: buildCustomerDataWhere(access, { id: req.params.id }),
      data
    });

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found"
      });
    }

    const customer = await prisma.customer.findFirst({
      where: buildCustomerDataWhere(access, { id: req.params.id })
    });

    return res.json({
      success: true,
      message: "Customer updated successfully",
      customer
    });

  } catch (error) {
    console.error("Update customer error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update customer"
    });
  }
};

// DELETE CUSTOMER
export const deleteCustomer = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const result = await prisma.customer.deleteMany({
      where: buildCustomerDataWhere(access, { id: req.params.id })
    });

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found"
      });
    }

    return res.json({
      success: true,
      message: "Customer deleted successfully"
    });

  } catch (error) {
    console.error("Delete customer error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete customer"
    });
  }
};
