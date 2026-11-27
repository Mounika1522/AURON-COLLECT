import { createHash, randomBytes } from "node:crypto";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import prisma from "../config/prisma.js";
import { customerEmailTemplate } from "./customer-email-templates.js";
import { getCustomerReceiptPdfFilename } from "./customer-receipt-pdf.service.js";
import {
  drawBrandedPdfPageHeader,
  loadBrandedPdfLogo
} from "./branded-pdf.service.js";
import { sendTrackedCustomerEmail } from "./customer-email-delivery.service.js";

const hashVerificationToken = (token) =>
  createHash("sha256").update(token).digest("hex");

export const isStoredReceiptPdfValid = (receipt) =>
  Boolean(
    receipt?.pdfBytes &&
    receipt?.pdfSha256 &&
    receipt?.verificationTokenHash &&
    createHash("sha256").update(Buffer.from(receipt.pdfBytes)).digest("hex") ===
      receipt.pdfSha256
  );

const formatDate = (value, { time = false } = {}) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    ...(time ? { timeStyle: "short" } : {}),
    timeZone: "Asia/Kolkata"
  }).format(new Date(value));
};

const formatAmount = (value, currency) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2
  }).format(Number(value));

const verificationUrlFor = (token, origin) => {
  const configuredOrigin =
    process.env.PUBLIC_API_URL ||
    (process.env.NODE_ENV === "production" ? null : origin);
  if (!configuredOrigin) {
    throw new Error("Public API URL is required to generate a receipt QR code.");
  }
  const parsedOrigin = new URL(configuredOrigin);
  if (!["http:", "https:"].includes(parsedOrigin.protocol)) {
    throw new Error("Public API URL must use HTTP or HTTPS.");
  }
  parsedOrigin.pathname = `/api/receipts/verify/${token}`;
  parsedOrigin.search = "";
  parsedOrigin.hash = "";
  return parsedOrigin.toString();
};

export const renderOfficialSubscriptionReceipt = async ({
  receipt,
  payment,
  customer,
  verificationUrl
}) => {
  const logo = await loadBrandedPdfLogo();
  const qrCode = await QRCode.toBuffer(verificationUrl, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 144
  });

  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    drawBrandedPdfPageHeader(document, logo, "OFFICIAL PAYMENT RECEIPT", {
      titleFontSize: 13
    });
    document.font("Helvetica-Bold").fontSize(10).fillColor("#e50914")
      .text("AURON COLLECT", 48, 91);
    document.font("Helvetica").fontSize(8).fillColor("#64748b")
      .text("Verified customer subscription payment", 48, 106);
    const companyDetails = [
      process.env.COMPANY_BILLING_ADDRESS,
      process.env.COMPANY_GSTIN ? `GSTIN: ${process.env.COMPANY_GSTIN}` : null,
      process.env.COMPANY_SUPPORT_EMAIL
    ].filter(Boolean).join(" · ");
    if (companyDetails) {
      document.font("Helvetica").fontSize(7).fillColor("#64748b")
        .text(companyDetails, 48, 117, { width: 499, height: 14 });
    }

    const rows = [
      ["Receipt number", receipt.receiptNumber],
      ["Transaction ID", receipt.transactionId],
      ["Customer name", receipt.customerName || customer.name],
      ["Customer ID", customer.id],
      ["Registered email", receipt.customerEmail || customer.email || "Not provided"],
      ["Payment amount", formatAmount(receipt.amount, receipt.currency)],
      ["Payment date and time", formatDate(receipt.paidAt, { time: true })],
      ["Payment mode", receipt.paymentMethod || payment.paymentMethod || "Not provided"],
      ["Payment status", "PAID - provider verified"],
      ["Subscription plan", payment.planName],
      ["Billing cycle", payment.billingCycle],
      [
        "Service period",
        `${formatDate(payment.periodStart)} to ${formatDate(payment.periodEnd)}`
      ],
      ["Next renewal date", formatDate(payment.periodEnd)],
      ["Loan account number", "Not applicable - subscription payment"],
      ["Original loan amount", "Not applicable - subscription payment"],
      ["Previous outstanding balance", "Not applicable - subscription payment"],
      ["Remaining loan balance", "Not applicable - subscription payment"]
    ];

    let y = 140;
    for (const [label, value] of rows) {
      document.font("Helvetica").fontSize(8.5).fillColor("#64748b")
        .text(label, 48, y, { width: 152 });
      document.font("Helvetica").fontSize(9).fillColor("#111827")
        .text(String(value ?? "—"), 205, y, { width: 340 });
      y += 20;
    }

    document.moveTo(48, y + 3).lineTo(547, y + 3)
      .lineWidth(1).strokeColor("#e2e8f0").stroke();
    document.image(qrCode, 48, y + 20, { fit: [92, 92] });
    document.font("Helvetica-Bold").fontSize(8).fillColor("#111827")
      .text("SCAN TO VERIFY RECEIPT", 151, y + 35);
    document.font("Helvetica").fontSize(7.5).fillColor("#64748b")
      .text("Verification confirms receipt number, payment status and amount.", 151, y + 51, {
        width: 310
      });

    const signatureY = Math.max(y + 135, 650);
    document.moveTo(350, signatureY + 27).lineTo(547, signatureY + 27)
      .lineWidth(1).strokeColor("#111827").stroke();
    document.font("Helvetica-Bold").fontSize(8).fillColor("#111827")
      .text("For ALPHA AURON PRIVATE LIMITED", 350, signatureY + 34, {
        width: 197,
        align: "center"
      });
    document.font("Helvetica").fontSize(8).fillColor("#64748b")
      .text("Authorised Signatory", 350, signatureY + 47, {
        width: 197,
        align: "center"
      });

    document.moveTo(48, 756).lineTo(547, 756)
      .lineWidth(1).strokeColor("#e2e8f0").stroke();
    document.font("Helvetica").fontSize(7.5).fillColor("#64748b")
      .text(
        "ALPHA AURON PRIVATE LIMITED · This is a subscription receipt; loan balance details do not apply.",
        48,
        766,
        { width: 499, align: "center" }
      );
    document.end();
  });
};

