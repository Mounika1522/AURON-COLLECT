import test from "node:test";
import assert from "node:assert/strict";
import { customerEmailTemplate } from "./customer-email-templates.js";

test("verification email contains a code and no verification link", () => {
  const message = customerEmailTemplate("VERIFY_EMAIL", {
    fullName: "Portal Test",
    otp: "046821"
  });

  assert.match(message.text, /046821/);
  assert.match(message.html, /046821/);
  assert.doesNotMatch(message.text, /customerVerify/);
  assert.doesNotMatch(message.html, /customerVerify|<a\b/i);
});

test("password reset email continues using its reset link", () => {
  const message = customerEmailTemplate("RESET_PASSWORD", {
    fullName: "Portal Test",
    token: "test-reset-token"
  });

  assert.match(message.text, /customerReset/);
  assert.match(message.html, /customerReset/);
});

test("subscription payment receipt email identifies the verified payment and attached PDF", () => {
  const message = customerEmailTemplate("PAYMENT_RECEIPT", {
    fullName: "Sandbox Receipt Test",
    receiptNumber: "CS-REC-sandbox",
    currency: "INR",
    amount: "1.00",
    paymentDate: "26 Nov 2026, 10:00 am",
    paymentMethod: "UPI",
    transactionReference: "payment-ref-001"
  });

  assert.match(message.subject, /official payment receipt CS-REC-sandbox/i);
  assert.match(message.text, /verified subscription payment/i);
  assert.match(message.text, /official PDF receipt is attached/i);
  assert.match(message.text, /UPI/);
  assert.match(message.text, /payment-ref-001/);
  assert.match(message.html, /official PDF receipt is attached/i);
});

test("captured payment notification identifies the receipt and amount", () => {
  const message = customerEmailTemplate("PAYMENT_RECEIVED", {
    fullName: "Portal Customer",
    receiptNumber: "REC-001",
    currency: "INR",
    amount: "125.00",
    paymentDate: "26 Nov 2026",
    paymentMethod: "UPI",
    transactionReference: "payment-ref-001",
    receiptDownloadUrl: "https://portal.example.test/?customerPortal=1&receiptId=receipt-1"
  });

  assert.match(message.subject, /receipt REC-001/i);
  assert.match(message.text, /Payment received/);
  assert.match(message.text, /INR 125.00/);
  assert.match(message.text, /UPI/);
  assert.match(message.text, /payment-ref-001/);
  assert.match(message.text, /PDF copy of the receipt is attached/);
  assert.match(message.text, /Download receipt: https:\/\/portal\.example\.test/);
  assert.match(message.html, /Download receipt/);
});

test("payment reminder includes required billing details and a secure customer portal link", () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = "https://portal.example.test";
  try {
    const message = customerEmailTemplate("PAYMENT_REMINDER", {
      fullName: "Portal Customer",
      subject: "Payment due: INV-001",
      message: "Your invoice is due.",
      details: "Payment reference: INV-001 · Outstanding amount: INR 125.00 · Due date: 30/11/2026"
    });

    assert.match(message.subject, /INV-001/);
    assert.match(message.text, /Portal Customer/);
    assert.match(message.text, /Payment reference: INV-001/);
    assert.match(message.text, /Outstanding amount: INR 125.00/);
    assert.match(message.text, /Due date: 30\/11\/2026/);
    assert.match(message.text, /https:\/\/portal\.example\.test\/\?customerPortal=1/);
    assert.match(message.html, /Open customer portal/);
  } finally {
    if (previousFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = previousFrontendUrl;
    }
  }
});

test("overdue reminder is distinct and identifies the overdue payment", () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = "https://portal.example.test";
  try {
    const message = customerEmailTemplate("OVERDUE_REMINDER", {
      fullName: "Portal Customer",
      subject: "Overdue payment reminder: Invoice INV-002",
      message: "Payment for invoice INV-002 is overdue.",
      details: "Payment reference: INV-002 · Outstanding amount: INR 125.00 · Due date: 30/11/2026"
    });

    assert.match(message.subject, /overdue/i);
    assert.match(message.text, /payment is overdue/i);
    assert.match(message.text, /Outstanding amount: INR 125.00/);
    assert.match(message.text, /https:\/\/portal\.example\.test\/\?customerPortal=1/);
    assert.match(message.html, /Your payment is overdue/);
  } finally {
    if (previousFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = previousFrontendUrl;
    }
  }
});
