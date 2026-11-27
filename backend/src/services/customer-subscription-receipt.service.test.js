import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  isStoredReceiptPdfValid,
  renderOfficialSubscriptionReceipt,
  sendCustomerSubscriptionReceiptEmail
} from "./customer-subscription-receipt.service.js";

test("official subscription receipt PDF contains a QR and valid PDF payload", async () => {
  const pdf = await renderOfficialSubscriptionReceipt({
    receipt: {
      receiptNumber: "CS-REC-test",
      transactionId: "pay_test",
      customerName: "Receipt Test Customer",
      customerEmail: "receipt@example.test",
      amount: "125.00",
      currency: "INR",
      paymentMethod: "card",
      paidAt: new Date("2026-11-26T04:30:00.000Z")
    },
    payment: {
      status: "PAID",
      planName: "Professional",
      billingCycle: "MONTHLY",
      periodStart: new Date("2026-11-26T04:30:00.000Z"),
      periodEnd: new Date("2026-12-26T04:30:00.000Z")
    },
    customer: { id: "customer-test", name: "Receipt Test Customer" },
    verificationUrl: "https://api.example.test/api/receipts/verify/token"
  });

  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 10000);
  const receipt = {
    pdfBytes: pdf,
    verificationTokenHash: "hashed-token",
    pdfSha256: createHash("sha256").update(pdf).digest("hex")
  };
  assert.equal(isStoredReceiptPdfValid(receipt), true);
  assert.equal(isStoredReceiptPdfValid({ ...receipt, pdfSha256: "invalid" }), false);
  assert.equal(isStoredReceiptPdfValid({ ...receipt, verificationTokenHash: null }), false);
});

test("subscription receipts email the current verified account, not receipt or CRM snapshots", async () => {
  const pdfBytes = Buffer.from("%PDF-test receipt");
  const receipts = new Map([
    ["receipt-1", {
      id: "receipt-1",
      pdfBytes,
      pdfSha256: createHash("sha256").update(pdfBytes).digest("hex"),
      verificationTokenHash: "hashed-token-1",
      receiptNumber: "CS-REC-001",
      customerId: "customer-1",
      customerName: "Customer One",
      customerEmail: "old-snapshot@example.test",
      amount: "25.00",
      currency: "INR",
      paidAt: new Date("2026-11-26T04:30:00.000Z"),
      payment: { status: "PAID" },
      customer: {
        name: "Customer One",
        email: "crm-one@example.test",
        portalAccount: {
          id: "account-1",
          email: "current-one@example.test",
          emailVerifiedAt: new Date("2026-11-27T00:00:00.000Z")
        }
      }
    }],
    ["receipt-2", {
      id: "receipt-2",
      pdfBytes,
      pdfSha256: createHash("sha256").update(pdfBytes).digest("hex"),
      verificationTokenHash: "hashed-token-2",
      receiptNumber: "CS-REC-002",
      customerId: "customer-2",
      customerName: "Customer Two",
      customerEmail: "snapshot-two@example.test",
      amount: "50.00",
      currency: "INR",
      paidAt: new Date("2026-11-26T04:30:00.000Z"),
      payment: { status: "PAID" },
      customer: {
        name: "Customer Two",
        email: "crm-two@example.test",
        portalAccount: {
          id: "account-2",
          email: "current-two@example.test",
          emailVerifiedAt: new Date("2026-11-27T00:00:00.000Z")
        }
      }
    }]
  ]);
  const deliveries = [];
  const db = {
    customerSubscriptionReceipt: {
      findUnique: async ({ where }) => receipts.get(where.id)
    }
  };
  const deliver = async (email) => {
    deliveries.push(email);
    return { status: "SMTP_ACCEPTED" };
  };

  await sendCustomerSubscriptionReceiptEmail("receipt-1", { db, deliver });
  await sendCustomerSubscriptionReceiptEmail("receipt-2", { db, deliver });

  assert.deepEqual(deliveries.map(({ to }) => to), [
    "current-one@example.test",
    "current-two@example.test"
  ]);
  assert.deepEqual(deliveries.map(({ accountId, customerId }) => ({
    accountId,
    customerId
  })), [
    { accountId: "account-1", customerId: "customer-1" },
    { accountId: "account-2", customerId: "customer-2" }
  ]);
  assert.deepEqual(
    deliveries.map(({ attachments }) => attachments[0].content),
    [pdfBytes, pdfBytes]
  );
  assert.deepEqual(
    deliveries.map(({ attachments }) => attachments[0].filename),
    [
      "AURON-COLLECT-Payment-Receipt-CS-REC-001.pdf",
      "AURON-COLLECT-Payment-Receipt-CS-REC-002.pdf"
    ]
  );
  assert.ok(deliveries.every(({ attachments }) =>
    attachments[0].contentType === "application/pdf"
  ));
});

test("subscription receipt email does not fall back when the portal email is unverified", async () => {
  const pdfBytes = Buffer.from("%PDF-test receipt");
  const receipt = {
    id: "receipt-unverified",
    pdfBytes,
    pdfSha256: createHash("sha256").update(pdfBytes).digest("hex"),
    verificationTokenHash: "hashed-token",
    receiptNumber: "CS-REC-UNVERIFIED",
    customerId: "customer-unverified",
    customerEmail: "snapshot@example.test",
    amount: "25.00",
    currency: "INR",
    paidAt: new Date("2026-11-26T04:30:00.000Z"),
    payment: { status: "PAID" },
    customer: {
      name: "Unverified Customer",
      email: "crm@example.test",
      portalAccount: {
        id: "account-unverified",
        email: "unverified@example.test",
        emailVerifiedAt: null
      }
    }
  };
  let delivery;
  await sendCustomerSubscriptionReceiptEmail("receipt-unverified", {
    db: {
      customerSubscriptionReceipt: {
        findUnique: async () => receipt
      }
    },
    deliver: async (email) => {
      delivery = email;
      return { status: "SKIPPED" };
    }
  });

  assert.equal(delivery.to, "");
  assert.equal(delivery.customerId, "customer-unverified");
});

test("pending and failed subscription payments never produce receipt emails", async () => {
  const pdfBytes = Buffer.from("%PDF-test receipt");
  let deliveryCalls = 0;
  for (const status of ["PENDING", "FAILED"]) {
    const result = await sendCustomerSubscriptionReceiptEmail(`receipt-${status}`, {
      db: {
        customerSubscriptionReceipt: {
          findUnique: async () => ({
            id: `receipt-${status}`,
            pdfBytes,
            pdfSha256: createHash("sha256").update(pdfBytes).digest("hex"),
            verificationTokenHash: "hashed-token",
            payment: { status },
            customer: { portalAccount: null }
          })
        }
      },
      deliver: async () => {
        deliveryCalls += 1;
        return { status: "SMTP_ACCEPTED" };
      }
    });

    assert.deepEqual(result, { status: "NOT_READY" });
  }
  assert.equal(deliveryCalls, 0);
});
