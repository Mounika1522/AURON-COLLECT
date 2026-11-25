import crypto from "node:crypto";

export const CUSTOMER_EMAIL_OTP_TTL_MS = 5 * 60 * 1000;
export const CUSTOMER_EMAIL_OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const CUSTOMER_EMAIL_OTP_MAX_ATTEMPTS = 5;

export const createCustomerEmailOtp = () =>
  crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");

export const hashCustomerEmailOtp = (otp, secret = process.env.JWT_SECRET) => {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("JWT_SECRET is required for customer email OTP hashing.");
  }

  return crypto
    .createHmac("sha256", secret)
    .update(`customer-email-verification:v1:${otp}`)
    .digest("hex");
};

export const matchesCustomerEmailOtp = (
  otp,
  storedHash,
  secret = process.env.JWT_SECRET
) => {
  if (typeof storedHash !== "string" || !/^[a-f0-9]{64}$/i.test(storedHash)) {
    return false;
  }

  const submittedHash = Buffer.from(hashCustomerEmailOtp(otp, secret), "hex");
  const expectedHash = Buffer.from(storedHash, "hex");
  return crypto.timingSafeEqual(submittedHash, expectedHash);
};
