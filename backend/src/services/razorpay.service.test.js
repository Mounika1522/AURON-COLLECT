import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  assertRazorpayTestMode,
  verifyPaymentSignature,
  verifyWebhookSignature
} from "./razorpay.service.js";

test("Razorpay billing rejects live-mode keys and mode", () => {
  assert.throws(
    () => assertRazorpayTestMode({
      RAZORPAY_MODE: "live",
      RAZORPAY_KEY_ID: "rzp_live_example",
      RAZORPAY_KEY_SECRET: "not-a-real-secret"
    }),
    { code: "RAZORPAY_TEST_MODE_UNAVAILABLE" }
  );
  assert.throws(
    () => assertRazorpayTestMode({
      RAZORPAY_MODE: "test",
      RAZORPAY_KEY_ID: "rzp_live_example",
      RAZORPAY_KEY_SECRET: "not-a-real-secret"
    }),
    { code: "RAZORPAY_TEST_MODE_UNAVAILABLE" }
  );
});

test("payment and webhook signatures require the exact HMAC and raw body", () => {
  const paymentSecret = "unit-test-payment-secret";
  const orderId = "order_test_123";
  const paymentId = "pay_test_456";
  const paymentSignature = crypto
    .createHmac("sha256", paymentSecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  assert.equal(
    verifyPaymentSignature(orderId, paymentId, paymentSignature, paymentSecret),
    true
  );
  assert.equal(
    verifyPaymentSignature(orderId, paymentId, `${paymentSignature.slice(0, -1)}0`, paymentSecret),
    false
  );

  const webhookSecret = "unit-test-webhook-secret";
  const body = Buffer.from('{"event":"payment.captured"}');
  const webhookSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex");
  assert.equal(verifyWebhookSignature(body, webhookSignature, webhookSecret), true);
  assert.equal(
    verifyWebhookSignature(Buffer.from(`${body.toString()} `), webhookSignature, webhookSecret),
    false
  );
  assert.equal(
    verifyWebhookSignature(body.toString(), webhookSignature, webhookSecret),
    false
  );
});
