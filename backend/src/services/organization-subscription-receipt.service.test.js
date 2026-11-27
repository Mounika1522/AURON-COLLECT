import assert from "node:assert/strict";
import test from "node:test";
import { sendTrackedCustomerEmail } from "./customer-email-delivery.service.js";
import {
  sendOrganizationSubscriptionReceiptEmail
} from "./organization-subscription-receipt.service.js";

const mailEnv = {
  NODE_ENV: "production",
  SMTP_HOST: "smtp.example.invalid",
  SMTP_PORT: "587",
  SMTP_USER: "sender@example.invalid",
  SMTP_PASS: "test-only-password",
  EMAIL_FROM: "Auron Collect <sender@example.invalid>"
};

const createDatabase = (payment) => {
  const receipts = new Map();
  const attempts = new Map();
  return {
    receipts,
    attempts,
    billingPayment: {
      findFirst: async ({ where }) =>
        payment.status === where.status &&
        (!where.organisationId || payment.organisationId === where.organisationId)
          ? payment
          : null
    },
    billingPaymentReceipt: {
      findUnique: async ({ where }) => receipts.get(where.paymentId) || null,
      create: async ({ data }) => {
        if (receipts.has(data.paymentId)) {
          const error = new Error("Unique receipt");
          error.code = "P2002";
          throw error;
        }
        const receipt = { id: "receipt-1", ...data };
        receipts.set(data.paymentId, receipt);
        return receipt;
      }
    },
    emailDeliveryAttempt: {
      findUnique: async ({ where }) => attempts.get(where.billingPaymentId) || null,
      create: async ({ data }) => {
        if (attempts.has(data.billingPaymentId)) {
          const error = new Error("Unique email attempt");
          error.code = "P2002";
          throw error;
        }
        const attempt = { id: "attempt-1", ...data };
        attempts.set(data.billingPaymentId, attempt);
        return attempt;
      },
      update: async ({ where, data }) => {
        const attempt = [...attempts.values()].find(({ id }) => id === where.id);
        Object.assign(attempt, data);
        return attempt;
      }
    }
  };
};

const paidPayment = () => ({
  id: "billing-payment-1",
  organisationId: "org-1",
  customerId: "customer-1",
  amount: "999.00",
  currency: "INR",
  status: "PAID",
  billingCycle: "MONTHLY",
  paidAt: new Date("2026-11-27T06:00:00.000Z"),
  effectiveAt: new Date("2026-11-27T06:00:00.000Z"),
  periodEndsAt: new Date("2026-12-27T06:00:00.000Z"),
  razorpayPaymentId: "pay_test_1",
  plan: { name: "Starter" },
  invoice: {
    id: "invoice-1",
    invoiceNumber: "AC-202611-PAYMENT-1",
    createdAt: new Date("2026-11-27T06:00:00.000Z")
  },
  organisation: { name: "Auron Test Organisation" },
  customer: {
    name: "Verified Contact",
    portalAccount: {
      id: "account-1",
      fullName: "Verified Contact",
      email: "verified@example.invalid",
      emailVerifiedAt: new Date("2026-11-01T00:00:00.000Z")
    }
  }
});

test("paid organization subscription emails the stored official PDF once", async () => {
  const payment = paidPayment();
  const db = createDatabase(payment);
  const sent = [];
  let pdfBuilds = 0;
  const deliver = (email, options) => sendTrackedCustomerEmail(email, {
    ...options,
    deliver: async (message) => {
      sent.push(message);
      return { accepted: [message.to], messageId: "mock-nodemailer" };
    }
  });
  const buildPdf = async () => {
    pdfBuilds += 1;
    return Buffer.from("%PDF-test-official-receipt");
  };

  const first = await sendOrganizationSubscriptionReceiptEmail(payment.id, {
    db,
    env: mailEnv,
    deliver,
    buildPdf
  });
  const second = await sendOrganizationSubscriptionReceiptEmail(payment.id, {
    db,
    env: mailEnv,
    deliver,
    buildPdf
  });

  assert.equal(first.status, "SMTP_ACCEPTED");
  assert.equal(second.status, "ALREADY_ATTEMPTED");
  assert.equal(pdfBuilds, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "verified@example.invalid");
  assert.equal(sent[0].attachments[0].filename, "AURON-COLLECT-Subscription-Receipt-AC-202611-PAYMENT-1.pdf");
  assert.equal(sent[0].attachments[0].contentType, "application/pdf");
  assert.deepEqual(sent[0].attachments[0].content, Buffer.from("%PDF-test-official-receipt"));
  assert.equal(db.receipts.get(payment.id).pdfSha256.length, 64);
});

test("unpaid organization billing records cannot generate or email a receipt", async () => {
  const payment = { ...paidPayment(), status: "CREATED" };
  const db = createDatabase(payment);
  let pdfBuilds = 0;
  const result = await sendOrganizationSubscriptionReceiptEmail(payment.id, {
    db,
    env: mailEnv,
    deliver: async () => {
      throw new Error("Delivery must not run");
    },
    buildPdf: async () => {
      pdfBuilds += 1;
      return Buffer.from("%PDF-not-paid");
    }
  });

  assert.deepEqual(result, { status: "NOT_READY" });
  assert.equal(pdfBuilds, 0);
  assert.equal(db.receipts.size, 0);
  assert.equal(db.attempts.size, 0);
});
