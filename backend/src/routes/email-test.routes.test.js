import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import emailTestRoutes, { getTestEmailRecipient } from "./email-test.routes.js";

test("email test endpoints require staff authentication before access", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/email-test", emailTestRoutes);
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const verify = await fetch(`${baseUrl}/api/email-test/verify`);
    const send = await fetch(`${baseUrl}/api/email-test/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "recipient@example.invalid" })
    });

    assert.equal(verify.status, 401);
    assert.equal(send.status, 401);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("test email request accepts only one exact allowlisted recipient", () => {
  assert.equal(
    getTestEmailRecipient({ to: "mounikakodige@gmail.com" }),
    "mounikakodige@gmail.com"
  );
  assert.equal(
    getTestEmailRecipient({ to: "gogulakusuma@gmail.com" }),
    "gogulakusuma@gmail.com"
  );

  for (const body of [
    { to: "other@example.com" },
    { to: ["mounikakodige@gmail.com"] },
    { to: "mounikakodige@gmail.com,gogulakusuma@gmail.com" },
    { to: "mounikakodige@gmail.com", cc: "other@example.com" },
    { to: "mounikakodige@gmail.com", BCC: "other@example.com" },
    { to: "mounikakodige@gmail.com", recipients: ["other@example.com"] },
    { to: "mounikakodige@gmail.com", extra: true },
    null
  ]) {
    assert.throws(() => getTestEmailRecipient(body));
  }
});
