import assert from "node:assert/strict";
import test from "node:test";
import { getSmtpTransportOptions } from "./email.service.js";

const gmailConfig = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "587",
  SMTP_USER: "sender@example.test",
  SMTP_PASS: "test-app-password",
  EMAIL_FROM: "AURON COLLECT <sender@example.test>"
};

test("Gmail SMTP on port 587 requires TLS 1.2 or newer", () => {
  const options = getSmtpTransportOptions(gmailConfig);

  assert.equal(options.host, "smtp.gmail.com");
  assert.equal(options.port, 587);
  assert.equal(options.secure, false);
  assert.equal(options.requireTLS, true);
  assert.equal(options.tls.minVersion, "TLSv1.2");
});

test("SMTP on port 465 uses implicit TLS", () => {
  const options = getSmtpTransportOptions({
    ...gmailConfig,
    SMTP_PORT: "465"
  });

  assert.equal(options.secure, true);
  assert.equal(options.requireTLS, false);
  assert.equal(options.tls.minVersion, "TLSv1.2");
});

test("SMTP options reject missing configuration without inventing credentials", () => {
  assert.throws(
    () => getSmtpTransportOptions({ SMTP_HOST: "smtp.gmail.com" }),
    /SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM/
  );
});
