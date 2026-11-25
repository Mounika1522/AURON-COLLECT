import test from "node:test";
import assert from "node:assert/strict";

import {
  assertEmailDeliveryEnabled,
  assertNotificationDeliveryEnabled,
  assertSafeDevelopmentDatabase,
  isAllowedTestEmailRecipient,
  isEmailPurposeEnabled,
  isNotificationDeliveryEnabled,
  isReminderSchedulerEnabled,
  TEST_EMAIL_PURPOSE
} from "./runtime-safety.js";
import { sendEmail } from "../services/email.service.js";
import { sendSMS } from "../services/messaging/sms.service.js";
import { sendWhatsApp } from "../services/messaging/whatsapp.service.js";
import { startReminderScheduler } from "../services/reminder.scheduler.js";

test("notification delivery is disabled unless explicitly set to live", () => {
  assert.equal(isNotificationDeliveryEnabled({}), false);
  assert.equal(
    isNotificationDeliveryEnabled({ NOTIFICATION_DELIVERY_MODE: "disabled" }),
    false
  );
  assert.equal(
    isNotificationDeliveryEnabled({ NOTIFICATION_DELIVERY_MODE: "live" }),
    true
  );
  assert.throws(() => assertNotificationDeliveryEnabled({}), /disabled/);
});

test("reminder scheduler requires explicit scheduler and live-delivery opt-ins", () => {
  assert.equal(isReminderSchedulerEnabled({}), false);
  assert.equal(
    isReminderSchedulerEnabled({
      REMINDER_SCHEDULER_ENABLED: "true",
      NOTIFICATION_DELIVERY_MODE: "disabled"
    }),
    false
  );
  assert.equal(
    isReminderSchedulerEnabled({
      REMINDER_SCHEDULER_ENABLED: "true",
      NOTIFICATION_DELIVERY_MODE: "live"
    }),
    true
  );
});

test("auth email delivery allows verification and reset only when explicitly enabled", () => {
  const env = {
    NOTIFICATION_DELIVERY_MODE: "disabled",
    AUTH_EMAIL_DELIVERY_ENABLED: "true",
    REMINDER_SCHEDULER_ENABLED: "false"
  };

  for (const purpose of ["EMAIL_VERIFICATION", "PASSWORD_RESET"]) {
    assert.equal(isEmailPurposeEnabled(purpose, env), true);
    assert.doesNotThrow(() => assertEmailDeliveryEnabled(purpose, env));
  }

  for (const purpose of [
    "INVOICE_GENERATED",
    "INVOICE_UPDATED",
    "PAYMENT_RECEIVED",
    "RECEIPT_CREATED",
    "PAYMENT_REMINDER:BEFORE_DUE",
    "TEST_EMAIL",
    undefined
  ]) {
    assert.equal(isEmailPurposeEnabled(purpose, env), false);
    assert.throws(
      () => assertEmailDeliveryEnabled(purpose, env),
      /disabled for this purpose/
    );
  }

  assert.equal(isReminderSchedulerEnabled(env), false);
});

test("auth email delivery stays disabled unless its purpose flag is enabled", () => {
  const env = {
    NOTIFICATION_DELIVERY_MODE: "disabled",
    AUTH_EMAIL_DELIVERY_ENABLED: "false"
  };

  assert.equal(isEmailPurposeEnabled("EMAIL_VERIFICATION", env), false);
  assert.equal(isEmailPurposeEnabled("PASSWORD_RESET", env), false);
});