export const finalizeCustomerSubscriptionReceipt = async (
  paymentId,
  verificationOrigin
) => {
  const receipt = await prisma.customerSubscriptionReceipt.findUnique({
    where: { paymentId },
    include: {
      payment: true,
      customer: true
    }
  });
  if (!receipt || receipt.payment.status !== "PAID") return null;
  if (receipt.pdfBytes || receipt.verificationTokenHash) {
    if (!isStoredReceiptPdfValid(receipt)) {
      throw new Error("Stored payment receipt failed its integrity check.");
    }
    return receipt;
  }

  const transactionId =
    receipt.transactionId || receipt.payment.razorpayPaymentId;
  if (!transactionId) {
    throw new Error("Verified payment is missing its provider transaction ID.");
  }

  const token = randomBytes(32).toString("base64url");
  const pdfBytes = await renderOfficialSubscriptionReceipt({
    receipt: {
      ...receipt,
      transactionId,
      customerName: receipt.customerName || receipt.customer.name,
      customerEmail: receipt.customerEmail || receipt.customer.email
    },
    payment: receipt.payment,
    customer: receipt.customer,
    verificationUrl: verificationUrlFor(token, verificationOrigin)
  });

  await prisma.customerSubscriptionReceipt.updateMany({
    where: { id: receipt.id, pdfBytes: null },
    data: {
      transactionId,
      customerName: receipt.customerName || receipt.customer.name,
      customerEmail: receipt.customerEmail || receipt.customer.email,
      paymentMethod: receipt.paymentMethod || receipt.payment.paymentMethod,
      verificationTokenHash: hashVerificationToken(token),
      pdfBytes,
      pdfSha256: createHash("sha256").update(pdfBytes).digest("hex")
    }
  });

  return prisma.customerSubscriptionReceipt.findUnique({
    where: { id: receipt.id },
    include: { payment: true, customer: true }
  });
};

export const findVerifiedSubscriptionReceipt = (token) => {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }
  return prisma.customerSubscriptionReceipt.findFirst({
    where: {
      verificationTokenHash: hashVerificationToken(token),
      payment: { status: "PAID" }
    },
    select: {
      receiptNumber: true,
      transactionId: true,
      amount: true,
      currency: true,
      paidAt: true,
      paymentMethod: true,
      payment: { select: { status: true } }
    }
  });
};

export const sendCustomerSubscriptionReceiptEmail = async (receiptId, {
  db = prisma,
  deliver = sendTrackedCustomerEmail
} = {}) => {
  const receipt = await db.customerSubscriptionReceipt.findUnique({
    where: { id: receiptId },
    include: {
      customer: { include: { portalAccount: true } },
      payment: true
    }
  });
  if (
    !receipt ||
    receipt.payment.status !== "PAID" ||
    !isStoredReceiptPdfValid(receipt)
  ) {
    return { status: "NOT_READY" };
  }

  const portalAccount = receipt.customer.portalAccount;
  const to =
    portalAccount?.emailVerifiedAt && typeof portalAccount.email === "string"
      ? portalAccount.email.trim()
      : "";
  const email = customerEmailTemplate("PAYMENT_RECEIPT", {
    fullName: receipt.customerName || receipt.customer.name,
    receiptNumber: receipt.receiptNumber,
    currency: receipt.currency,
    amount: Number(receipt.amount).toFixed(2),
    paymentDate: formatDate(receipt.paidAt, { time: true }),
    paymentMethod: receipt.paymentMethod || receipt.payment.paymentMethod,
    transactionReference: receipt.transactionId
  });

  return deliver({
    accountId: portalAccount?.id,
    customerId: receipt.customerId,
    customerSubscriptionReceiptId: receipt.id,
    purpose: "PAYMENT_RECEIPT",
    to,
    ...email,
    attachments: [{
      filename: getCustomerReceiptPdfFilename(receipt.receiptNumber),
      content: Buffer.from(receipt.pdfBytes),
      contentType: "application/pdf"
    }]
  });
};
