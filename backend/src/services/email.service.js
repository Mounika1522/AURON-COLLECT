
import nodemailer from "nodemailer";
import {
  assertEmailDeliveryEnabled,
  TEST_EMAIL_PURPOSE
} from "../config/runtime-safety.js";

const createTransporter = () => {
  const required = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "EMAIL_FROM"
  ];

  const missing = required.filter(
    (key) => !process.env[key]
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing email configuration: ${missing.join(", ")}`
    );
  }

  const port = Number(process.env.SMTP_PORT);

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
};

const deliverEmail = async ({ to, subject, text, html }) => {
  const transporter = createTransporter();

  return await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    text,
    html
  });
};

export const sendEmail = async ({ purpose, to, subject, text, html }) => {
  if (purpose === TEST_EMAIL_PURPOSE) {
    throw new Error("Use sendTestEmail for test email delivery.");
  }

  assertEmailDeliveryEnabled(purpose);
  return deliverEmail({ to, subject, text, html });
};

export const sendTestEmail = async (to) => {
  assertEmailDeliveryEnabled(TEST_EMAIL_PURPOSE, process.env, to);

  return deliverEmail({
    to,
    subject: "Auron Collect - Test Email",
    text: "Your Auron Collect email service is working successfully."
  });
};

export const verifyEmailConnection = async () => {
  const transporter = createTransporter();
  return await transporter.verify();
};
