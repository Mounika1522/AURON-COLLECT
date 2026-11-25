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
