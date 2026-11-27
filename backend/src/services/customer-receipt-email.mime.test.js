import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import test from "node:test";
import { notifyCustomerPayment } from "./customer-portal-notification.service.js";
import {
  renderOfficialSubscriptionReceipt,
  sendCustomerSubscriptionReceiptEmail
} from "./customer-subscription-receipt.service.js";
import {
  buildCustomerReceiptPdf
} from "./customer-receipt-pdf.service.js";
import { sendTrackedCustomerEmail } from "./customer-email-delivery.service.js";
import { sendEmail } from "./email.service.js";

const smtpEnv = {
  NODE_ENV: "production",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_USER: "sender@example.test",
  SMTP_PASS: "test-password",
  EMAIL_FROM: "AURON COLLECT <sender@example.test>"
};

const createTrackedMimeDelivery = () => {
  const attempts = [];
  const messages = [];
  let nextAttemptId = 0;
  const db = {
    emailDeliveryAttempt: {
      findFirst: async () => null,
      create: async ({ data }) => {
        const attempt = { id: `mime-attempt-${++nextAttemptId}`, ...data };
        attempts.push(attempt);
        return attempt;
      },
      update: async ({ where, data }) => {
        const attempt = attempts.find(({ id }) => id === where.id);
        assert.ok(attempt);
        Object.assign(attempt, data);
        return attempt;
      }
    }
  };
  const transporterFactory = () => {
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "windows"
    });
    return {
      sendMail: async (message) => {
        const info = await transport.sendMail(message);
        messages.push(info.message);
        return {
          ...info,
          accepted: [message.to],
          messageId: "mock-stream-transport"
        };
      }
    };
  };

  return {
    attempts,
    messages,
    deliver: (email) => sendTrackedCustomerEmail(email, {
      db,
      env: smtpEnv,
      deliver: (message) => sendEmail(message, {
        env: smtpEnv,
        transporterFactory
      })
    })
  };
};

const assertPdfMimeAttachment = (rawMessage, filename, expectedPdf) => {
  const mime = rawMessage.toString("latin1");
  assert.match(mime, /Content-Type: multipart\/mixed/i);
  const pdfPartStart = mime.indexOf("Content-Type: application/pdf");
  assert.notEqual(pdfPartStart, -1, "PDF MIME part must be present");
  const pdfPart = mime.slice(pdfPartStart);
  assert.match(pdfPart, /Content-Type: application\/pdf/i);
  assert.match(pdfPart, /Content-Transfer-Encoding: base64/i);
  assert.ok(
    pdfPart.includes(`filename="${filename}"`) ||
      pdfPart.includes(`filename=${filename}`),
    `expected attachment filename ${filename}`
  );

  const headerEnd = pdfPart.indexOf("\r\n\r\n");
  assert.notEqual(headerEnd, -1, "PDF MIME headers must end before its body");
  const nextBoundary = pdfPart.indexOf("\r\n--", headerEnd + 4);
  assert.notEqual(nextBoundary, -1, "PDF MIME part must end at a boundary");
  const encodedPdf = pdfPart
    .slice(headerEnd + 4, nextBoundary)
    .replace(/\r\n/g, "");
  assert.deepEqual(Buffer.from(encodedPdf, "base64"), expectedPdf);
};

