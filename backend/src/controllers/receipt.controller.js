
import prisma from "../config/prisma.js";
import { Prisma } from "@prisma/client";
import { refreshInvoiceReminders } from "../services/reminder.service.js";
import { notifyCustomerPayment } from "../services/customer-portal-notification.service.js";
import {
  buildCreditAdjustmentDataWhere,
  buildCustomerDataWhere,
  buildInvoiceDataWhere,
  buildReceiptAllocationDataWhere,
  buildReceiptDataWhere,
} from "../services/dashboard-access.service.js";
import {
  loadBrandedOrganisationName,
  renderBrandedPdf
} from "../services/branded-pdf.service.js";
import {
  finalizeCustomerSubscriptionReceipt,
  findVerifiedSubscriptionReceipt,
  isStoredReceiptPdfValid
} from "../services/customer-subscription-receipt.service.js";

// ==========================================
// COMMON VALIDATION
// ==========================================

const parsePositiveAmount = (value) => {
  try {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const amount = new Prisma.Decimal(value);

    if (!amount.isFinite() || amount.lte(0)) {
      return null;
    }

    return amount;
  } catch {
    return null;
  }
};

export const buildReceiptAllocationSummary = (allocations) => {
  const allocationsByInvoice = new Map();
  for (const allocation of allocations) {
    const current = allocationsByInvoice.get(allocation.invoiceId);
    allocationsByInvoice.set(allocation.invoiceId, {
      invoice: allocation.invoice,
      amount: (current?.amount || new Prisma.Decimal(0)).plus(allocation.amount)
    });
  }

  const rows = [...allocationsByInvoice.values()].map(({ invoice, amount }) => {
    const paid = invoice.allocations.reduce(
      (sum, allocation) => sum.plus(allocation.amount),
      new Prisma.Decimal(0)
    );
    const credits = invoice.creditAdjustments.reduce(
      (sum, adjustment) => sum.plus(adjustment.amount),
      new Prisma.Decimal(0)
    );
    const remaining = new Prisma.Decimal(invoice.total).minus(paid).minus(credits);
    return {
      reference: invoice.invoiceNumber,
      allocated: amount.toFixed(2),
      outstanding: Prisma.Decimal.max(remaining, 0).toFixed(2)
    };
  });
  const totalAllocated = allocations.reduce(
    (sum, allocation) => sum.plus(allocation.amount),
    new Prisma.Decimal(0)
  );
  return { rows, totalAllocated };
};

// ==========================================
// CREATE RECEIPT
// ==========================================

export const createReceipt = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const {
      receiptNumber,
      receiptDate,
      amount,
      currency,
      paymentMethod,
      transactionReference,
      notes,
      documentUrl,
      customerId
    } = req.body;

    const organisationId = access.organisationId;

    if (
      !receiptNumber ||
      !receiptDate ||
      amount === undefined ||
      !paymentMethod ||
      !customerId
    ) {
      return res.status(400).json({
        success: false,
        message: "Receipt number, date, amount, payment method and customer are required"
      });
    }

    const cleanReceiptNumber = String(receiptNumber).trim();

    if (!cleanReceiptNumber) {
      return res.status(400).json({
        success: false,
        message: "Receipt number cannot be empty"
      });
    }

    const receiptAmount = parsePositiveAmount(amount);

    if (!receiptAmount) {
      return res.status(400).json({
        success: false,
        message: "Receipt amount must be greater than zero"
      });
    }

    const validDate = new Date(receiptDate);

    if (Number.isNaN(validDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid receipt date"
      });
    }

    const cleanCurrency = String(currency || "INR")
      .trim()
      .toUpperCase();

    if (!/^[A-Z]{3}$/.test(cleanCurrency)) {
      return res.status(400).json({
        success: false,
        message: "Invalid currency code"
      });
    }

    const customer = await prisma.customer.findFirst({
      where: buildCustomerDataWhere(access, { id: customerId })
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found in this organisation"
      });
    }

    const receipt = await prisma.receipt.create({
      data: {
        receiptNumber: cleanReceiptNumber,
        receiptDate: validDate,
        amount: receiptAmount,
        currency: cleanCurrency,
        paymentMethod: String(paymentMethod).trim(),
        transactionReference,
        notes,
        documentUrl,
        customerId,
        organisationId
      },
      include: {
        customer: true
      }
    });

    let notification = null;
    if (receipt.status === "POSTED") {
      try {
        notification = await notifyCustomerPayment(receipt);
      } catch (notificationError) {
        console.error(
          "Payment customer notification failed:",
          notificationError.code || notificationError.name
        );
      }
    }

    return res.status(201).json({
      success: true,
      message: "Receipt created successfully",
      emailStatus: notification?.emailStatus || "NOT_APPLICABLE",
      receipt
    });

  } catch (error) {
    console.error("Create receipt error:", error);

    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Receipt number already exists"
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create receipt"
    });
  }
};

