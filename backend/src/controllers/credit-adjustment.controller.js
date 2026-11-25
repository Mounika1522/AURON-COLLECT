
import prisma from "../config/prisma.js";
import { Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { refreshInvoiceReminders } from "../services/reminder.service.js";
import {
  buildCreditAdjustmentDataWhere,
  buildInvoiceDataWhere,
} from "../services/dashboard-access.service.js";

// ==========================================
// CALCULATE INVOICE OUTSTANDING
// ==========================================

const getOutstanding = async (tx, invoiceId, organisationId) => {
  const invoice = await tx.invoice.findFirst({
    where: {
      id: invoiceId,
      organisationId
    },
    include: {
      allocations: {
        where: {
          status: "POSTED",
          reversedAt: null,
          organisationId,
          receipt: {
            status: "POSTED"
          }
        }
      },
      creditAdjustments: {
        where: {
          status: "APPROVED",
          organisationId
        }
      }
    }
  });

  if (!invoice) {
    throw new Error("Invoice not found");
  }

  const paid = invoice.allocations.reduce(
    (sum, item) => sum.plus(item.amount),
    new Prisma.Decimal(0)
  );

  const adjusted = invoice.creditAdjustments.reduce(
    (sum, item) => sum.plus(item.amount),
    new Prisma.Decimal(0)
  );

  return new Prisma.Decimal(invoice.total)
    .minus(paid)
    .minus(adjusted);
};

// ==========================================
// CREATE CREDIT ADJUSTMENT
// ==========================================

export const createCreditAdjustment = async (req, res) => {
  try {
    const { invoiceId, amount, reason, notes } = req.body;
    const access = req.dashboardAccess;
    const organisationId = access.organisationId;

    if (
      !invoiceId ||
      amount === undefined ||
      amount === null ||
      amount === "" ||
      typeof reason !== "string" ||
      !reason.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID, amount and reason are required"
      });
    }

    let adjustmentAmount;

    try {
      adjustmentAmount = new Prisma.Decimal(amount);
    } catch {
      return res.status(400).json({
        success: false,
        message: "Invalid adjustment amount"
      });
    }

    if (
      !adjustmentAmount.isFinite() ||
      adjustmentAmount.lte(0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than zero"
      });
    }

    const invoice = await prisma.invoice.findFirst({
      where: buildInvoiceDataWhere(access, {
        id: invoiceId,
        status: {
          notIn: ["DRAFT", "CANCELLED", "WRITTEN_OFF"]
        }
      })
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found or cannot be adjusted"
      });
    }

    const adjustment = await prisma.creditAdjustment.create({
      data: {
        adjustmentNumber: `CA-${crypto.randomUUID()}`,
        amount: adjustmentAmount,
        reason: reason.trim(),
        notes: notes?.trim() || null,
        status: "PENDING",
        createdBy: req.user.userId,
        invoiceId,
        organisationId
      }
    });

    return res.status(201).json({
      success: true,
      message: "Credit adjustment created successfully",
      adjustment
    });

  } catch (error) {
    console.error("Create credit adjustment error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create credit adjustment"
    });
  }
};

// ==========================================
// GET ALL CREDIT ADJUSTMENTS
// ==========================================

export const getCreditAdjustments = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const adjustments = await prisma.creditAdjustment.findMany({
      where: buildCreditAdjustmentDataWhere(access),
      include: {
        invoice: {
          select: {
            invoiceNumber: true,
            total: true,
            currency: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return res.status(200).json({
      success: true,
      count: adjustments.length,
      adjustments
    });

  } catch (error) {
    console.error("Get credit adjustments error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch credit adjustments"
    });
  }
};

// ==========================================
// GET SINGLE CREDIT ADJUSTMENT
// ==========================================

export const getCreditAdjustmentById = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const adjustment = await prisma.creditAdjustment.findFirst({
      where: buildCreditAdjustmentDataWhere(access, {
        id: req.params.id
      }),
      include: {
        invoice: true
      }
    });

    if (!adjustment) {
      return res.status(404).json({
        success: false,
        message: "Credit adjustment not found"
      });
    }

    return res.status(200).json({
      success: true,
      adjustment
    });

  } catch (error) {
    console.error("Get credit adjustment error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch credit adjustment"
    });
  }
};

