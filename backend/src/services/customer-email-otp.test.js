import test from "node:test";
import assert from "node:assert/strict";
import {
  createCustomerEmailOtp,
  hashCustomerEmailOtp,
  matchesCustomerEmailOtp
} from "./customer-email-otp.js";

test("customer email OTPs are six digits and are stored only as keyed hashes", () => {
  const otp = createCustomerEmailOtp();
  const secret = "test-only-secret-for-email-otp";
  const hash = hashCustomerEmailOtp(otp, secret);

  assert.match(otp, /^\d{6}$/);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, otp);
  assert.equal(matchesCustomerEmailOtp(otp, hash, secret), true);
  assert.equal(matchesCustomerEmailOtp("000000", hash, secret), false);
  assert.equal(matchesCustomerEmailOtp(otp, "not-a-hash", secret), false);
});