// ==========================================
// GET ALL RECEIPTS
// ==========================================

export const getReceipts = async (req, res) => {
  try {
    const access = req.dashboardAccess;

    const receipts = await prisma.receipt.findMany({
      where: buildReceiptDataWhere(access),
      include: {
        customer: true,
        allocations: {
          where: buildReceiptAllocationDataWhere(access),
          orderBy: {
            createdAt: "desc"
          }
        }
      },
      orderBy: {
        receiptDate: "desc"
      }
    });

    return res.status(200).json({
      success: true,
      count: receipts.length,
      receipts
    });

  } catch (error) {
    console.error("Get receipts error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch receipts"
    });
  }
};

export const downloadReceiptPdf = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const activeAllocationFilter = {
      status: "POSTED",
      reversedAt: null,
      receipt: { status: "POSTED" }
    };
    const receipt = await prisma.receipt.findFirst({
      where: buildReceiptDataWhere(access, { id: req.params.receiptId }),
      include: {
        customer: {
          select: {
            id: true,
            customerCode: true,
            name: true,
            email: true,
            phone: true
          }
        },
        allocations: {
          where: buildReceiptAllocationDataWhere(access, activeAllocationFilter),
          include: {
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                currency: true,
                total: true,
                allocations: {
                  where: buildReceiptAllocationDataWhere(access, activeAllocationFilter),
                  select: { amount: true }
                },
                creditAdjustments: {
                  where: buildCreditAdjustmentDataWhere(access, { status: "APPROVED" }),
                  select: { amount: true }
                }
              }
            }
          }
        }
      }
    });

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: "Receipt not found in this organisation."
      });
    }

    const { rows: allocationRows, totalAllocated } =
      buildReceiptAllocationSummary(receipt.allocations);
    const unallocatedAmount = Prisma.Decimal.max(
      new Prisma.Decimal(receipt.amount).minus(totalAllocated),
      0
    );
    const currency = String(receipt.currency || "INR").trim().toUpperCase();
    const formatAmount = (value) => `${currency} ${new Prisma.Decimal(value).toFixed(2)}`;
    const organisationName = await loadBrandedOrganisationName(access.organisationId);
    const pdf = await renderBrandedPdf({
      organisationName,
      title: "Payment Receipt",
      sectionTitle: "Receipt Details",
      titleFontSize: 16,
      customer: {
        id: receipt.customer.id,
        code: receipt.customer.customerCode,
        name: receipt.customer.name,
        email: receipt.customer.email,
        phone: receipt.customer.phone
      },
      summary: [
        { label: "Receipt number", value: receipt.receiptNumber },
        { label: "Transaction ID", value: receipt.transactionReference || receipt.id },
        {
          label: "Payment date and time",
          value: new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Kolkata"
          }).format(receipt.receiptDate)
        },
        { label: "Payment mode", value: receipt.paymentMethod },
        { label: "Payment status", value: receipt.status },
        { label: "Payment amount", value: formatAmount(receipt.amount) },
        { label: "Allocated amount", value: formatAmount(totalAllocated) },
        { label: "Unallocated receipt balance", value: formatAmount(unallocatedAmount) }
      ],
      columns: [
        { key: "reference", label: "Invoice / Loan reference", weight: 1.8 },
        { key: "allocated", label: "Allocated amount", weight: 1, align: "right" },
        { key: "outstanding", label: "Outstanding balance after allocation", weight: 1.4, align: "right" }
      ],
      rows: allocationRows.map((row) => ({
        ...row,
        allocated: formatAmount(row.allocated),
        outstanding: formatAmount(row.outstanding)
      })),
      emptyMessage: "No active invoice allocations are recorded for this receipt."
    });
    const filename = `${String(receipt.receiptNumber || receipt.id).replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(pdf);
  } catch (error) {
    console.error("Receipt PDF generation failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to generate the receipt PDF."
    });
  }
};

export const getCustomerSubscriptionReceipts = async (req, res) => {
  try {
    const receipts = await prisma.customerSubscriptionReceipt.findMany({
      where: {
        organisationId: req.dashboardAccess.organisationId,
        payment: { status: "PAID" }
      },
      select: {
        id: true,
        receiptNumber: true,
        transactionId: true,
        customerName: true,
        customerEmail: true,
        paymentMethod: true,
        amount: true,
        currency: true,
        paidAt: true,
        customer: { select: { name: true, email: true } },
        emailDeliveryAttempts: {
          where: { purpose: "PAYMENT_RECEIPT" },
          select: { status: true },
          orderBy: { createdAt: "desc" },
          take: 1
        }
      },
      orderBy: { paidAt: "desc" }
    });
    return res.status(200).json({
      success: true,
      count: receipts.length,
      receipts: receipts.map((receipt) => ({
        ...receipt,
        amount: Number(receipt.amount),
        customerName: receipt.customerName || receipt.customer.name,
        customerEmail: receipt.customerEmail || receipt.customer.email,
        emailStatus: receipt.emailDeliveryAttempts[0]?.status || "NOT_SENT"
      }))
    });
  } catch (error) {
    console.error("Verified subscription receipt query failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch verified subscription receipts."
    });
  }
};

export const downloadCustomerSubscriptionReceiptPdf = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const receipt = await prisma.customerSubscriptionReceipt.findFirst({
      where: {
        id: req.params.receiptId,
        organisationId: access.organisationId,
        payment: { status: "PAID" }
      },
      select: {
        id: true,
        paymentId: true,
        receiptNumber: true,
        pdfBytes: true,
        pdfSha256: true,
        verificationTokenHash: true,
        payment: { select: { status: true } }
      }
    });
    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: "Verified subscription receipt not found in this organisation."
      });
    }

    const finalized = isStoredReceiptPdfValid(receipt)
      ? receipt
      : await finalizeCustomerSubscriptionReceipt(
          receipt.paymentId,
          process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`
        );
    if (
      !isStoredReceiptPdfValid(finalized) ||
      finalized.payment.status !== "PAID"
    ) {
      return res.status(404).json({
        success: false,
        message: "Verified receipt PDF is not available."
      });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${receipt.receiptNumber}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(Buffer.from(finalized.pdfBytes));
  } catch (error) {
    console.error("Verified subscription receipt PDF failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to download the verified subscription receipt."
    });
  }
};

