
import { syncInvoiceReminders } from "../services/reminder.service.js";
import { notifyCustomerInvoice } from "../services/customer-portal-notification.service.js";
import prisma from "../config/prisma.js";
import { Prisma } from "@prisma/client";
import {
  assertSubscriptionCapacity,
  SubscriptionLimitError
} from "../services/subscription-limits.service.js";
import {
  buildInvoiceDataWhere,
} from "../services/dashboard-access.service.js";

// Helper: safely convert values into Prisma Decimal
const toDecimal = (value) => {
  try {
    const amount = new Prisma.Decimal(value);
    return amount.isFinite() ? amount : null;
  } catch {
    return null;
  }
};

// CREATE INVOICE
export const createInvoice = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const {
      invoiceNumber,
      customerId,
      invoiceDate,
      dueDate,
      currency,
      subtotal,
      tax,
      discount,
      assignedExecutive,
      salesperson,
      status,
      documentUrl,
      notes
    } = req.body;

    if (
      typeof invoiceNumber !== "string" ||
      !invoiceNumber.trim() ||
      !customerId ||
      !invoiceDate ||
      !dueDate ||
      subtotal === undefined ||
      subtotal === null
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required invoice details"
      });
    }

    const invoiceDateValue = new Date(invoiceDate);
    const dueDateValue = new Date(dueDate);

    if (
      Number.isNaN(invoiceDateValue.getTime()) ||
      Number.isNaN(dueDateValue.getTime())
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid invoice dates"
      });
    }

    if (dueDateValue < invoiceDateValue) {
      return res.status(400).json({
        success: false,
        message: "Due date cannot be before invoice date"
      });
    }

    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        organisationId: access.organisationId
      }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found"
      });
    }

    const subtotalAmount = toDecimal(subtotal);
    const taxAmount = toDecimal(tax ?? 0);
    const discountAmount = toDecimal(discount ?? 0);

    if (
      !subtotalAmount ||
      !taxAmount ||
      !discountAmount ||
      subtotalAmount.isNegative() ||
      taxAmount.isNegative() ||
      discountAmount.isNegative()
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid invoice amounts"
      });
    }

    const grossAmount = subtotalAmount.plus(taxAmount);

    if (discountAmount.greaterThan(grossAmount)) {
      return res.status(400).json({
        success: false,
        message: "Discount cannot exceed subtotal plus tax"
      });
    }

    const total = grossAmount.minus(discountAmount);

    const invoice = await prisma.$transaction(async (tx) => {
      await assertSubscriptionCapacity(
        tx,
        access.organisationId,
        "invoices"
      );
      return tx.invoice.create({
        data: {
          invoiceNumber: invoiceNumber.trim(),
          invoiceDate: invoiceDateValue,
          dueDate: dueDateValue,
          currency: currency || "INR",
          subtotal: subtotalAmount,
          tax: taxAmount,
          discount: discountAmount,
          total,
          assignedExecutive: access.assignedExecutive || assignedExecutive,
          salesperson,
          status: status || "DRAFT",
          documentUrl,
          notes,
          customerId,
          organisationId: access.organisationId
        }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // Schedule automatic reminders
    try {
      await syncInvoiceReminders(prisma, invoice);
    } catch (reminderError) {
      console.error("Invoice reminder scheduling failed:", reminderError);
    }

    let notification = null;
    if (!["DRAFT", "CANCELLED", "WRITTEN_OFF"].includes(invoice.status)) {
      try {
        notification = await notifyCustomerInvoice(invoice, "INVOICE_GENERATED");
      } catch (notificationError) {
        console.error(
          "Invoice customer notification failed:",
          notificationError.code || notificationError.name
        );
      }
    }

    return res.status(201).json({
      success: true,
      message: "Invoice created successfully",
      emailStatus: notification?.emailStatus || "NOT_APPLICABLE",
      invoice
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
        message: "Invoice creation conflicted with another update. Please retry."
      });
    }

    console.error("Create Invoice Error:", error);

    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Invoice number already exists"
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create invoice"
    });
  }
};


