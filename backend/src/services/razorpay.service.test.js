import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  assertRazorpayConfiguration,
  assertRazorpayTestMode,
  getRazorpayConfigurationStatus,
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

test("Razorpay configuration accepts matching test or live credentials without exposing secrets", () => {
  const testConfiguration = {
    RAZORPAY_MODE: "test",
    RAZORPAY_KEY_ID: "rzp_test_example",
    RAZORPAY_KEY_SECRET: "test-secret"
  };
  const liveConfiguration = {
    RAZORPAY_MODE: "live",
    RAZORPAY_KEY_ID: "rzp_live_example",
    RAZORPAY_KEY_SECRET: "live-secret"
  };

  assert.deepEqual(getRazorpayConfigurationStatus(testConfiguration), {
    available: true,
    mode: "test"
  });
  assert.deepEqual(getRazorpayConfigurationStatus(liveConfiguration), {
    available: true,
    mode: "live"
  });
  assert.doesNotThrow(() => assertRazorpayConfiguration(testConfiguration));
  assert.doesNotThrow(() => assertRazorpayConfiguration(liveConfiguration));
  assert.deepEqual(getRazorpayConfigurationStatus({
    ...testConfiguration,
    RAZORPAY_KEY_ID: "rzp_live_example"
  }), {
    available: false,
    mode: null
  });
  assert.deepEqual(getRazorpayConfigurationStatus({
    RAZORPAY_MODE: "test"
  }), {
    available: false,
    mode: null
  });
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