export const verifyCustomerSubscriptionReceipt = async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const receipt = await findVerifiedSubscriptionReceipt(req.params.token);
    if (!receipt) {
      return res.status(404).json({
        success: false,
        verified: false,
        message: "Receipt could not be verified."
      });
    }
    return res.status(200).json({
      success: true,
      verified: true,
      company: "ALPHA AURON PRIVATE LIMITED",
      product: "AURON COLLECT",
      receiptNumber: receipt.receiptNumber,
      transactionId: receipt.transactionId,
      amount: Number(receipt.amount),
      currency: receipt.currency,
      paidAt: receipt.paidAt,
      paymentMode: receipt.paymentMethod,
      status: "PAID"
    });
  } catch (error) {
    console.error("Receipt verification lookup failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      verified: false,
      message: "Unable to verify this receipt."
    });
  }
};

// ==========================================
// ALLOCATE RECEIPT TO INVOICE
// ==========================================

export const allocateReceipt = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const { receiptId, invoiceId, amount } = req.body;

    const organisationId = access.organisationId;

    if (!receiptId || !invoiceId || amount === undefined) {
      return res.status(400).json({
        success: false,
        message: "Receipt ID, invoice ID and amount are required"
      });
    }

    const allocationAmount = parsePositiveAmount(amount);

    if (!allocationAmount) {
      return res.status(400).json({
        success: false,
        message: "Allocation amount must be greater than zero"
      });
    }

    let result;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await prisma.$transaction(
          async (tx) => {

            const receipt = await tx.receipt.findFirst({
              where: buildReceiptDataWhere(access, { id: receiptId })
            });

            if (!receipt) {
              throw new Error("RECEIPT_NOT_FOUND");
            }

            if (receipt.status !== "POSTED") {
              throw new Error("RECEIPT_NOT_POSTED");
            }

            const invoice = await tx.invoice.findFirst({
              where: buildInvoiceDataWhere(access, {
                id: invoiceId,
                status: {
                  notIn: ["DRAFT", "CANCELLED", "WRITTEN_OFF"]
                }
              })
            });

            if (!invoice) {
              throw new Error("INVOICE_NOT_FOUND");
            }

            if (receipt.customerId !== invoice.customerId) {
              throw new Error("CUSTOMER_MISMATCH");
            }

            if (
              String(receipt.currency).toUpperCase() !==
              String(invoice.currency).toUpperCase()
            ) {
              throw new Error("CURRENCY_MISMATCH");
            }

            const receiptAllocations =
              await tx.receiptAllocation.aggregate({
                where: {
                  receiptId,
                  organisationId,
                  status: "POSTED",
                  reversedAt: null,
                  receipt: {
                    status: "POSTED"
                  }
                },
                _sum: {
                  amount: true
                }
              });

            const allocatedReceiptAmount =
              receiptAllocations._sum.amount ||
              new Prisma.Decimal(0);

            const receiptBalance =
              new Prisma.Decimal(receipt.amount)
                .minus(allocatedReceiptAmount);

            if (allocationAmount.gt(receiptBalance)) {
              throw new Error("RECEIPT_AMOUNT_EXCEEDED");
            }

            const invoiceAllocations =
              await tx.receiptAllocation.aggregate({
                where: {
                  invoiceId,
                  organisationId,
                  status: "POSTED",
                  reversedAt: null,
                  receipt: {
                    status: "POSTED"
                  }
                },
                _sum: {
                  amount: true
                }
              });

            const alreadyPaid =
              invoiceAllocations._sum.amount ||
              new Prisma.Decimal(0);

            const creditAdjustments =
              await tx.creditAdjustment.aggregate({
                where: {
                  invoiceId,
                  organisationId,
                  status: "APPROVED"
                },
                _sum: {
                  amount: true
                }
              });

            const approvedAdjustmentAmount =
              creditAdjustments._sum.amount ||
              new Prisma.Decimal(0);

            const invoiceBalance =
              new Prisma.Decimal(invoice.total)
                .minus(alreadyPaid)
                .minus(approvedAdjustmentAmount);

            if (invoiceBalance.lte(0)) {
              throw new Error("INVOICE_ALREADY_SETTLED");
            }

            if (allocationAmount.gt(invoiceBalance)) {
              throw new Error("INVOICE_AMOUNT_EXCEEDED");
            }

            return await tx.receiptAllocation.create({
              data: {
                amount: allocationAmount,
                receiptId,
                invoiceId,
                organisationId,
                status: "POSTED"
              },
              include: {
                receipt: true,
                invoice: true
              }
            });
          },
          {
            isolationLevel:
              Prisma.TransactionIsolationLevel.Serializable
          }
        );

        break;

      } catch (error) {
        if (error.code === "P2034" && attempt < 3) {
          console.log(`Allocation retry attempt: ${attempt}`);
          continue;
        }

        throw error;
      }
    }

    // Refresh reminders after successful payment allocation.
    // Payment transaction is already committed at this point.
    try {
      await refreshInvoiceReminders(
        prisma,
        invoiceId,
        organisationId
      );
    } catch (reminderError) {
      console.error(
        "Reminder refresh after allocation failed:",
        reminderError
      );
    }

    return res.status(201).json({
      success: true,
      message: "Receipt allocated successfully",
      allocation: result
    });

  } catch (error) {
    console.error("Allocate receipt error:", error);

    const messages = {
      RECEIPT_NOT_FOUND: [
        404,
        "Receipt not found in this organisation"
      ],
      RECEIPT_NOT_POSTED: [
        400,
        "Only POSTED receipts can be allocated"
      ],
      INVOICE_NOT_FOUND: [
        404,
        "Invoice not found or cannot be allocated"
      ],
      CUSTOMER_MISMATCH: [
        400,
        "Receipt and invoice must belong to the same customer"
      ],
      CURRENCY_MISMATCH: [
        400,
        "Receipt and invoice currencies must match"
      ],
      RECEIPT_AMOUNT_EXCEEDED: [
        400,
        "Allocation exceeds available receipt amount"
      ],
      INVOICE_AMOUNT_EXCEEDED: [
        400,
        "Allocation exceeds invoice outstanding amount after approved adjustments"
      ],
      INVOICE_ALREADY_SETTLED: [
        400,
        "Invoice has no outstanding balance available for allocation"
      ]
    };

    if (messages[error.message]) {
      const [statusCode, message] = messages[error.message];

      return res.status(statusCode).json({
        success: false,
        message
      });
    }

    if (error.code === "P2034") {
      return res.status(409).json({
        success: false,
        message: "Allocation conflict. Please try again."
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to allocate receipt"
    });
  }
};

