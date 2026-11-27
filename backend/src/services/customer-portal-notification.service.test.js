import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReminderEmailPreview,
  notifyCustomerPayment,
  notifyCustomerReminder
} from "./customer-portal-notification.service.js";
import { buildCustomerReceiptPdf } from "./customer-receipt-pdf.service.js";

test("payment emails resolve each verified customer to their own account email", async () => {
  const accounts = new Map([
    ["customer-1", {
      id: "account-1",
      email: "customer-one@example.test",
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      fullName: "Customer One"
    }],
    ["customer-2", {
      id: "account-2",
      email: "customer-two@example.test",
      emailVerifiedAt: new Date("2026-01-02T00:00:00.000Z"),
      fullName: "Customer Two"
    }]
  ]);
  const lookups = [];
  const deliveries = [];
  const receipts = new Map();
  const db = {
    receipt: {
      findFirst: async ({ where }) => receipts.get(where.id) || null
    },
    customerPortalAccount: {
      findFirst: async ({ where }) => {
        lookups.push(where);
        return accounts.get(where.customerId) || null;
      }
    },
    customerNotification: {
      create: async ({ data }) => ({ id: `notification-${data.customerId}`, ...data })
    }
  };
  const deliver = async (email) => {
    deliveries.push(email);
    return { status: "SMTP_ACCEPTED" };
  };

  const firstReceipt = {
    id: "receipt-1",
    organisationId: "org-1",
    customerId: "customer-1",
    receiptNumber: "REC-001",
    amount: 25,
    currency: "INR",
    paymentMethod: "Cash",
    receiptDate: new Date("2026-01-03T00:00:00.000Z"),
    status: "POSTED"
  };
  const secondReceipt = {
    id: "receipt-2",
    organisationId: "org-1",
    customerId: "customer-2",
    receiptNumber: "REC-002",
    amount: 50,
    currency: "INR",
    paymentMethod: "UPI",
    receiptDate: new Date("2026-01-04T00:00:00.000Z"),
    status: "POSTED"
  };
  receipts.set(firstReceipt.id, firstReceipt);
  receipts.set(secondReceipt.id, secondReceipt);
  const dependencies = {
    db,
    deliver,
    buildReceiptPdf: async () => Buffer.from("%PDF-mocked")
  };
  const first = await notifyCustomerPayment(firstReceipt, dependencies);
  const second = await notifyCustomerPayment(secondReceipt, dependencies);

  assert.equal(first.emailStatus, "SMTP_ACCEPTED");
  assert.equal(second.emailStatus, "SMTP_ACCEPTED");
  assert.deepEqual(deliveries.map(({ to }) => to), [
    "customer-one@example.test",
    "customer-two@example.test"
  ]);
  assert.deepEqual(deliveries.map(({ customerId }) => customerId), [
    "customer-1",
    "customer-2"
  ]);
  assert.ok(lookups.every((where) => where.customer.organisationId === "org-1"));
});

test("missing or unverified portal accounts are never replaced with CRM recipients", async () => {
  const deliveries = [];
  const receipts = new Map();
  const db = {
    receipt: {
      findFirst: async ({ where }) => receipts.get(where.id) || null
    },
    customerPortalAccount: {
      findFirst: async ({ where }) => where.customerId === "customer-unverified"
        ? {
            id: "account-unverified",
            email: "unverified@example.test",
            emailVerifiedAt: null,
            fullName: "Unverified Customer"
          }
        : null
    },
    customerNotification: {
      create: async ({ data }) => ({ id: "notification-1", ...data })
    }
  };
  const deliver = async (email) => {
    deliveries.push(email);
    return { status: "SKIPPED" };
  };

  const unverifiedReceipt = {
    id: "receipt-1",
    organisationId: "org-1",
    customerId: "customer-unverified",
    receiptNumber: "REC-001",
    amount: 25,
    currency: "INR",
    receiptDate: new Date("2026-01-03T00:00:00.000Z"),
    status: "POSTED"
  };
  const missingReceipt = {
    id: "receipt-2",
    organisationId: "org-1",
    customerId: "customer-missing",
    receiptNumber: "REC-002",
    amount: 50,
    currency: "INR",
    receiptDate: new Date("2026-01-04T00:00:00.000Z"),
    status: "POSTED"
  };
  receipts.set(unverifiedReceipt.id, unverifiedReceipt);
  receipts.set(missingReceipt.id, missingReceipt);
  const dependencies = {
    db,
    deliver,
    buildReceiptPdf: async () => Buffer.from("%PDF-mocked")
  };
  const unverified = await notifyCustomerPayment(unverifiedReceipt, dependencies);
  const missing = await notifyCustomerPayment(missingReceipt, dependencies);

  assert.equal(unverified.emailStatus, "ACCOUNT_UNVERIFIED");
  assert.equal(missing.emailStatus, "NO_PORTAL_ACCOUNT");
  assert.deepEqual(deliveries.map(({ to }) => to), ["", ""]);
  assert.deepEqual(deliveries.map(({ customerId }) => customerId), [
    "customer-unverified",
    "customer-missing"
  ]);
});

