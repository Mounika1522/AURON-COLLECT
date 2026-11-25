import prisma from "../config/prisma.js";
import { Prisma } from "@prisma/client";
import {
  buildInvoiceDataWhere,
  buildPromiseDataWhere,
  buildReceiptAllocationDataWhere,
  buildCreditAdjustmentDataWhere,
  buildTaskDataWhere,
} from "../services/dashboard-access.service.js";

// Helper: calculate the invoice's current outstanding amount
const getInvoiceOutstanding = async (invoiceId, access) => {
  const invoice = await prisma.invoice.findFirst({
    where: buildInvoiceDataWhere(access, { id: invoiceId }),
    include: {
      allocations: {
        where: buildReceiptAllocationDataWhere(access, {
          status: "POSTED",
          reversedAt: null,
          receipt: {
            status: "POSTED"
          }
        }),
        select: {
          amount: true
        }
      },
      creditAdjustments: {
        where: buildCreditAdjustmentDataWhere(access, {
          status: "APPROVED"
        }),
        select: {
          amount: true
        }
      }
    }
  });

  if (!invoice) return null;

  const paidAmount = invoice.allocations.reduce(
    (total, allocation) => total.plus(allocation.amount),
    new Prisma.Decimal(0)
  );

  const adjustmentAmount = invoice.creditAdjustments.reduce(
    (total, adjustment) => total.plus(adjustment.amount),
    new Prisma.Decimal(0)
  );

  return new Prisma.Decimal(invoice.total)
    .minus(paidAmount)
    .minus(adjustmentAmount);
};

// 1. CREATE PROMISE
export const createPromise = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const {
      customerId,
      invoiceId,
      promisedAmount,
      promisedDate,
      taskId,
      notes
    } = req.body;

    const organisationId = access.organisationId;

    if (!customerId || !invoiceId || !promisedAmount || !promisedDate) {
      return res.status(400).json({
        success: false,
        message: "Customer, invoice, amount and promised date are required"
      });
    }

    const amount = new Prisma.Decimal(promisedAmount);

    if (!amount.isFinite() || amount.lte(0)) {
      return res.status(400).json({
        success: false,
        message: "Promised amount must be greater than zero"
      });
    }

    const date = new Date(promisedDate);

    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid promised date"
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

    if (taskId) {
      const task = await prisma.task.findFirst({
        where: buildTaskDataWhere(access, {
          id: taskId,
          customerId,
          invoiceId
        })
      });

      if (!task) {
        return res.status(400).json({
          success: false,
          message: "Task does not match this customer and invoice"
        });
      }
    }

    const outstanding = await getInvoiceOutstanding(invoiceId, access);

    if (outstanding === null || amount.gt(outstanding)) {
      return res.status(400).json({
        success: false,
        message: "Promised amount cannot exceed invoice outstanding",
        outstandingAmount: outstanding?.toString() ?? "0"
      });
    }

    const promise = await prisma.promiseToPay.create({
      data: {
        promisedAmount: amount,
        promisedDate: date,
        status: "PROMISED",
        notes: notes || null,
        recordedBy: req.user.userId,
        organisationId,
        customerId,
        invoiceId,
        taskId: taskId || null
      },
      include: {
        customer: true,
        invoice: true,
        task: true
      }
    });

    return res.status(201).json({
      success: true,
      message: "Promise-to-Pay created successfully",
      promise
    });

  } catch (error) {
    console.error("Create promise error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create Promise-to-Pay"
    });
  }
};

// 2. GET ALL PROMISES
export const getPromises = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const { status, customerId, invoiceId } = req.query;

    const promises = await prisma.promiseToPay.findMany({
      where: buildPromiseDataWhere(access, {
        ...(status && { status }),
        ...(customerId && { customerId }),
        ...(invoiceId && { invoiceId })
      }),
      include: {
        customer: true,
        invoice: true,
        task: true
      },
      orderBy: {
        promisedDate: "asc"
      }
    });

    return res.json({
      success: true,
      count: promises.length,
      promises
    });

  } catch (error) {
    console.error("Get promises error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch promises"
    });
  }
};

// 3. GET PROMISE BY ID
export const getPromiseById = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const promise = await prisma.promiseToPay.findFirst({
      where: buildPromiseDataWhere(access, { id: req.params.id }),
      include: {
        customer: true,
        invoice: true,
        task: true
      }
    });

    if (!promise) {
      return res.status(404).json({
        success: false,
        message: "Promise not found"
      });
    }

    return res.json({
      success: true,
      promise
    });

  } catch (error) {
    console.error("Get promise error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch promise"
    });
  }
};

// 4. UPDATE PROMISE DETAILS
export const updatePromise = async (req, res) => {
  try {
    const { promisedAmount, promisedDate, notes } = req.body;
    const access = req.dashboardAccess;

    const existingPromise = await prisma.promiseToPay.findFirst({
      where: buildPromiseDataWhere(access, { id: req.params.id })
    });

    if (!existingPromise) {
      return res.status(404).json({
        success: false,
        message: "Promise not found"
      });
    }

    if (existingPromise.status !== "PROMISED") {
      return res.status(400).json({
        success: false,
        message: "Only active promises can be edited"
      });
    }

    const data = {};

    if (promisedAmount !== undefined) {
      const amount = new Prisma.Decimal(promisedAmount);

      if (!amount.isFinite() || amount.lte(0)) {
        return res.status(400).json({
          success: false,
          message: "Promised amount must be greater than zero"
        });
      }

      const outstanding = await getInvoiceOutstanding(
        existingPromise.invoiceId,
        access
      );

      if (outstanding === null || amount.gt(outstanding)) {
        return res.status(400).json({
          success: false,
          message: "Promised amount cannot exceed invoice outstanding"
        });
      }

      data.promisedAmount = amount;
    }

    if (promisedDate !== undefined) {
      const date = new Date(promisedDate);

      if (Number.isNaN(date.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid promised date"
        });
      }

      data.promisedDate = date;
    }

    if (notes !== undefined) {
      data.notes = notes;
    }

    const updatedPromise = await prisma.promiseToPay.update({
      where: {
        id: existingPromise.id
      },
      data,
      include: {
        customer: true,
        invoice: true,
        task: true
      }
    });

    return res.json({
      success: true,
      message: "Promise updated successfully",
      promise: updatedPromise
    });

  } catch (error) {
    console.error("Update promise error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update promise"
    });
  }
};

// 5. UPDATE PROMISE STATUS
export const updatePromiseStatus = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const { status } = req.body;
    const allowedStatuses = [
      "PROMISED",
      "KEPT",
      "BROKEN",
      "CANCELLED"
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid promise status"
      });
    }

    const existingPromise = await prisma.promiseToPay.findFirst({
      where: buildPromiseDataWhere(access, { id: req.params.id })
    });

    if (!existingPromise) {
      return res.status(404).json({
        success: false,
        message: "Promise not found"
      });
    }

    const updatedPromise = await prisma.promiseToPay.update({
      where: {
        id: existingPromise.id
      },
      data: {
        status
      }
    });

    return res.json({
      success: true,
      message: "Promise status updated successfully",
      promise: updatedPromise
    });

  } catch (error) {
    console.error("Update promise status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update promise status"
    });
  }
};