import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const PROTECTED_DEVELOPMENT_DATABASE = "auron_collect_app";
const DEVELOPMENT_DATABASE_HOST = "localhost";
const DEVELOPMENT_DATABASE_PORT = "5432";
const DEVELOPMENT_DATABASE_NAME = "auron_collect_app_dev";
const SMTP_REQUIRED_ENV_VARIABLES = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "EMAIL_FROM"
];
const BACKEND_ENV_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.env"
);

export const mergeMissingSmtpVariables = (env, source) => {
  const loaded = [];
  for (const key of SMTP_REQUIRED_ENV_VARIABLES) {
    if (
      (typeof env[key] !== "string" || !env[key].trim()) &&
      typeof source[key] === "string" &&
      source[key].trim()
    ) {
      env[key] = source[key].trim();
      loaded.push(key);
    }
  }
  return loaded;
};

export const loadDevelopmentSmtpVariables = (env = process.env) => {
  if (env.NODE_ENV === "production") return [];

  let contents;
  try {
    contents = readFileSync(BACKEND_ENV_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  return mergeMissingSmtpVariables(env, parse(contents));
};

export const getMissingSmtpConfiguration = (env = process.env) => {
  const missing = SMTP_REQUIRED_ENV_VARIABLES.filter(
    (key) => typeof env[key] !== "string" || !env[key].trim()
  );
  const port = Number(env.SMTP_PORT);
  if (
    env.SMTP_PORT &&
    (!Number.isInteger(port) || port < 1 || port > 65535) &&
    !missing.includes("SMTP_PORT")
  ) {
    missing.push("SMTP_PORT");
  }
  return missing;
};

export const isSmtpConfigurationPresent = (env = process.env) =>
  getMissingSmtpConfiguration(env).length === 0;

export const isNotificationDeliveryEnabled = (env = process.env) =>
  env.NOTIFICATION_DELIVERY_MODE === "live";

export const isDevelopmentManualEmailDeliveryEnabled = (env = process.env) =>
  env.NODE_ENV === "development" &&
  env.ENABLE_DEV_EMAIL_DELIVERY === "true" &&
  isSmtpConfigurationPresent(env);

export const isDevelopmentReminderSchedulerEnabled = (env = process.env) =>
  env.NODE_ENV === "development" &&
  env.ENABLE_DEV_REMINDER_SCHEDULER === "true" &&
  isSmtpConfigurationPresent(env);

export const isEmailPurposeEnabled = (
  purpose,
  env = process.env,
  {
    allowDevelopmentManualSend = false,
    allowDevelopmentReminderScheduler = false
  } = {}
) =>
  Boolean(purpose) &&
  purpose !== "TEST_EMAIL" &&
  (
    (env.NODE_ENV === "production" && isSmtpConfigurationPresent(env)) ||
    (allowDevelopmentManualSend &&
      isDevelopmentManualEmailDeliveryEnabled(env)) ||
    (allowDevelopmentReminderScheduler &&
      purpose.startsWith("PAYMENT_REMINDER:") &&
      isDevelopmentReminderSchedulerEnabled(env))
  );

export const assertEmailDeliveryEnabled = (
  purpose,
  env = process.env,
  options = {}
) => {
  if (!isEmailPurposeEnabled(purpose, env, options)) {
    const error = new Error("Email delivery is disabled for this purpose.");
    error.code = "NOTIFICATION_DELIVERY_DISABLED";
    throw error;
  }
};

export const areBackgroundSchedulersEnabled = (env = process.env) =>
  env.DISABLE_BACKGROUND_SCHEDULERS !== "true";

export const isReminderSchedulerEnabled = (env = process.env) =>
  (
    env.NODE_ENV === "production" &&
    isSmtpConfigurationPresent(env) &&
    areBackgroundSchedulersEnabled(env)
  ) || isDevelopmentReminderSchedulerEnabled(env);

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

  if (
    env.NODE_ENV === "development" &&
    (
      databaseUrl.hostname.toLowerCase() !== DEVELOPMENT_DATABASE_HOST ||
      databaseUrl.port !== DEVELOPMENT_DATABASE_PORT ||
      databaseName !== DEVELOPMENT_DATABASE_NAME
    )
  ) {
    throw new Error(
      "Development startup requires DATABASE_URL to target localhost:5432/auron_collect_app_dev."
    );
  }
};