// ==========================================
// REVERSE ALLOCATION
// ==========================================

export const reverseAllocation = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const { reason } = req.body;
    const { allocationId } = req.params;
    const organisationId = access.organisationId;

    if (
      typeof reason !== "string" ||
      !reason.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Reversal reason is required"
      });
    }

    // Fetch allocation first to identify its invoice.
    const existingAllocation =
      await prisma.receiptAllocation.findFirst({
        where: buildReceiptAllocationDataWhere(access, {
          id: allocationId,
          status: "POSTED"
        })
      });

    if (!existingAllocation) {
      return res.status(404).json({
        success: false,
        message: "Posted allocation not found or already reversed"
      });
    }

    const result = await prisma.receiptAllocation.updateMany({
      where: buildReceiptAllocationDataWhere(access, {
        id: allocationId,
        status: "POSTED"
      }),
      data: {
        status: "REVERSED",
        reversedAt: new Date(),
        reversalReason: reason.trim()
      }
    });

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        message: "Posted allocation not found or already reversed"
      });
    }

    const reversed = await prisma.receiptAllocation.findFirst({
      where: buildReceiptAllocationDataWhere(access, {
        id: allocationId
      }),
      include: {
        receipt: true,
        invoice: true
      }
    });

    // Recalculate outstanding and refresh future reminders.
    try {
      await refreshInvoiceReminders(
        prisma,
        existingAllocation.invoiceId,
        organisationId
      );
    } catch (reminderError) {
      console.error(
        "Reminder refresh after reversal failed:",
        reminderError
      );
    }

    return res.status(200).json({
      success: true,
      message: "Allocation reversed successfully",
      allocation: reversed
    });

  } catch (error) {
    console.error("Reverse allocation error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to reverse allocation"
    });
  }
};
