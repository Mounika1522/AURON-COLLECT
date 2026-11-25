import bcrypt from "bcryptjs";
import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../config/prisma.js";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import {
  drawBrandedPdfPageHeader,
  loadBrandedPdfLogo
} from "../services/branded-pdf.service.js";

const excludedInvoiceStatuses = ["DRAFT", "CANCELLED", "WRITTEN_OFF"];
const logoPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../public/auron-logo.png");
const companyFooter = () => [
  process.env.COMPANY_BILLING_ADDRESS || "Alpha Auron Private Limited",
  process.env.COMPANY_GSTIN ? `GSTIN: ${process.env.COMPANY_GSTIN}` : null
].filter(Boolean).join(" · ");
const amount = (value) => new Prisma.Decimal(value || 0);
const sumAmounts = (items, selectValue) =>
  items.reduce(
    (sum, item) => sum.plus(selectValue(item)),
    new Prisma.Decimal(0)
  );

const customerScope = (req) => ({
  customerId: req.customer.customerId,
  organisationId: req.customer.organisationId
});

const mapInvoice = (invoice) => {
  const paid = sumAmounts(invoice.allocations, (allocation) => allocation.amount);
  const credits = sumAmounts(
    invoice.creditAdjustments,
    (adjustment) => adjustment.amount
  );
  const total = amount(invoice.total);
  const outstanding = Prisma.Decimal.max(total.minus(paid).minus(credits), 0);
  const status = outstanding <= 0
    ? "Paid"
    : new Date(invoice.dueDate) < new Date(new Date().setHours(0, 0, 0, 0))
      ? "Overdue"
      : "Open";

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    subtotal: amount(invoice.subtotal).toNumber(),
    tax: amount(invoice.tax).toNumber(),
    discount: amount(invoice.discount).toNumber(),
    total: total.toNumber(),
    paid: paid.toNumber(),
    credits: credits.toNumber(),
    outstanding: outstanding.toNumber(),
    status,
    notes: invoice.notes
  };
};

const loadInvoices = (where) =>
  prisma.invoice.findMany({
    where: { ...where, status: { notIn: excludedInvoiceStatuses } },
    include: {
      allocations: {
        where: {
          status: "POSTED",
          reversedAt: null,
          receipt: { status: "POSTED" }
        },
        select: { amount: true }
      },
      creditAdjustments: {
        where: { status: "APPROVED" },
        select: { amount: true }
      }
    },
    orderBy: [{ dueDate: "asc" }, { invoiceDate: "desc" }]
  });

export const getCustomerProfile = async (req, res) => {
  try {
    const account = await prisma.customerPortalAccount.findFirst({
      where: {
        id: req.customer.accountId,
        customerId: req.customer.customerId,
        customer: {
          organisationId: req.customer.organisationId,
          status: "ACTIVE"
        }
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        emailVerifiedAt: true,
        createdAt: true,
        customer: {
          select: {
            id: true,
            name: true,
            customerCode: true,
            contactPerson: true,
            email: true,
            phone: true,
            billingAddress: true,
            paymentTerms: true
          }
        }
      }
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Customer profile not found."
      });
    }

    return res.status(200).json({ success: true, profile: account });
  } catch (error) {
    console.error("Customer profile query failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load your profile."
    });
  }
};

export const updateCustomerProfile = async (req, res) => {
  try {
    const fullName = req.body?.fullName;
    if (
      typeof fullName !== "string" ||
      !fullName.trim() ||
      fullName.trim().length > 120
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a name of up to 120 characters."
      });
    }

    const updated = await prisma.customerPortalAccount.updateMany({
      where: {
        id: req.customer.accountId,
        customerId: req.customer.customerId,
        customer: { organisationId: req.customer.organisationId }
      },
      data: { fullName: fullName.trim() }
    });
    if (updated.count !== 1) {
      return res.status(404).json({
        success: false,
        message: "Customer profile not found."
      });
    }
    return res.status(200).json({
      success: true,
      message: "Profile updated."
    });
  } catch (error) {
    console.error("Customer profile update failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to update your profile."
    });
  }
};

