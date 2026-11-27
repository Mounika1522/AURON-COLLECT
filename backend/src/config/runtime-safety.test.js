import test from "node:test";
import assert from "node:assert/strict";

import {
  assertEmailDeliveryEnabled,
  assertNotificationDeliveryEnabled,
  assertSafeDevelopmentDatabase,
  areBackgroundSchedulersEnabled,
  getMissingSmtpConfiguration,
  isDevelopmentCustomerVerificationEmailEnabled,
  isDevelopmentReminderSchedulerEnabled,
  isEmailPurposeEnabled,
  isNotificationDeliveryEnabled,
  isSmtpConfigurationPresent,
  isReminderSchedulerEnabled,
  mergeMissingSmtpVariables
} from "./runtime-safety.js";
import { sendEmail } from "../services/email.service.js";
import { sendSMS } from "../services/messaging/sms.service.js";
import { sendWhatsApp } from "../services/messaging/whatsapp.service.js";
import { startReminderScheduler } from "../services/reminder.scheduler.js";

const productionSmtp = {
  NODE_ENV: "production",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_USER: "test-user",
  SMTP_PASS: "test-password",
  EMAIL_FROM: "billing@example.test"
};

test("development SMTP fallback copies only missing SMTP keys and preserves the dev database", () => {
  const env = {
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://localhost:5432/auron_collect_app_dev",
    SMTP_USER: "local-sender@example.test"
  };
  const source = {
    DATABASE_URL: "postgresql://localhost:5432/auron_collect_app",
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "587",
    SMTP_USER: "configured-sender@example.test",
    SMTP_PASS: "test-app-password",
    EMAIL_FROM: "AURON COLLECT <configured-sender@example.test>"
  };

  const loaded = mergeMissingSmtpVariables(env, source);

  assert.deepEqual(loaded, ["SMTP_HOST", "SMTP_PORT", "SMTP_PASS", "EMAIL_FROM"]);
  assert.equal(env.DATABASE_URL, "postgresql://localhost:5432/auron_collect_app_dev");
  assert.equal(env.SMTP_USER, "local-sender@example.test");
  assert.equal(env.SMTP_PASS, "test-app-password");
});

test("background schedulers remain enabled by default and can be disabled for safe local checks", () => {
  assert.equal(areBackgroundSchedulersEnabled({}), true);
  assert.equal(
    areBackgroundSchedulersEnabled({ DISABLE_BACKGROUND_SCHEDULERS: "true" }),
    false
  );
});

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

test("production reminder scheduler starts automatically when SMTP is configured", () => {
  assert.equal(isReminderSchedulerEnabled({}), false);
  assert.equal(
    isReminderSchedulerEnabled({ ...productionSmtp, SMTP_PASS: "" }),
    false
  );
  assert.equal(
    isReminderSchedulerEnabled(productionSmtp),
    true
  );
  assert.equal(isReminderSchedulerEnabled({
    ...productionSmtp,
    REMINDER_SCHEDULER_ENABLED: "false",
    NOTIFICATION_DELIVERY_MODE: "disabled"
  }), true);
  assert.equal(isReminderSchedulerEnabled({
    ...productionSmtp,
    DISABLE_BACKGROUND_SCHEDULERS: "true"
  }), false);
  assert.equal(isReminderSchedulerEnabled({
    ...productionSmtp,
    NODE_ENV: "development"
  }), false);
});