// GET ALL INVOICES
export const getInvoices = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const invoices = await prisma.invoice.findMany({
      where: buildInvoiceDataWhere(access),
      include: {
        customer: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return res.status(200).json({
      success: true,
      count: invoices.length,
      invoices
    });

  } catch (error) {
    console.error("Get Invoices Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch invoices"
    });
  }
};


// GET SINGLE INVOICE
export const getInvoiceById = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const invoice = await prisma.invoice.findFirst({
      where: buildInvoiceDataWhere(access, { id: req.params.id }),
      include: {
        customer: true
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found"
      });
    }

    return res.status(200).json({
      success: true,
      invoice
    });

  } catch (error) {
    console.error("Get Invoice Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch invoice"
    });
  }
};


// UPDATE INVOICE
export const updateInvoice = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    if (
      access.assignedExecutive &&
      req.body.assignedExecutive !== undefined &&
      req.body.assignedExecutive !== access.assignedExecutive
    ) {
      return res.status(403).json({
        success: false,
        message: "You cannot reassign an invoice to another executive"
      });
    }

    const allowedFields = [
      "invoiceNumber",
      "invoiceDate",
      "dueDate",
      "currency",
      "subtotal",
      "tax",
      "discount",
      "assignedExecutive",
      "salesperson",
      "status",
      "documentUrl",
      "notes"
    ];

    const data = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        data[field] = req.body[field];
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide at least one field to update"
      });
    }

    if (data.invoiceNumber !== undefined) {
      if (
        typeof data.invoiceNumber !== "string" ||
        !data.invoiceNumber.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Invoice number cannot be empty"
        });
      }

      data.invoiceNumber = data.invoiceNumber.trim();
    }

    if (
      data.currency !== undefined &&
      (typeof data.currency !== "string" || !data.currency.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid currency"
      });
    }

    for (const field of ["invoiceDate", "dueDate"]) {
      if (data[field] !== undefined) {
        const date = new Date(data[field]);

        if (Number.isNaN(date.getTime())) {
          return res.status(400).json({
            success: false,
            message: `Invalid ${field}`
          });
        }

        data[field] = date;
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const existingInvoice = await tx.invoice.findFirst({
        where: buildInvoiceDataWhere(access, { id: req.params.id })
      });

      if (!existingInvoice) {
        return { error: "NOT_FOUND" };
      }

      const financialFields = [
        "invoiceDate",
        "dueDate",
        "currency",
        "subtotal",
        "tax",
        "discount"
      ];

      const financialChange = financialFields.some(
        (field) => data[field] !== undefined
      );

      if (financialChange) {
        const activeAllocation = await tx.receiptAllocation.findFirst({
          where: {
            invoiceId: existingInvoice.id,
            organisationId: req.user.organisationId,
            status: "POSTED",
            reversedAt: null
          }
        });

        if (activeAllocation) {
          return { error: "PAYMENT_ALLOCATED" };
        }

        const approvedAdjustment = await tx.creditAdjustment.findFirst({
          where: {
            invoiceId: existingInvoice.id,
            organisationId: req.user.organisationId,
            status: "APPROVED"
          }
        });

        if (approvedAdjustment) {
          return { error: "APPROVED_ADJUSTMENT" };
        }
      }

      const finalInvoiceDate =
        data.invoiceDate ?? existingInvoice.invoiceDate;

      const finalDueDate =
        data.dueDate ?? existingInvoice.dueDate;

      if (finalDueDate < finalInvoiceDate) {
        return { error: "INVALID_DATES" };
      }

      const subtotal = toDecimal(
        data.subtotal ?? existingInvoice.subtotal
      );

      const tax = toDecimal(
        data.tax ?? existingInvoice.tax
      );

      const discount = toDecimal(
        data.discount ?? existingInvoice.discount
      );

      if (
        !subtotal ||
        !tax ||
        !discount ||
        subtotal.isNegative() ||
        tax.isNegative() ||
        discount.isNegative()
      ) {
        return { error: "INVALID_AMOUNTS" };
      }

      const grossAmount = subtotal.plus(tax);

      if (discount.greaterThan(grossAmount)) {
        return { error: "INVALID_DISCOUNT" };
      }

      if (
        data.subtotal !== undefined ||
        data.tax !== undefined ||
        data.discount !== undefined
      ) {
        data.total = grossAmount.minus(discount);
      }

      const updatedInvoice = await tx.invoice.update({
        where: {
          id: existingInvoice.id
        },
        data,
        include: {
          customer: true
        }
      });

      // Refresh reminders using the same database transaction
      try {
        await syncInvoiceReminders(tx, updatedInvoice);
      } catch (reminderError) {
        console.error(
          "Invoice reminder update failed:",
          reminderError
        );
        throw reminderError;
      }

      return {
        invoice: updatedInvoice,
        previousStatus: existingInvoice.status
      };
    });

    if (result.error === "NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Invoice not found"
      });
    }

    if (result.error === "PAYMENT_ALLOCATED") {
      return res.status(409).json({
        success: false,
        message:
          "Financial details cannot be changed because this invoice has an active posted receipt allocation"
      });
    }

    if (result.error === "APPROVED_ADJUSTMENT") {
      return res.status(409).json({
        success: false,
        message:
          "Financial details cannot be changed because this invoice has an approved credit adjustment"
      });
    }

    if (result.error === "INVALID_DATES") {
      return res.status(400).json({
        success: false,
        message: "Due date cannot be before invoice date"
      });
    }

    if (result.error === "INVALID_AMOUNTS") {
      return res.status(400).json({
        success: false,
        message: "Please provide valid invoice amounts"
      });
    }

    if (result.error === "INVALID_DISCOUNT") {
      return res.status(400).json({
        success: false,
        message: "Discount cannot exceed subtotal plus tax"
      });
    }

    let notification = null;
    if (!["DRAFT", "CANCELLED", "WRITTEN_OFF"].includes(result.invoice.status)) {
      const eventType =
        result.previousStatus === "DRAFT"
          ? "INVOICE_GENERATED"
          : "INVOICE_UPDATED";
      try {
        notification = await notifyCustomerInvoice(result.invoice, eventType);
      } catch (notificationError) {
        console.error(
          "Invoice customer notification failed:",
          notificationError.code || notificationError.name
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: "Invoice updated successfully",
      emailStatus: notification?.emailStatus || "NOT_APPLICABLE",
      invoice: result.invoice
    });

  } catch (error) {
    console.error("Update Invoice Error:", error);

    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Invoice number already exists"
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update invoice"
    });
  }
};