test("test email delivery is limited to the exact allowlist in development", () => {
  const env = {
    NODE_ENV: "development",
    NOTIFICATION_DELIVERY_MODE: "disabled",
    REMINDER_SCHEDULER_ENABLED: "false"
  };
  const allowedRecipients = [
    "mounikakodige@gmail.com",
    "gogulakusuma@gmail.com"
  ];

  for (const recipient of allowedRecipients) {
    assert.equal(isAllowedTestEmailRecipient(recipient), true);
    assert.equal(
      isEmailPurposeEnabled(TEST_EMAIL_PURPOSE, env, recipient),
      true
    );
    assert.doesNotThrow(() =>
      assertEmailDeliveryEnabled(TEST_EMAIL_PURPOSE, env, recipient)
    );
  }

  for (const recipient of [
    "other@example.com",
    "mounikakodige@gmail.com,gogulakusuma@gmail.com",
    ["mounikakodige@gmail.com"],
    "Mounikakodige@gmail.com"
  ]) {
    assert.equal(isAllowedTestEmailRecipient(recipient), false);
    assert.equal(
      isEmailPurposeEnabled(TEST_EMAIL_PURPOSE, env, recipient),
      false
    );
    assert.throws(
      () => assertEmailDeliveryEnabled(TEST_EMAIL_PURPOSE, env, recipient),
      /disabled for this purpose/
    );
  }

  assert.equal(
    isEmailPurposeEnabled(TEST_EMAIL_PURPOSE, {
      ...env,
      NODE_ENV: "production"
    }, allowedRecipients[0]),
    false
  );
  assert.equal(isNotificationDeliveryEnabled(env), false);
  assert.equal(isReminderSchedulerEnabled(env), false);
});

test("development startup refuses the preserved database", () => {
  assert.throws(
    () =>
      assertSafeDevelopmentDatabase({
        NODE_ENV: "development",
        DATABASE_URL:
          "postgresql://user:password@localhost:5432/auron_collect_app?schema=public"
      }),
    /preserved auron_collect_app database/
  );
});

test("development startup accepts a separate PostgreSQL database", () => {
  assert.doesNotThrow(() =>
    assertSafeDevelopmentDatabase({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://user:password@localhost:5432/auron_collect_app_dev?schema=public"
    })
  );
});

test("production startup can use the configured production database", () => {
  assert.doesNotThrow(() =>
    assertSafeDevelopmentDatabase({
      NODE_ENV: "production",
      DATABASE_URL:
        "postgresql://user:password@db.example:5432/auron_collect_app?schema=public"
    })
  );
});

test("notification providers refuse delivery in safe mode", async () => {
  const previousMode = process.env.NOTIFICATION_DELIVERY_MODE;
  const previousAuthEmailSetting = process.env.AUTH_EMAIL_DELIVERY_ENABLED;
  process.env.NOTIFICATION_DELIVERY_MODE = "disabled";
  process.env.AUTH_EMAIL_DELIVERY_ENABLED = "true";

  try {
    await assert.rejects(
      sendEmail({
        purpose: "INVOICE_GENERATED",
        to: "test@example.com",
        subject: "Test",
        text: "Test"
      }),
      /disabled for this purpose/
    );
    await assert.rejects(
      sendEmail({
        purpose: "PAYMENT_RECEIVED",
        to: "test@example.com",
        subject: "Test",
        text: "Test"
      }),
      /disabled for this purpose/
    );
    await assert.rejects(
      sendSMS({ to: "0000000000", message: "Test" }),
      /delivery is disabled/
    );
    await assert.rejects(
      sendWhatsApp({ to: "0000000000", message: "Test" }),
      /delivery is disabled/
    );
  } finally {
    if (previousMode === undefined) {
      delete process.env.NOTIFICATION_DELIVERY_MODE;
    } else {
      process.env.NOTIFICATION_DELIVERY_MODE = previousMode;
    }
    if (previousAuthEmailSetting === undefined) {
      delete process.env.AUTH_EMAIL_DELIVERY_ENABLED;
    } else {
      process.env.AUTH_EMAIL_DELIVERY_ENABLED = previousAuthEmailSetting;
    }
  }
});

test("reminder scheduler does not start in safe mode", () => {
  const previousSchedulerSetting = process.env.REMINDER_SCHEDULER_ENABLED;
  const previousDeliveryMode = process.env.NOTIFICATION_DELIVERY_MODE;
  process.env.REMINDER_SCHEDULER_ENABLED = "false";
  process.env.NOTIFICATION_DELIVERY_MODE = "disabled";

  try {
    assert.equal(startReminderScheduler(), null);
  } finally {
    if (previousSchedulerSetting === undefined) {
      delete process.env.REMINDER_SCHEDULER_ENABLED;
    } else {
      process.env.REMINDER_SCHEDULER_ENABLED = previousSchedulerSetting;
    }
    if (previousDeliveryMode === undefined) {
      delete process.env.NOTIFICATION_DELIVERY_MODE;
    } else {
      process.env.NOTIFICATION_DELIVERY_MODE = previousDeliveryMode;
    }
  }
});
