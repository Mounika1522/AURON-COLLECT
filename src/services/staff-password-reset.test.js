import assert from "node:assert/strict";
import test from "node:test";
import { getStaffPasswordResetValidationError } from "./staff-password-reset.js";

test("staff reset validation matches the backend password policy", () => {
  assert.equal(
    getStaffPasswordResetValidationError("short", "short"),
    "Use at least 12 characters for your new password."
  );
  assert.equal(
    getStaffPasswordResetValidationError("lowercaseonly99", "lowercaseonly99"),
    "Use at least three character types: lowercase, uppercase, numbers, or symbols."
  );
  assert.equal(
    getStaffPasswordResetValidationError("A1!a".repeat(19), "A1!a".repeat(19)),
    "Your new password must fit within 72 UTF-8 bytes."
  );
  assert.equal(
    getStaffPasswordResetValidationError("Strong-Password-93!", "Strong-Password-92!"),
    "New password and confirmation do not match."
  );
  assert.equal(
    getStaffPasswordResetValidationError("Strong-Password-93!", "Strong-Password-93!"),
    ""
  );
});