test("posted payment email attaches the existing branded PDF and links to the authenticated receipt download", async () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = "https://portal.example.test";
  const pdfReceipt = {
    id: "receipt-attachment-1",
    customerId: "customer-1",
    organisationId: "org-1",
    receiptNumber: "REC-ATTACH-001",
    receiptDate: new Date("2026-11-27T05:33:00.000Z"),
    amount: 125,
    currency: "INR",
    paymentMethod: "UPI",
    transactionReference: "payment-ref-001",
    status: "POSTED",
    customer: {
      name: "Portal Customer",
      email: "customer@example.test",
      phone: "+91 9000000000",
      billingAddress: "Test address",
      taxRegistration: null
    },
    allocations: []
  };
  const delivered = [];
  const db = {
    receipt: { findFirst: async () => pdfReceipt },
    customerPortalAccount: {
      findFirst: async () => ({
        id: "account-1",
        email: "verified@example.test",
        emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
        fullName: "Portal Customer"
      })
    },
    customerNotification: {
      create: async ({ data }) => ({ id: "notification-1", ...data })
    }
  };
  try {
    const pdfBytes = await buildCustomerReceiptPdf(pdfReceipt);
    const result = await notifyCustomerPayment({
      ...pdfReceipt,
      customerId: "customer-1",
      organisationId: "org-1"
    }, {
      db,
      buildReceiptPdf: async (receipt) => {
        assert.equal(receipt.id, pdfReceipt.id);
        return pdfBytes;
      },
      deliver: async (email) => {
        delivered.push(email);
        return { status: "SMTP_ACCEPTED" };
      }
    });

    assert.equal(result.emailStatus, "SMTP_ACCEPTED");
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].to, "verified@example.test");
    assert.equal(
      delivered[0].attachments[0].filename,
      "AURON-COLLECT-Payment-Receipt-REC-ATTACH-001.pdf"
    );
    assert.equal(delivered[0].attachments[0].contentType, "application/pdf");
    assert.ok(Buffer.isBuffer(delivered[0].attachments[0].content));
    assert.equal(delivered[0].attachments[0].content.toString("ascii", 0, 5), "%PDF-");
    assert.deepEqual(delivered[0].attachments[0].content, pdfBytes);
    assert.match(delivered[0].text, /receipt REC-ATTACH-001/i);
    assert.match(delivered[0].text, /INR 125\.00/);
    assert.match(delivered[0].text, /UPI/);
    assert.match(delivered[0].text, /payment-ref-001/);
    assert.match(
      delivered[0].text,
      /https:\/\/portal\.example\.test\/\?customerPortal=1&receiptId=receipt-attachment-1/
    );
    assert.match(delivered[0].html, /Download receipt/);
  } finally {
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
  }
});

test("non-posted receipt notifications never render a PDF or invoke email delivery", async () => {
  let emailCalls = 0;
  const result = await notifyCustomerPayment({
    id: "pending-receipt",
    status: "PENDING"
  }, {
    db: {
      receipt: {
        findFirst: async () => {
          throw new Error("Non-posted receipts must not be loaded for email.");
        }
      }
    },
    buildReceiptPdf: async () => {
      throw new Error("Non-posted receipts must not render a PDF.");
    },
    deliver: async () => {
      emailCalls += 1;
    }
  });

  assert.equal(result.emailStatus, "NOT_APPLICABLE");
  assert.equal(emailCalls, 0);
});

test("manual preview and delivery use the same verified recipient and reminder template", async () => {
  const account = {
    id: "account-1",
    email: "verified@example.test",
    emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    fullName: "Customer One"
  };
  const invoice = {
    id: "invoice-1",
    invoiceNumber: "INV-001",
    status: "ISSUED",
    total: 125,
    dueDate: new Date("2026-11-30T00:00:00.000Z"),
    currency: "INR"
  };
  const reminder = {
    id: "reminder-1",
    organisationId: "org-1",
    customerId: "customer-1",
    invoiceId: "invoice-1",
    dedupeKey: "invoice:INV-001:OVERDUE_1_DAY",
    subject: "Overdue payment reminder",
    message: "Reminder fallback message",
    invoice,
    outstanding: 125
  };
  const deliveries = [];
  let manualDeliveryAuthorized = false;
  const db = {
    customerPortalAccount: {
      findFirst: async () => account
    },
    invoice: {
      findFirst: async () => invoice
    },
    receiptAllocation: {
      aggregate: async () => ({ _sum: { amount: 0 } })
    },
    creditAdjustment: {
      aggregate: async () => ({ _sum: { amount: 0 } })
    },
    customerNotification: {
      upsert: async ({ create }) => ({ id: "notification-1", ...create }),
      update: async () => ({})
    }
  };

  const preview = await buildReminderEmailPreview(reminder, { db });
  const result = await notifyCustomerReminder(reminder, {
    db,
    manualSend: true,
    deliver: async (email, options) => {
      deliveries.push(email);
      manualDeliveryAuthorized = options.manualSend;
      return { status: "SMTP_ACCEPTED", acceptedAt: new Date() };
    }
  });

  assert.equal(preview.status, "READY");
  assert.equal(preview.recipient, "verified@example.test");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].to, preview.recipient);
  assert.equal(deliveries[0].subject, preview.subject);
  assert.equal(deliveries[0].text, preview.message);
  assert.equal(manualDeliveryAuthorized, true);
  assert.equal(result.emailStatus, "SMTP_ACCEPTED");
});

test("manual email preview refuses missing or unverified portal recipients", async () => {
  const reminder = {
    id: "reminder-1",
    organisationId: "org-1",
    customerId: "customer-1",
    invoiceId: "invoice-1"
  };
  const db = {
    customerPortalAccount: {
      findFirst: async () => ({
        email: "unverified@example.test",
        emailVerifiedAt: null
      })
    },
    invoice: {
      findFirst: async () => {
        throw new Error("Invoice lookup should not happen without a verified recipient");
      }
    }
  };

  const preview = await buildReminderEmailPreview(reminder, { db });

  assert.equal(preview.status, "WAITING_FOR_VERIFIED_EMAIL");
  assert.equal(preview.errorMessage, "A verified customer portal email is required.");
});
