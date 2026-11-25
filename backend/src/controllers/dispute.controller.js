import prisma from "../config/prisma.js";
import { Prisma } from "@prisma/client";
import {
  buildCustomerDataWhere,
  buildDisputeDataWhere,
  buildInvoiceDataWhere,
} from "../services/dashboard-access.service.js";

// CREATE DISPUTE
export const createDispute = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const {
      disputeNumber,
      customerId,
      invoiceId,
      reason,
      description,
      disputedAmount,
      priority
    } = req.body;

    const organisationId = access.organisationId;

    if (!customerId || !invoiceId || !reason || !description) {
      return res.status(400).json({
        success: false,
        message: "customerId, invoiceId, reason and description are required"
      });
    }

    const customer = await prisma.customer.findFirst({
      where: buildCustomerDataWhere(access, { id: customerId })
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found"
      });
    }

    const invoice = await prisma.invoice.findFirst({
      where: buildInvoiceDataWhere(access, { id: invoiceId, customerId })
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found for this customer"
      });
    }

    let amount = null;

    if (disputedAmount !== undefined && disputedAmount !== null) {
      amount = new Prisma.Decimal(disputedAmount);

      if (!amount.isFinite() || amount.lte(0)) {
        return res.status(400).json({
          success: false,
          message: "disputedAmount must be greater than zero"
        });
      }

      if (amount.gt(invoice.total)) {
        return res.status(400).json({
          success: false,
          message: "Disputed amount cannot exceed invoice total"
        });
      }
    }

    const allowedPriorities = ["LOW", "MEDIUM", "HIGH"];

    const selectedPriority = priority || "MEDIUM";

    if (!allowedPriorities.includes(selectedPriority)) {
      return res.status(400).json({
        success: false,
        message: "Priority must be LOW, MEDIUM or HIGH"
      });
    }

    const dispute = await prisma.dispute.create({
      data: {
        disputeNumber: disputeNumber || null,
        customerId,
        invoiceId,
        reason,
        description,
        disputedAmount: amount,
        priority: selectedPriority,
        status: "OPEN",
        recordedBy: req.user.userId,
        organisationId
      },
      include: {
        customer: true,
        invoice: true
      }
    });

    return res.status(201).json({
      success: true,
      message: "Dispute created successfully",
      dispute
    });
  } catch (error) {
    console.error("Create dispute error:", error);

    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Dispute number already exists"
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create dispute"
    });
  }
};


// GET ALL DISPUTES
export const getDisputes = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const { status, customerId, invoiceId } = req.query;

    const disputes = await prisma.dispute.findMany({
      where: buildDisputeDataWhere(access, {
        ...(status && { status }),
        ...(customerId && { customerId }),
        ...(invoiceId && { invoiceId })
      }),
      include: {
        customer: true,
        invoice: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return res.status(200).json({
      success: true,
      count: disputes.length,
      disputes
    });
  } catch (error) {
    console.error("Get disputes error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch disputes"
    });
  }
};


// GET DISPUTE BY ID
export const getDisputeById = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const dispute = await prisma.dispute.findFirst({
      where: buildDisputeDataWhere(access, { id: req.params.id }),
      include: {
        customer: true,
        invoice: true
      }
    });

    if (!dispute) {
      return res.status(404).json({
        success: false,
        message: "Dispute not found"
      });
    }

    return res.status(200).json({
      success: true,
      dispute
    });
  } catch (error) {
    console.error("Get dispute error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch dispute"
    });
  }
};


