import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../config/prisma.js";
import { customerEmailTemplate } from "./customer-email-templates.js";
import { sendTrackedCustomerEmail } from "./customer-email-delivery.service.js";

const logoPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../public/auron-logo.png"
);

const formatDate = (value) => value
  ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value))
  : "—";

const receiptNumberFor = (payment) => payment.invoice.invoiceNumber;
const isStoredReceiptValid = (receipt) =>
  receipt?.pdfBytes &&
  typeof receipt.pdfSha256 === "string" &&
  createHash("sha256").update(receipt.pdfBytes).digest("hex") === receipt.pdfSha256;

const getPaidBillingPayment = (paymentId, organisationId, db) =>
  db.billingPayment.findFirst({
    where: {
      id: paymentId,
      status: "PAID",
      ...(organisationId ? { organisationId } : {})
    },
    include: {
      plan: { select: { name: true } },
      invoice: true,
      organisation: { select: { name: true } },
      customer: { include: { portalAccount: true } }
    }
  });

export const buildOrganizationSubscriptionReceiptPdf = async (payment) => {
  const logo = await readFile(logoPath);
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 52 });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    document.save();
    document.fillColor("#e50914").rect(0, 0, 595.28, 8).fill();
    document.restore();
    document.image(logo, 52, 28, { fit: [54, 46] });
    document.fillColor("#111827").font("Helvetica-Bold").fontSize(16)
      .text("ALPHA AURON", 120, 35);
    document.fillColor("#64748b").font("Helvetica").fontSize(8)
      .text("ALPHA AURON PRIVATE LIMITED", 120, 56);
    document.fillColor("#111827").font("Helvetica-Bold").fontSize(17)
      .text("SUBSCRIPTION PAYMENT RECEIPT", 290, 40, { width: 250, align: "right" });
    document.moveTo(52, 90).lineTo(543, 90).lineWidth(1).strokeColor("#e2e8f0").stroke();

    let y = 116;
    const row = (label, value) => {
      document.fillColor("#64748b").font("Helvetica").fontSize(9)
        .text(label, 52, y, { width: 145 });
      document.fillColor("#111827").font("Helvetica").fontSize(10)
        .text(String(value ?? "—"), 205, y, { width: 338 });
      y += 25;
    };

    row("Receipt reference", receiptNumberFor(payment));
    row("Issued", formatDate(payment.invoice.createdAt));
    row("Organisation", payment.organisation.name);
    row("Plan", payment.plan.name);
    row("Billing cycle", payment.billingCycle);
    row("Payment status", "PAID");
    row("Payment date", formatDate(payment.paidAt));
    row("Service period", `${formatDate(payment.effectiveAt)} – ${formatDate(payment.periodEndsAt)}`);
    row("Razorpay payment reference", payment.razorpayPaymentId);

    document.moveTo(52, y + 3).lineTo(543, y + 3).lineWidth(1).strokeColor("#e2e8f0").stroke();
    y += 23;
    document.fillColor("#64748b").font("Helvetica").fontSize(9)
      .text("AMOUNT PAID", 52, y);
    document.fillColor("#111827").font("Helvetica-Bold").fontSize(18)
      .text(`${payment.currency} ${Number(payment.amount).toFixed(2)}`, 205, y - 4, {
        width: 338
      });
    document.fillColor("#64748b").font("Helvetica").fontSize(8)
      .text("This receipt records the verified payment amount. No tax amount or terms are inferred.", 52, y + 36, {
        width: 491
      });
    document.moveTo(52, 756).lineTo(543, 756).lineWidth(1).strokeColor("#e2e8f0").stroke();
    document.fillColor("#64748b").font("Helvetica").fontSize(8)
      .text("Alpha Auron Collect · Generated from verified billing records", 52, 768, {
        width: 491
      });
    document.end();
  });
};

const getOrCreateOrganizationSubscriptionReceipt = async (
  paymentId,
  organisationId,
  { db, buildPdf }
) => {
  const payment = await getPaidBillingPayment(paymentId, organisationId, db);
  if (!payment?.invoice) return null;

  const existing = await db.billingPaymentReceipt.findUnique({
    where: { paymentId },
    select: {
      id: true,
      receiptNumber: true,
      pdfBytes: true,
      pdfSha256: true
    }
  });
  if (existing) {
    if (!isStoredReceiptValid(existing)) {
      throw new Error("Stored subscription receipt failed integrity validation.");
    }
    return { payment, receipt: existing };
  }

  const pdfBytes = await buildPdf(payment);
  const receiptData = {
    organisationId: payment.organisationId,
    paymentId: payment.id,
    receiptNumber: receiptNumberFor(payment),
    pdfBytes,
    pdfSha256: createHash("sha256").update(pdfBytes).digest("hex")
  };
  try {
    const receipt = await db.billingPaymentReceipt.create({
      data: receiptData,
      select: {
        id: true,
        receiptNumber: true,
        pdfBytes: true,
        pdfSha256: true
      }
    });
    return { payment, receipt };
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const receipt = await db.billingPaymentReceipt.findUnique({
      where: { paymentId },
      select: {
        id: true,
        receiptNumber: true,
        pdfBytes: true,
        pdfSha256: true
      }
    });
    if (!receipt || !isStoredReceiptValid(receipt)) throw error;
    return { payment, receipt };
  }
};

export const getOrganizationSubscriptionReceiptPdf = async (
  paymentId,
  organisationId,
  { db = prisma, buildPdf = buildOrganizationSubscriptionReceiptPdf } = {}
) => {
  const result = await getOrCreateOrganizationSubscriptionReceipt(
    paymentId,
    organisationId,
    { db, buildPdf }
  );
  if (!result) return null;
  return {
    invoiceNumber: result.receipt.receiptNumber,
    pdfBytes: Buffer.from(result.receipt.pdfBytes)
  };
};

export const sendOrganizationSubscriptionReceiptEmail = async (
  paymentId,
  {
    db = prisma,
    deliver = sendTrackedCustomerEmail,
    env = process.env,
    buildPdf = buildOrganizationSubscriptionReceiptPdf
  } = {}
) => {
  const result = await getOrCreateOrganizationSubscriptionReceipt(
    paymentId,
    undefined,
    { db, buildPdf }
  );
  const payment = result?.payment;
  if (!payment?.invoice || !payment.customerId || !result.receipt) {
    return { status: "NOT_READY" };
  }
  const account = payment.customer?.portalAccount;
  const to =
    account?.emailVerifiedAt && typeof account.email === "string"
      ? account.email.trim()
      : "";
  const pdfBytes = Buffer.from(result.receipt.pdfBytes);
  const email = customerEmailTemplate("PAYMENT_RECEIPT", {
    fullName: account?.fullName || payment.customer?.name || "Customer",
    receiptNumber: result.receipt.receiptNumber,
    currency: payment.currency,
    amount: Number(payment.amount).toFixed(2),
    paymentDate: formatDate(payment.paidAt),
    transactionReference: payment.razorpayPaymentId
  });
  const filenameReference = result.receipt.receiptNumber.replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );

  return deliver({
    accountId: account?.id,
    customerId: payment.customerId,
    billingPaymentId: payment.id,
    purpose: "PAYMENT_RECEIPT",
    to,
    ...email,
    attachments: [{
      filename: `AURON-COLLECT-Subscription-Receipt-${filenameReference}.pdf`,
      content: pdfBytes,
      contentType: "application/pdf"
    }]
  }, { db, env });
};