test("standard PAYMENT_RECEIVED sends the portal PDF in the Nodemailer MIME message", async () => {
  const receipt = {
    id: "receipt-mime-1",
    organisationId: "org-mime-1",
    customerId: "customer-mime-1",
    receiptNumber: "REC-MIME-001",
    receiptDate: new Date("2026-11-27T05:33:00.000Z"),
    amount: 2400,
    currency: "INR",
    paymentMethod: "UPI",
    transactionReference: "payment-mime-001",
    status: "POSTED",
    customer: {
      name: "Mime Test Customer",
      email: "customer@example.test",
      phone: "+919000000000",
      billingAddress: "1 Test Street",
      taxRegistration: null
    },
    allocations: []
  };
  const tracked = createTrackedMimeDelivery();
  let generatedPdf;
  const result = await notifyCustomerPayment(receipt, {
    db: {
      receipt: { findFirst: async () => receipt },
      customerPortalAccount: {
        findFirst: async () => ({
          id: "account-mime-1",
          email: "verified@example.test",
          emailVerifiedAt: new Date("2026-11-01T00:00:00.000Z"),
          fullName: receipt.customer.name
        })
      },
      customerNotification: {
        create: async ({ data }) => ({ id: "notification-mime-1", ...data })
      }
    },
    deliver: tracked.deliver,
    buildReceiptPdf: async (value) => {
      generatedPdf = await buildCustomerReceiptPdf(value);
      return generatedPdf;
    }
  });

  assert.equal(result.emailStatus, "SMTP_ACCEPTED");
  assert.equal(tracked.messages.length, 1);
  assertPdfMimeAttachment(
    tracked.messages[0],
    "AURON-COLLECT-Payment-Receipt-REC-MIME-001.pdf",
    generatedPdf
  );
  const mime = tracked.messages[0].toString("latin1");
  assert.match(mime, /INR 2400\.00/);
  assert.match(mime, /UPI/);
  assert.match(mime, /payment-mime-001/);
});

test("successful customer-payment webhook receipt sends its stored official PDF in Nodemailer MIME", async () => {
  const pdfBytes = await renderOfficialSubscriptionReceipt({
    receipt: {
      receiptNumber: "CS-REC-MIME-001",
      transactionId: "pay-mime-001",
      customerName: "Mime Test Customer",
      customerEmail: "customer@example.test",
      amount: "125.00",
      currency: "INR",
      paymentMethod: "UPI",
      paidAt: new Date("2026-11-27T05:33:00.000Z")
    },
    payment: {
      status: "PAID",
      planName: "Professional",
      billingCycle: "MONTHLY",
      periodStart: new Date("2026-11-27T05:33:00.000Z"),
      periodEnd: new Date("2026-12-27T05:33:00.000Z")
    },
    customer: { id: "customer-mime-2", name: "Mime Test Customer" },
    verificationUrl: "https://api.example.test/api/receipts/verify/mime-token"
  });
  const receipt = {
    id: "subscription-receipt-mime-1",
    receiptNumber: "CS-REC-MIME-001",
    customerId: "customer-mime-2",
    pdfBytes,
    pdfSha256: createHash("sha256").update(pdfBytes).digest("hex"),
    verificationTokenHash: "stored-verification-token-hash",
    customerName: "Mime Test Customer",
    amount: "125.00",
    currency: "INR",
    paidAt: new Date("2026-11-27T05:33:00.000Z"),
    paymentMethod: "UPI",
    transactionId: "pay-mime-001",
    payment: { status: "PAID", paymentMethod: "UPI" },
    customer: {
      name: "Mime Test Customer",
      portalAccount: {
        id: "account-mime-2",
        email: "verified@example.test",
        emailVerifiedAt: new Date("2026-11-01T00:00:00.000Z")
      }
    }
  };
  const tracked = createTrackedMimeDelivery();
  const result = await sendCustomerSubscriptionReceiptEmail(
    receipt.id,
    {
      db: {
        customerSubscriptionReceipt: {
          findUnique: async () => receipt
        }
      },
      deliver: tracked.deliver
    }
  );

  assert.equal(result.status, "SMTP_ACCEPTED");
  assert.equal(tracked.messages.length, 1);
  assertPdfMimeAttachment(
    tracked.messages[0],
    "AURON-COLLECT-Payment-Receipt-CS-REC-MIME-001.pdf",
    pdfBytes
  );
  const mime = tracked.messages[0].toString("latin1");
  assert.match(mime, /INR 125\.00/);
  assert.match(mime, /UPI/);
  assert.match(mime, /pay-mime-001/);
});
