import crypto from "node:crypto";
import Razorpay from "razorpay";

const isHexSignature = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

const safeEqualHex = (provided, expected) => {
  if (!isHexSignature(provided) || !isHexSignature(expected)) return false;
  return crypto.timingSafeEqual(
    Buffer.from(provided, "hex"),
    Buffer.from(expected, "hex")
  );
};

export const assertRazorpayTestMode = (env = process.env) => {
  if (
    env.RAZORPAY_MODE !== "test" ||
    !env.RAZORPAY_KEY_ID?.startsWith("rzp_test_") ||
    !env.RAZORPAY_KEY_SECRET
  ) {
    const error = new Error("Razorpay test-mode configuration is unavailable");
    error.code = "RAZORPAY_TEST_MODE_UNAVAILABLE";
    throw error;
  }
};

export const createRazorpayClient = (env = process.env) => {
  assertRazorpayTestMode(env);
  return new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET
  });
};

export const verifyPaymentSignature = (
  orderId,
  paymentId,
  signature,
  secret = process.env.RAZORPAY_KEY_SECRET
) => {
  if (!orderId || !paymentId || !secret || !isHexSignature(signature)) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return safeEqualHex(signature, expected);
};

export const verifyWebhookSignature = (
  rawBody,
  signature,
  secret = process.env.RAZORPAY_WEBHOOK_SECRET
) => {
  if (
    !Buffer.isBuffer(rawBody) ||
    !secret ||
    !isHexSignature(signature)
  ) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return safeEqualHex(signature, expected);
};
