import assert from "node:assert/strict";
import test from "node:test";
import { renderBillingPdf } from "./customer-subscription.controller.js";

const customer = {
  name: "PDF Test Customer",
  email: "customer@example.invalid",
  phone: "+15550000000",
  billingAddress: "1 Test Street",
  taxRegistration: "TEST-GST"
};
const payment = {
  id: "payment-1",
  planName: "Professional",
  billingCycle: "MONTHLY",
  amount: 1250,
  currency: "INR",
  taxTerms: "Charged amount, tax not inferred.",
  status: "PAID",
  paidAt: new Date("2026-01-10T00:00:00Z"),
  createdAt: new Date("2026-01-10T00:00:00Z"),
  periodStart: new Date("2026-01-10T00:00:00Z"),
  periodEnd: new Date("2026-02-10T00:00:00Z"),
  paymentMethod: "card",
  razorpayPaymentId: "pay_test_1",
  razorpayOrderId: "order_test_1"
};

test("subscription invoices and payment history render branded PDF documents", async () => {
  const invoicePdf = await renderBillingPdf({
    title: "Subscription tax invoice",
    reference: "CS-INV-test",
    customer,
    payment,
    invoice: {
      createdAt: payment.createdAt,
      planName: payment.planName,
      billingCycle: payment.billingCycle,
      amount: payment.amount,
      currency: payment.currency,
      taxTerms: payment.taxTerms,
      periodStart: payment.periodStart,
      periodEnd: payment.periodEnd
    }
  });
  const historyPdf = await renderBillingPdf({
    title: "Subscription payment history",
    reference: "HISTORY-test",
    customer,
    payments: [payment]
  });

  for (const pdf of [invoicePdf, historyPdf]) {
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.ok(pdf.length > 1000);
  }
});