export const changeCustomerPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      newPassword.length < 12 ||
      newPassword.length > 128 ||
      newPassword !== confirmPassword
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter your current password and matching new passwords of at least 12 characters."
      });
    }

    const account = await prisma.customerPortalAccount.findFirst({
      where: {
        id: req.customer.accountId,
        customerId: req.customer.customerId,
        customer: { organisationId: req.customer.organisationId }
      },
      include: { customer: { select: { organisationId: true } } }
    });
    if (!account || !(await bcrypt.compare(currentPassword, account.passwordHash))) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect."
      });
    }

    const newSessionVersion = account.sessionVersion + 1;
    await prisma.customerPortalAccount.update({
      where: { id: account.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 12),
        sessionVersion: newSessionVersion
      }
    });
    const token = jwt.sign(
      {
        tokenType: "CUSTOMER_PORTAL",
        accountId: account.id,
        customerId: account.customerId,
        sessionVersion: newSessionVersion
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.CUSTOMER_JWT_EXPIRES_IN || "8h" }
    );

    return res.status(200).json({
      success: true,
      token,
      message: "Password updated."
    });
  } catch (error) {
    console.error("Customer password update failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to update your password."
    });
  }
};

export const getCustomerDashboard = async (req, res) => {
  try {
    const where = customerScope(req);
    const [invoices, receipts, notifications, customer] = await Promise.all([
      loadInvoices(where),
      prisma.receipt.findMany({
        where: { ...where, status: "POSTED" },
        include: {
          allocations: {
            where: { status: "POSTED", reversedAt: null },
            include: {
              invoice: { select: { invoiceNumber: true } }
            }
          }
        },
        orderBy: { receiptDate: "desc" },
        take: 10
      }),
      prisma.customerNotification.count({
        where: { ...where, readAt: null }
      }),
      prisma.customer.findFirst({
        where: {
          id: req.customer.customerId,
          organisationId: req.customer.organisationId
        },
        select: { name: true, customerCode: true, paymentTerms: true }
      })
    ]);

    const mappedInvoices = invoices.map(mapInvoice);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextThirtyDays = new Date(today);
    nextThirtyDays.setDate(nextThirtyDays.getDate() + 30);
    const upcoming = mappedInvoices.filter((invoice) => {
      const dueDate = new Date(invoice.dueDate);
      return invoice.outstanding > 0 && dueDate >= today && dueDate <= nextThirtyDays;
    });
    const overdue = mappedInvoices.filter((invoice) => invoice.status === "Overdue");

    return res.status(200).json({
      success: true,
      dashboard: {
        customer,
        totalInvoices: mappedInvoices.length,
        billedAmount: sumAmounts(mappedInvoices, (invoice) => invoice.total).toNumber(),
        paidAmount: sumAmounts(mappedInvoices, (invoice) => invoice.paid).toNumber(),
        outstandingAmount: sumAmounts(mappedInvoices, (invoice) => invoice.outstanding).toNumber(),
        upcomingDueAmount: sumAmounts(upcoming, (invoice) => invoice.outstanding).toNumber(),
        overdueAmount: sumAmounts(overdue, (invoice) => invoice.outstanding).toNumber(),
        upcomingInvoices: upcoming.slice(0, 10),
        overdueInvoices: overdue.slice(0, 10),
        recentInvoices: mappedInvoices.slice(0, 10),
        recentReceipts: receipts,
        recentTransactions: receipts.slice(0, 10).map((receipt) => ({
          id: receipt.id,
          type: "PAYMENT_RECEIVED",
          reference: receipt.receiptNumber,
          date: receipt.receiptDate,
          amount: Number(receipt.amount),
          currency: receipt.currency,
          status: receipt.status
        })),
        unreadNotificationCount: notifications
      }
    });
  } catch (error) {
    console.error("Customer dashboard query failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load your dashboard."
    });
  }
};

export const getCustomerInvoices = async (req, res) => {
  try {
    const invoices = await loadInvoices(customerScope(req));
    return res.status(200).json({
      success: true,
      invoices: invoices.map(mapInvoice)
    });
  } catch (error) {
    console.error("Customer invoice query failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load your invoices."
    });
  }
};

