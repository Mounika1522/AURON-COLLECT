import assert from "node:assert/strict";
import test from "node:test";
import { getSmtpTransportOptions, sendEmail } from "./email.service.js";

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

test("development customer verification uses the purpose-specific opt-in", async () => {
  const message = {
    purpose: "EMAIL_VERIFICATION",
    to: "entered@example.test",
    subject: "Verify",
    text: "One-time code"
  };
  const env = {
    NODE_ENV: "development",
    ENABLE_DEV_CUSTOMER_VERIFICATION_EMAIL: "true",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_USER: "sender@example.test",
    SMTP_PASS: "test-password",
    EMAIL_FROM: "sender@example.test"
  };
  let sentMessage;
  const result = await sendEmail(message, {
    env,
    allowDevelopmentCustomerVerification: true,
    transporterFactory: () => ({
      sendMail: async (mail) => {
        sentMessage = mail;
        return { accepted: [message.to], messageId: "test-message" };
      }
    })
  });

  assert.equal(result.messageId, "test-message");
  assert.equal(sentMessage.to, message.to);
  assert.equal(sentMessage.from, env.EMAIL_FROM);
});