// UPDATE DISPUTE DETAILS
export const updateDispute = async (req, res) => {
  try {
    const { reason, description, disputedAmount, priority } = req.body;
    const access = req.dashboardAccess;

    const existingDispute = await prisma.dispute.findFirst({
      where: buildDisputeDataWhere(access, { id: req.params.id })
    });

    if (!existingDispute) {
      return res.status(404).json({
        success: false,
        message: "Dispute not found"
      });
    }

    if (!["OPEN", "UNDER_REVIEW"].includes(existingDispute.status)) {
      return res.status(400).json({
        success: false,
        message: "Only OPEN or UNDER_REVIEW disputes can be edited"
      });
    }

    const data = {};

    if (reason !== undefined) {
      if (typeof reason !== "string" || !reason.trim()) {
        return res.status(400).json({
          success: false,
          message: "Reason cannot be empty"
        });
      }
      data.reason = reason.trim();
    }

    if (description !== undefined) {
      if (typeof description !== "string" || !description.trim()) {
        return res.status(400).json({
          success: false,
          message: "Description cannot be empty"
        });
      }
      data.description = description.trim();
    }

    if (disputedAmount !== undefined) {
      if (disputedAmount === null) {
        data.disputedAmount = null;
      } else {
        const amount = new Prisma.Decimal(disputedAmount);

        if (!amount.isFinite() || amount.lte(0)) {
          return res.status(400).json({
            success: false,
            message: "disputedAmount must be greater than zero"
          });
        }

        const invoice = await prisma.invoice.findFirst({
          where: buildInvoiceDataWhere(access, {
            id: existingDispute.invoiceId
          })
        });

        if (!invoice || amount.gt(invoice.total)) {
          return res.status(400).json({
            success: false,
            message: "Disputed amount cannot exceed invoice total"
          });
        }

        data.disputedAmount = amount;
      }
    }

    if (priority !== undefined) {
      if (!["LOW", "MEDIUM", "HIGH"].includes(priority)) {
        return res.status(400).json({
          success: false,
          message: "Priority must be LOW, MEDIUM or HIGH"
        });
      }
      data.priority = priority;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one field to update"
      });
    }

    const updatedDispute = await prisma.dispute.update({
      where: { id: existingDispute.id },
      data,
      include: {
        customer: true,
        invoice: true
      }
    });

    return res.status(200).json({
      success: true,
      message: "Dispute updated successfully",
      dispute: updatedDispute
    });
  } catch (error) {
    console.error("Update dispute error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update dispute"
    });
  }
};


// UPDATE DISPUTE STATUS
export const updateDisputeStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const access = req.dashboardAccess;

    const allowedStatuses = ["OPEN", "UNDER_REVIEW", "REJECTED"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be OPEN, UNDER_REVIEW or REJECTED. Use resolve endpoint to resolve a dispute."
      });
    }

    const existingDispute = await prisma.dispute.findFirst({
      where: buildDisputeDataWhere(access, { id: req.params.id })
    });

    if (!existingDispute) {
      return res.status(404).json({
        success: false,
        message: "Dispute not found"
      });
    }

    if (existingDispute.status === "RESOLVED") {
      return res.status(400).json({
        success: false,
        message: "Resolved disputes cannot be reopened or changed"
      });
    }

    const dispute = await prisma.dispute.update({
      where: { id: existingDispute.id },
      data: { status },
      include: {
        customer: true,
        invoice: true
      }
    });

    return res.status(200).json({
      success: true,
      message: "Dispute status updated successfully",
      dispute
    });
  } catch (error) {
    console.error("Update dispute status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update dispute status"
    });
  }
};


// RESOLVE DISPUTE
export const resolveDispute = async (req, res) => {
  try {
    const { resolution } = req.body;
    const access = req.dashboardAccess;

    if (!resolution || typeof resolution !== "string" || !resolution.trim()) {
      return res.status(400).json({
        success: false,
        message: "Resolution details are required"
      });
    }

    const existingDispute = await prisma.dispute.findFirst({
      where: buildDisputeDataWhere(access, { id: req.params.id })
    });

    if (!existingDispute) {
      return res.status(404).json({
        success: false,
        message: "Dispute not found"
      });
    }

    if (existingDispute.status === "RESOLVED") {
      return res.status(400).json({
        success: false,
        message: "Dispute is already resolved"
      });
    }

    const dispute = await prisma.dispute.update({
      where: { id: existingDispute.id },
      data: {
        status: "RESOLVED",
        resolution: resolution.trim(),
        resolvedAt: new Date()
      },
      include: {
        customer: true,
        invoice: true
      }
    });

    return res.status(200).json({
      success: true,
      message: "Dispute resolved successfully",
      dispute
    });
  } catch (error) {
    console.error("Resolve dispute error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to resolve dispute"
    });
  }
};