export const getCustomerInvoicePdf = async (req, res) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: req.params.invoiceId,
        ...customerScope(req),
        status: { notIn: excludedInvoiceStatuses }
      },
      include: {
        customer: {
          select: {
            name: true,
            email: true,
            phone: true,
            billingAddress: true,
            taxRegistration: true
          }
        },
        allocations: {
          where: {
            status: "POSTED",
            reversedAt: null,
            receipt: { status: "POSTED" }
          },
          select: { amount: true }
        },
        creditAdjustments: {
          where: { status: "APPROVED" },
          select: { amount: true }
        }
      }
    });
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found."
      });
    }

    const mapped = mapInvoice(invoice);
    const document = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    const pdf = new Promise((resolve, reject) => {
      document.on("end", () => resolve(Buffer.concat(chunks)));
      document.on("error", reject);
    });

    const logo = await readFile(logoPath);
    document.save();
    document.fillColor("#e50914").rect(0, 0, 595.28, 8).fill();
    document.restore();
    document.image(logo, 48, 25, { fit: [54, 46] });
    document.font("Helvetica-Bold").fontSize(16).fillColor("#111827").text("ALPHA AURON", 116, 32);
    document.font("Helvetica").fontSize(8).fillColor("#64748b").text("ALPHA AURON PRIVATE LIMITED", 116, 52);
    document.save();
    document.opacity(0.055);
    document.image(logo, 190, 280, { width: 210 });
    document.restore();
    document.moveDown(0.5).fontSize(15).fillColor("#111827").text("TAX INVOICE", 48, 88);
    document.moveDown().fontSize(11).text(`Invoice: ${invoice.invoiceNumber}`);
    document.text(`Customer: ${invoice.customer.name}`);
    if (invoice.customer.billingAddress) {
      document.text(`Billing address: ${invoice.customer.billingAddress}`);
    }
    if (invoice.customer.email) document.text(`Email: ${invoice.customer.email}`);
    if (invoice.customer.phone) document.text(`Phone: ${invoice.customer.phone}`);
    if (invoice.customer.taxRegistration) {
      document.text(`Customer tax registration: ${invoice.customer.taxRegistration}`);
    }
    document.text(`Invoice date: ${invoice.invoiceDate.toISOString().slice(0, 10)}`);
    document.text(`Due date: ${invoice.dueDate.toISOString().slice(0, 10)}`);
    document.moveDown().text(`Subtotal: ${invoice.currency} ${mapped.subtotal.toFixed(2)}`);
    document.text(`Tax: ${invoice.currency} ${mapped.tax.toFixed(2)}`);
    document.text(`Discount: ${invoice.currency} ${mapped.discount.toFixed(2)}`);
    document.text(`Total: ${invoice.currency} ${mapped.total.toFixed(2)}`);
    document.text(`Paid: ${invoice.currency} ${mapped.paid.toFixed(2)}`);
    document.text(`Outstanding: ${invoice.currency} ${mapped.outstanding.toFixed(2)}`);
    if (invoice.notes) {
      document.moveDown().text(`Notes: ${invoice.notes}`);
    }
    document.moveTo(48, 756).lineTo(547, 756).lineWidth(1).strokeColor("#e2e8f0").stroke();
    document.fontSize(8).fillColor("#64748b").text(
      `${companyFooter()} · Generated from verified account records`,
      48,
      768,
      { width: 490 }
    );
    document.end();

    const buffer = await pdf;
    const filename = `${invoice.invoiceNumber}`.replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Customer invoice PDF generation failed:", error.code || error.name);
    if (res.headersSent) return res.end();
    return res.status(500).json({
      success: false,
      message: "Unable to generate the invoice PDF."
    });
  }
};

export const getCustomerReceipts = async (req, res) => {
  try {
    const receipts = await prisma.receipt.findMany({
      where: { ...customerScope(req), status: "POSTED" },
      include: {
        allocations: {
          where: { status: "POSTED", reversedAt: null },
          include: {
            invoice: { select: { id: true, invoiceNumber: true } }
          }
        }
      },
      orderBy: { receiptDate: "desc" }
    });
    return res.status(200).json({ success: true, receipts });
  } catch (error) {
    console.error("Customer receipt query failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load your payment history."
    });
  }
};