test("development reminder scheduling is separately opted in and scoped to reminders", () => {
  const developmentSmtp = {
    ...productionSmtp,
    NODE_ENV: "development",
    ENABLE_DEV_REMINDER_SCHEDULER: "true",
    DISABLE_BACKGROUND_SCHEDULERS: "true"
  };
  const reminderPurpose = "PAYMENT_REMINDER:scheduled-test";

  assert.equal(areBackgroundSchedulersEnabled(developmentSmtp), false);
  assert.equal(isDevelopmentReminderSchedulerEnabled(developmentSmtp), true);
  assert.equal(isReminderSchedulerEnabled(developmentSmtp), true);
  assert.equal(isEmailPurposeEnabled(reminderPurpose, developmentSmtp), false);
  assert.equal(isEmailPurposeEnabled(reminderPurpose, developmentSmtp, {
    allowDevelopmentReminderScheduler: true
  }), true);
  assert.equal(isEmailPurposeEnabled("PAYMENT_RECEIVED", developmentSmtp, {
    allowDevelopmentReminderScheduler: true
  }), false);
  assert.equal(isEmailPurposeEnabled(reminderPurpose, {
    ...developmentSmtp,
    ENABLE_DEV_REMINDER_SCHEDULER: "false"
  }, { allowDevelopmentReminderScheduler: true }), false);
  assert.equal(isEmailPurposeEnabled(reminderPurpose, {
    ...developmentSmtp,
    SMTP_PASS: ""
  }, { allowDevelopmentReminderScheduler: true }), false);

  const manualOnly = {
    ...developmentSmtp,
    ENABLE_DEV_REMINDER_SCHEDULER: undefined,
    ENABLE_DEV_EMAIL_DELIVERY: "true"
  };
  assert.equal(isReminderSchedulerEnabled(manualOnly), false);
  assert.equal(isEmailPurposeEnabled(reminderPurpose, manualOnly, {
    allowDevelopmentReminderScheduler: true
  }), false);
});

test("transactional customer emails require production SMTP configuration, not approval flags", () => {
  const purposes = [
    "EMAIL_VERIFICATION",
    "PASSWORD_RESET",
    "INVOICE_GENERATED",
    "INVOICE_UPDATED",
    "PAYMENT_RECEIVED",
    "PAYMENT_RECEIPT",
    "RECEIPT_CREATED",
    "PAYMENT_REMINDER:BEFORE_DUE"
  ];
  for (const purpose of purposes) {
    const env = {
      ...productionSmtp,
      NOTIFICATION_DELIVERY_MODE: "disabled",
      PAYMENT_RECEIPT_EMAIL_PRODUCTION_AUTHORIZED: "false",
      AUTH_EMAIL_DELIVERY_ENABLED: "false"
    };
    assert.equal(isEmailPurposeEnabled(purpose, env), true);
    assert.doesNotThrow(() => assertEmailDeliveryEnabled(purpose, env));
    assert.equal(isEmailPurposeEnabled(purpose, {
      ...productionSmtp,
      NODE_ENV: "development"
    }), false);
  }
  assert.equal(isEmailPurposeEnabled("PAYMENT_RECEIPT", {
    ...productionSmtp,
    SMTP_PASS: ""
  }), false);
  assert.throws(
    () => assertEmailDeliveryEnabled("PAYMENT_RECEIPT", { ...productionSmtp, SMTP_PASS: "" }),
    /disabled for this purpose/
  );
  assert.deepEqual(getMissingSmtpConfiguration({ ...productionSmtp, SMTP_PORT: "70000" }), ["SMTP_PORT"]);
  assert.equal(isSmtpConfigurationPresent(productionSmtp), true);
});

test("development email opt-in authorizes only explicitly manual sends with SMTP configured", () => {
  const developmentSmtp = {
    ...productionSmtp,
    NODE_ENV: "development",
    ENABLE_DEV_EMAIL_DELIVERY: "true"
  };
  const reminderPurpose = "PAYMENT_REMINDER:manual-test";

  assert.equal(isEmailPurposeEnabled(reminderPurpose, developmentSmtp), false);
  assert.equal(
    isEmailPurposeEnabled(reminderPurpose, developmentSmtp, {
      allowDevelopmentManualSend: true
    }),
    true
  );
  assert.doesNotThrow(() => assertEmailDeliveryEnabled(
    reminderPurpose,
    developmentSmtp,
    { allowDevelopmentManualSend: true }
  ));
  assert.equal(isEmailPurposeEnabled(reminderPurpose, {
    ...developmentSmtp,
    ENABLE_DEV_EMAIL_DELIVERY: "false"
  }, { allowDevelopmentManualSend: true }), false);
  assert.equal(isEmailPurposeEnabled(reminderPurpose, {
    ...developmentSmtp,
    SMTP_PASS: ""
  }, { allowDevelopmentManualSend: true }), false);
  assert.equal(isEmailPurposeEnabled("TEST_EMAIL", developmentSmtp, {
    allowDevelopmentManualSend: true
  }), false);
});