// ==========================================
// APPROVE CREDIT ADJUSTMENT
// ==========================================

export const approveCreditAdjustment = async (req, res) => {
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: "Only ADMIN can approve credit adjustments"
    });
  }

  try {
    const access = req.dashboardAccess;
    const organisationId = access.organisationId;

    const result = await prisma.$transaction(
      async (tx) => {
        const adjustment = await tx.creditAdjustment.findFirst({
          where: buildCreditAdjustmentDataWhere(access, {
            id: req.params.id,
            status: "PENDING"
          })
        });

        if (!adjustment) {
          throw new Error("Pending credit adjustment not found");
        }

        const outstanding = await getOutstanding(
          tx,
          adjustment.invoiceId,
          organisationId
        );

        if (adjustment.amount.gt(outstanding)) {
          throw new Error(
            "Adjustment amount exceeds invoice outstanding balance"
          );
        }

        const updated = await tx.creditAdjustment.updateMany({
          where: {
            id: adjustment.id,
            organisationId,
            status: "PENDING"
          },
          data: {
            status: "APPROVED",
            approvedBy: req.user.userId,
            approvedAt: new Date()
          }
        });

        if (updated.count !== 1) {
          throw new Error("Adjustment was already processed");
        }

        return tx.creditAdjustment.findUnique({
          where: {
            id: adjustment.id
          }
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      }
    );

    // Refresh invoice reminders after successful approval.
    // Reminder failure should not undo the approved adjustment.
    try {
      await refreshInvoiceReminders(
        prisma,
        result.invoiceId,
        organisationId
      );
    } catch (reminderError) {
      console.error(
        "Reminder refresh after credit adjustment approval failed:",
        reminderError
      );
    }

    return res.status(200).json({
      success: true,
      message: "Credit adjustment approved successfully",
      adjustment: result
    });

  } catch (error) {
    console.error("Approve credit adjustment error:", error);

    const status = error.message.includes("not found")
      ? 404
      : error.message.includes("exceeds")
        ? 400
        : error.message.includes("already processed")
          ? 409
          : 500;

    return res.status(status).json({
      success: false,
      message: error.message || "Failed to approve adjustment"
    });
  }
};

// ==========================================
// REJECT CREDIT ADJUSTMENT
// ==========================================

export const rejectCreditAdjustment = async (req, res) => {
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: "Only ADMIN can reject credit adjustments"
    });
  }

  try {
    const { rejectionReason } = req.body;

    if (
      typeof rejectionReason !== "string" ||
      !rejectionReason.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required"
      });
    }

    const access = req.dashboardAccess;

    const updated = await prisma.creditAdjustment.updateMany({
      where: buildCreditAdjustmentDataWhere(access, {
        id: req.params.id,
        status: "PENDING"
      }),
      data: {
        status: "REJECTED",
        rejectedBy: req.user.userId,
        rejectedAt: new Date(),
        rejectionReason: rejectionReason.trim()
      }
    });

    if (updated.count !== 1) {
      return res.status(404).json({
        success: false,
        message: "Pending credit adjustment not found"
      });
    }

    const adjustment = await prisma.creditAdjustment.findFirst({
      where: buildCreditAdjustmentDataWhere(access, {
        id: req.params.id,
      }),
    });

    return res.status(200).json({
      success: true,
      message: "Credit adjustment rejected successfully",
      adjustment
    });

  } catch (error) {
    console.error("Reject credit adjustment error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to reject credit adjustment"
    });
  }
};