export const getCustomerReceiptPdf = async (req, res) => {
  try {
    const receipt = await prisma.receipt.findFirst({
      where: {
        id: req.params.receiptId,
        ...customerScope(req),
        status: "POSTED"
      },
      include: {
        customer: {
          select: {
            name: true,
            email: true,
            phone: true,
            billingAddress: true,
            taxRegistration: true
          }
        },
        allocations: {
          where: { status: "POSTED", reversedAt: null },
          include: {
            invoice: {
              select: { invoiceNumber: true, invoiceDate: true, dueDate: true, subtotal: true, tax: true, total: true, currency: true }
            }
          }
        }
      }
    });
    if (!receipt) {
      return res.status(404).json({ success: false, message: "Posted receipt not found." });
    }

    const document = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    const pdf = new Promise((resolve, reject) => {
      document.on("end", () => resolve(Buffer.concat(chunks)));
      document.on("error", reject);
    });
    const logo = await loadBrandedPdfLogo();
    drawBrandedPdfPageHeader(document, logo, "Payment Receipt", { titleFontSize: 16 });

    document.moveDown().font("Helvetica-Bold").fontSize(10).fillColor("#e50914").text("RECEIPT DETAILS", 48, 91);
    const row = (label, value, y) => {
      document.font("Helvetica").fontSize(9).fillColor("#64748b").text(label, 48, y, { width: 150 });
      document.font("Helvetica").fontSize(10).fillColor("#111827").text(String(value ?? "—"), 205, y, { width: 340 });
    };
    row("Receipt number", receipt.receiptNumber, 116);
    row("Customer", receipt.customer.name, 138);
    row("Email", receipt.customer.email, 160);
    row("Phone", receipt.customer.phone, 182);
    row("Billing address", receipt.customer.billingAddress, 204);
    row("Customer tax registration", receipt.customer.taxRegistration, 226);
    row("Payment date", receipt.receiptDate.toISOString().slice(0, 10), 248);
    row("Payment method", receipt.paymentMethod, 270);
    row("Transaction reference", receipt.transactionReference || "—", 292);
    row("Status", receipt.status, 314);

    document.moveTo(48, 344).lineTo(547, 344).lineWidth(1).strokeColor("#e2e8f0").stroke();
    document.font("Helvetica-Bold").fontSize(10).fillColor("#e50914").text("INVOICE ALLOCATIONS", 48, 358);
    let y = 384;
    for (const allocation of receipt.allocations) {
      if (y > 710) {
        document.addPage();
        y = 55;
      }
      document.font("Helvetica-Bold").fontSize(9).fillColor("#111827")
        .text(allocation.invoice.invoiceNumber, 48, y);
      document.font("Helvetica").fontSize(9).fillColor("#111827")
        .text(`${receipt.currency} ${Number(allocation.amount).toFixed(2)}`, 360, y, { width: 180, align: "right" });
      y += 17;
      document.font("Helvetica").fontSize(8).fillColor("#64748b")
        .text(`Subtotal ${allocation.invoice.currency} ${Number(allocation.invoice.subtotal).toFixed(2)} · Tax ${allocation.invoice.currency} ${Number(allocation.invoice.tax).toFixed(2)} · Invoice total ${allocation.invoice.currency} ${Number(allocation.invoice.total).toFixed(2)}`, 48, y, { width: 490 });
      y += 20;
    }
    if (receipt.allocations.length === 0) {
      document.font("Helvetica").fontSize(9).fillColor("#64748b").text("No invoice allocation is recorded for this receipt.", 48, y);
      y += 20;
    }
    document.moveTo(48, y + 3).lineTo(547, y + 3).lineWidth(1).strokeColor("#e2e8f0").stroke();
    document.font("Helvetica").fontSize(9).fillColor("#64748b").text("AMOUNT RECEIVED", 48, y + 18);
    document.font("Helvetica-Bold").fontSize(16).fillColor("#111827")
      .text(`${receipt.currency} ${Number(receipt.amount).toFixed(2)}`, 205, y + 14);
    document.moveTo(48, 756).lineTo(547, 756).lineWidth(1).strokeColor("#e2e8f0").stroke();
    document.font("Helvetica").fontSize(8).fillColor("#64748b").text(
      `${companyFooter()} · Generated from verified account records`,
      48,
      768,
      { width: 490 }
    );
    document.end();

    const buffer = await pdf;
    const filename = receipt.receiptNumber.replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Customer receipt PDF generation failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to generate your payment receipt."
    });
  }
};

export const getCustomerNotifications = async (req, res) => {
  try {
    const notifications = await prisma.customerNotification.findMany({
      where: customerScope(req),
      include: {
        invoice: { select: { id: true, invoiceNumber: true } },
        receipt: { select: { id: true, receiptNumber: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return res.status(200).json({ success: true, notifications });
  } catch (error) {
    console.error("Customer notification query failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load your notifications."
    });
  }
};

export const markCustomerNotificationRead = async (req, res) => {
  try {
    const result = await prisma.customerNotification.updateMany({
      where: {
        id: req.params.notificationId,
        ...customerScope(req)
      },
      data: { readAt: new Date() }
    });
    if (result.count !== 1) {
      return res.status(404).json({
        success: false,
        message: "Notification not found."
      });
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Mark customer notification failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to update the notification."
    });
  }
};

export const markAllCustomerNotificationsRead = async (req, res) => {
  try {
    await prisma.customerNotification.updateMany({
      where: {
        ...customerScope(req),
        readAt: null
      },
      data: { readAt: new Date() }
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Mark all customer notifications failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to update notifications."
    });
  }
};
