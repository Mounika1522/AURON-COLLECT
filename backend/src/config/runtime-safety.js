const PROTECTED_DEVELOPMENT_DATABASE = "auron_collect_app";
const AUTH_EMAIL_PURPOSES = new Set([
  "EMAIL_VERIFICATION",
  "PASSWORD_RESET"
]);
export const TEST_EMAIL_PURPOSE = "TEST_EMAIL";
const TEST_EMAIL_RECIPIENTS = new Set([
  "mounikakodige@gmail.com",
  "gogulakusuma@gmail.com"
]);

export const isNotificationDeliveryEnabled = (env = process.env) =>
  env.NOTIFICATION_DELIVERY_MODE === "live";

export const isAllowedTestEmailRecipient = (recipient) =>
  typeof recipient === "string" && TEST_EMAIL_RECIPIENTS.has(recipient);

export const isEmailPurposeEnabled = (
  purpose,
  env = process.env,
  recipient
) => {
  if (purpose === TEST_EMAIL_PURPOSE) {
    return (
      env.NODE_ENV !== "production" &&
      isAllowedTestEmailRecipient(recipient)
    );
  }

  return (
    isNotificationDeliveryEnabled(env) ||
    (
      env.AUTH_EMAIL_DELIVERY_ENABLED === "true" &&
      AUTH_EMAIL_PURPOSES.has(purpose)
    )
  );
};

export const assertEmailDeliveryEnabled = (
  purpose,
  env = process.env,
  recipient
) => {
  if (!isEmailPurposeEnabled(purpose, env, recipient)) {
    const error = new Error("Email delivery is disabled for this purpose.");
    error.code = "NOTIFICATION_DELIVERY_DISABLED";
    throw error;
  }
};

export const isReminderSchedulerEnabled = (env = process.env) =>
  env.REMINDER_SCHEDULER_ENABLED === "true" &&
  isNotificationDeliveryEnabled(env);

export const assertNotificationDeliveryEnabled = (env = process.env) => {
  if (!isNotificationDeliveryEnabled(env)) {
    const error = new Error(
      "Notification delivery is disabled. Set NOTIFICATION_DELIVERY_MODE=live to enable it."
    );
    error.code = "NOTIFICATION_DELIVERY_DISABLED";
    throw error;
  }
};

export const assertSafeDevelopmentDatabase = (env = process.env) => {
  if (env.NODE_ENV === "production") return;

  if (!env.DATABASE_URL) {
    throw new Error(
      "Development startup requires DATABASE_URL for a separate development database."
    );
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(env.DATABASE_URL);
  } catch {
    throw new Error(
      "Development startup requires a valid PostgreSQL DATABASE_URL."
    );
  }

  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error(
      "Development startup requires a PostgreSQL development database."
    );
  }

  const databaseName = decodeURIComponent(
    databaseUrl.pathname.replace(/^\/+/, "")
  ).split("/")[0];

  if (databaseName.toLowerCase() === PROTECTED_DEVELOPMENT_DATABASE) {
    throw new Error(
      "Development startup blocked: DATABASE_URL targets the preserved auron_collect_app database. Use a separate database such as auron_collect_app_dev."
    );
  }
};
