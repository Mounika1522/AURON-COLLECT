import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerAssistantReply } from "./customer-assistant.service.js";

const context = {
  invoices: [{
    invoiceNumber: "INV-100",
    invoiceDate: new Date("2026-01-01T00:00:00Z"),
    dueDate: new Date("2026-01-31T00:00:00Z"),
    currency: "INR",
    total: 1200,
    paid: 200,
    outstanding: 1000,
    status: "Overdue"
  }],
  outstandingByCurrency: { INR: 1000 },
  openInvoiceCount: 1,
  overdueCount: 1,
  upcomingInvoice: null,
  payments: [{
    id: "payment-1",
    amount: 500,
    currency: "INR",
    status: "PAID",
    paidAt: new Date("2026-02-01T00:00:00Z"),
    razorpayPaymentId: "pay_test_1"
  }],
  subscription: null,
  plans: [],
  receiptCount: 0
};

test("customer assistant reports only the scoped invoice balance and invoice details", () => {
  assert.match(buildCustomerAssistantReply("What is my outstanding balance?", context), /₹1,000/);
  assert.match(buildCustomerAssistantReply("Tell me about INV-100", context), /INV-100 is overdue/);
});

test("customer assistant explains verified and unavailable payment states", () => {
  assert.match(buildCustomerAssistantReply("payment status", context), /server-side provider verification/);
  assert.match(buildCustomerAssistantReply("what plans can I upgrade to?", context), /no approved subscription plans/);
});

test("customer assistant explains organization-specific quarterly plans", () => {
  const reply = buildCustomerAssistantReply("What is the quarterly plan price?", {
    ...context,
    plans: [{
      name: "Configured plan",
      currency: "INR",
      quarterlyPrice: 300,
      monthlyPrice: null,
      halfYearlyPrice: null,
      yearlyPrice: null
    }]
  });
  assert.match(reply, /Configured plan/);
  assert.match(reply, /per quarter/);
});