// DELETE INVOICE
export const deleteInvoice = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: buildInvoiceDataWhere(access, { id: req.params.id })
      });

      if (!invoice) {
        return { error: "NOT_FOUND" };
      }

      const allocation = await tx.receiptAllocation.findFirst({
        where: {
          invoiceId: invoice.id,
          organisationId: req.user.organisationId
        }
      });

      if (allocation) {
        return { error: "HAS_ALLOCATION_HISTORY" };
      }

      const adjustment = await tx.creditAdjustment.findFirst({
        where: {
          invoiceId: invoice.id,
          organisationId: req.user.organisationId
        }
      });

      if (adjustment) {
        return { error: "HAS_ADJUSTMENT_HISTORY" };
      }

      // Cancel pending reminders and preserve their history.
      // invoiceId is optional in the Reminder model.
      await tx.reminder.updateMany({
        where: {
          invoiceId: invoice.id,
          organisationId: req.user.organisationId,
          status: "PENDING"
        },
        data: {
          status: "CANCELLED",
          deliveryStatus: "CANCELLED"
        }
      });

      // Detach all reminder history before deleting the invoice.
      await tx.reminder.updateMany({
        where: {
          invoiceId: invoice.id,
          organisationId: req.user.organisationId
        },
        data: {
          invoiceId: null
        }
      });

      await tx.invoice.delete({
        where: {
          id: invoice.id
        }
      });

      return { success: true };
    });

    if (result.error === "NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Invoice not found"
      });
    }

    if (result.error === "HAS_ALLOCATION_HISTORY") {
      return res.status(409).json({
        success: false,
        message:
          "Invoice cannot be deleted because receipt allocation history exists"
      });
    }

    if (result.error === "HAS_ADJUSTMENT_HISTORY") {
      return res.status(409).json({
        success: false,
        message:
          "Invoice cannot be deleted because credit adjustment history exists"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Invoice deleted successfully"
    });

  } catch (error) {
    console.error("Delete Invoice Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete invoice"
    });
  }
};
