import assert from "node:assert/strict";
import test from "node:test";
import { createStaffPasswordResetHandlers } from "./staff-password-reset.controller.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

test("forgot password responses are identical and never disclose reset tokens", async () => {
  const handlers = createStaffPasswordResetHandlers({
    requestReset: async () => ({ status: "ACCEPTED", token: "must-not-be-returned" })
  });
  const registered = response();
  const unknown = response();

  await handlers.forgot({ body: { email: "staff@example.invalid" } }, registered);
  await handlers.forgot({ body: { email: "missing@example.invalid" } }, unknown);

  assert.equal(registered.statusCode, 202);
  assert.deepEqual(registered.body, unknown.body);
  assert.equal(JSON.stringify(registered.body).includes("must-not-be-returned"), false);
});

test("reset endpoint returns only a generic invalid-link message or reset confirmation", async () => {
  let nextStatus = "INVALID";
  const handlers = createStaffPasswordResetHandlers({
    resetPassword: async () => ({ status: nextStatus })
  });
  const invalid = response();
  await handlers.reset({ body: { token: "secret-token" } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body.message, /invalid, expired, or already used/i);
  assert.equal(JSON.stringify(invalid.body).includes("secret-token"), false);

  nextStatus = "RESET";
  const success = response();
  await handlers.reset({ body: {} }, success);
  assert.equal(success.statusCode, 200);
  assert.equal(success.body.message, "Your password was reset. Sign in with your new password.");
});
