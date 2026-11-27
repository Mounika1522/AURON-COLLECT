
import nodemailer from "nodemailer";
import {
  assertEmailDeliveryEnabled,
  getMissingSmtpConfiguration,
  loadDevelopmentSmtpVariables
} from "../config/runtime-safety.js";

loadDevelopmentSmtpVariables();

export const getSmtpTransportOptions = (env = process.env) => {
  const missing = getMissingSmtpConfiguration(env);
  if (missing.length) {
    throw new Error(
      `Missing or invalid email configuration: ${missing.join(", ")}`
    );
  }

  const port = Number(env.SMTP_PORT);

  return {
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    tls: { minVersion: "TLSv1.2" },
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS
    }
  };
};

const createTransporter = (env = process.env) =>
  nodemailer.createTransport(getSmtpTransportOptions(env));

const deliverEmail = async (
  { to, subject, text, html, attachments },
  env,
  transporterFactory
) => {
  const transporter = transporterFactory(env);

  return await transporter.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject,
    text,
    html,
    ...(attachments?.length ? { attachments } : {})
  });
};

export const sendEmail = async (
  { purpose, to, subject, text, html, attachments },
  {
    manualSend = false,
    allowDevelopmentCustomerVerification = false,
    schedulerSend = false,
    env = process.env,
    transporterFactory = createTransporter
  } = {}
) => {
  assertEmailDeliveryEnabled(purpose, env, {
    allowDevelopmentManualSend: manualSend,
    allowDevelopmentCustomerVerification,
    allowDevelopmentReminderScheduler: schedulerSend
  });
  return deliverEmail(
    { to, subject, text, html, attachments },
    env,
    transporterFactory
  );
};

export const verifyEmailConnection = async () => {
  const transporter = createTransporter();
  return await transporter.verify();
};