test("development customer verification email opt-in is purpose-limited", () => {
  const developmentSmtp = {
    ...productionSmtp,
    NODE_ENV: "development",
    ENABLE_DEV_CUSTOMER_VERIFICATION_EMAIL: "true"
  };

  assert.equal(isDevelopmentCustomerVerificationEmailEnabled(developmentSmtp), true);
  assert.equal(isEmailPurposeEnabled(
    "EMAIL_VERIFICATION",
    developmentSmtp,
    { allowDevelopmentCustomerVerification: true }
  ), true);
  assert.equal(isEmailPurposeEnabled(
    "PASSWORD_RESET",
    developmentSmtp,
    { allowDevelopmentCustomerVerification: true }
  ), false);
  assert.equal(isEmailPurposeEnabled(
    "EMAIL_VERIFICATION",
    { ...developmentSmtp, SMTP_PASS: "" },
    { allowDevelopmentCustomerVerification: true }
  ), false);
  assert.equal(isEmailPurposeEnabled(
    "EMAIL_VERIFICATION",
    { ...developmentSmtp, ENABLE_DEV_CUSTOMER_VERIFICATION_EMAIL: "false" },
    { allowDevelopmentCustomerVerification: true }
  ), false);
});

test("test email purpose is never enabled by application runtime", () => {
  const env = {
    NODE_ENV: "development",
    NOTIFICATION_DELIVERY_MODE: "disabled",
    REMINDER_SCHEDULER_ENABLED: "false"
  };
  assert.equal(isEmailPurposeEnabled("TEST_EMAIL", env), false);
  assert.equal(isEmailPurposeEnabled("TEST_EMAIL", productionSmtp), false);
  assert.throws(
    () => assertEmailDeliveryEnabled("TEST_EMAIL", productionSmtp),
    /disabled for this purpose/
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

test("development startup requires the isolated local database target", () => {
  const invalidUrls = [
    "postgresql://user:password@db.example:5432/auron_collect_app_dev?schema=public",
    "postgresql://user:password@localhost:5433/auron_collect_app_dev?schema=public",
    "postgresql://user:password@localhost:5432/auron_collect_app_test?schema=public"
  ];

  for (const DATABASE_URL of invalidUrls) {
    assert.throws(
      () => assertSafeDevelopmentDatabase({ NODE_ENV: "development", DATABASE_URL }),
      /localhost:5432\/auron_collect_app_dev/
    );
  }
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
  const previousNodeEnv = process.env.NODE_ENV;
  const previousMode = process.env.NOTIFICATION_DELIVERY_MODE;
  const previousAuthEmailSetting = process.env.AUTH_EMAIL_DELIVERY_ENABLED;
  const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"];
  const previousSmtpValues = new Map(
    smtpKeys.map((key) => [key, process.env[key]])
  );
  process.env.NODE_ENV = "test";
  process.env.NOTIFICATION_DELIVERY_MODE = "disabled";
  process.env.AUTH_EMAIL_DELIVERY_ENABLED = "true";
  for (const key of smtpKeys) delete process.env[key];

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
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
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
    for (const [key, value] of previousSmtpValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("SMS and WhatsApp remain unavailable even when live delivery is enabled", async () => {
  const previousMode = process.env.NOTIFICATION_DELIVERY_MODE;
  process.env.NOTIFICATION_DELIVERY_MODE = "live";

  try {
    await assert.rejects(
      sendSMS({ to: "0000000000", message: "Test" }),
      { code: "UNSUPPORTED_NOTIFICATION_CHANNEL" }
    );
    await assert.rejects(
      sendWhatsApp({ to: "0000000000", message: "Test" }),
      { code: "UNSUPPORTED_NOTIFICATION_CHANNEL" }
    );
  } finally {
    if (previousMode === undefined) {
      delete process.env.NOTIFICATION_DELIVERY_MODE;
    } else {
      process.env.NOTIFICATION_DELIVERY_MODE = previousMode;
    }
  }
});

test("reminder scheduler does not start in safe mode", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSchedulerSetting = process.env.REMINDER_SCHEDULER_ENABLED;
  const previousDeliveryMode = process.env.NOTIFICATION_DELIVERY_MODE;
  const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"];
  const previousSmtpValues = new Map(
    smtpKeys.map((key) => [key, process.env[key]])
  );
  process.env.NODE_ENV = "test";
  process.env.REMINDER_SCHEDULER_ENABLED = "false";
  process.env.NOTIFICATION_DELIVERY_MODE = "disabled";
  for (const key of smtpKeys) delete process.env[key];

  try {
    assert.equal(startReminderScheduler(), null);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
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
    for (const [key, value] of previousSmtpValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
