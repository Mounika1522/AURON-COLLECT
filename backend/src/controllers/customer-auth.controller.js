import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma.js";
import { customerEmailTemplate } from "../services/customer-email-templates.js";
import { sendTrackedCustomerEmail } from "../services/customer-email-delivery.service.js";
import { createCustomerNotification } from "../services/customer-portal-notification.service.js";
import {
  createCustomerEmailOtp,
  CUSTOMER_EMAIL_OTP_MAX_ATTEMPTS,
  CUSTOMER_EMAIL_OTP_RESEND_COOLDOWN_MS,
  CUSTOMER_EMAIL_OTP_TTL_MS,
  hashCustomerEmailOtp,
  matchesCustomerEmailOtp
} from "../services/customer-email-otp.js";
import { isEmailPurposeEnabled } from "../config/runtime-safety.js";

const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_EMAIL_REQUESTS = 3;
const PASSWORD_MIN_LENGTH = 12;

const normalizeEmail = (email) => email.trim().toLowerCase();
const normalizePhone = (phone) => phone.replace(/\D/g, "");
const hashPasswordResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");
const newPasswordResetToken = () => crypto.randomBytes(32).toString("base64url");
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const passwordError = (password) =>
  typeof password !== "string" ||
  password.length < PASSWORD_MIN_LENGTH ||
  password.length > 128;

const issueCustomerToken = (account) =>
  jwt.sign(
    {
      tokenType: "CUSTOMER_PORTAL",
      accountId: account.id,
      customerId: account.customerId,
      sessionVersion: account.sessionVersion
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.CUSTOMER_JWT_EXPIRES_IN || "8h" }
  );

const recordEmailRequest = async (purpose, email) => {
  const since = new Date(Date.now() - RESEND_WINDOW_MS);
  const count = await prisma.emailDeliveryAttempt.count({
    where: {
      purpose,
      recipient: email,
      createdAt: { gte: since }
    }
  });
  return count < MAX_EMAIL_REQUESTS;
};

const sendPortalEmail = async (account, purpose, credential) => {
  const verification = purpose === "EMAIL_VERIFICATION";
  const message = customerEmailTemplate(
    verification ? "VERIFY_EMAIL" : "RESET_PASSWORD",
    verification
      ? { fullName: account.fullName, otp: credential }
      : { fullName: account.fullName, token: credential }
  );
  return sendTrackedCustomerEmail({
    accountId: account.id,
    customerId: account.customerId,
    purpose,
    to: account.email,
    ...message
  });
};

const registrationEligibilityMessage =
  "We can't confirm registration eligibility in this response. If your details match an active customer record and are eligible for portal registration, a verification code may be sent. Contact your organization's administrator if you need assistance.";

const respondWithRegistrationEligibility = (res) =>
  res.status(202).json({ message: registrationEligibilityMessage });

const recoveryResponseMessage = (purpose) => {
  if (!isEmailPurposeEnabled(purpose)) {
    return "If an eligible account exists, we processed the request. Outbound email is disabled in this environment, so no message was sent.";
  }
  return purpose === "EMAIL_VERIFICATION"
    ? "If an eligible account exists, a verification code may be sent. Email delivery is not confirmed."
    : "If an eligible account exists, reset instructions may be sent. Email delivery is not confirmed.";
};

export const registerCustomer = async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (
      Object.hasOwn(body, "customerId") ||
      Object.hasOwn(body, "organisationId") ||
      Object.hasOwn(body, "organizationId")
    ) {
      return res.status(400).json({
        success: false,
        message: "Customer and organization are matched automatically; do not provide their IDs."
      });
    }

    const { fullName, email, phone, password, confirmPassword } = body;
    if (
      typeof fullName !== "string" ||
      !fullName.trim() ||
      fullName.trim().length > 120 ||
      typeof email !== "string" ||
      typeof phone !== "string" ||
      typeof password !== "string" ||
      passwordError(password) ||
      password !== confirmPassword
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide a name, valid email and phone, and matching passwords of at least 12 characters."
      });
    }

    const cleanEmail = normalizeEmail(email);
    const cleanPhone = normalizePhone(phone);
    if (
      !validEmail(cleanEmail) ||
      cleanPhone.length < 7 ||
      cleanPhone.length > 15
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address and phone number."
      });
    }

    const emailCustomers = await prisma.$queryRaw`
      SELECT "id", "email", "phone", "organisationId"
      FROM "Customer"
      WHERE "status" = 'ACTIVE'
        AND "email" IS NOT NULL
        AND LOWER(BTRIM("email")) = ${cleanEmail}
    `;
    const matchingCustomers = emailCustomers.filter(
      (customer) =>
        customer.phone &&
        normalizePhone(customer.phone) === cleanPhone
    );

    if (matchingCustomers.length === 0) {
      return respondWithRegistrationEligibility(res);
    }
    if (matchingCustomers.length > 1) {
      return respondWithRegistrationEligibility(res);
    }

    const customer = matchingCustomers[0];
    const existingAccount = await prisma.customerPortalAccount.findFirst({
      where: {
        OR: [
          { customerId: customer.id },
          { email: cleanEmail }
        ]
      },
      select: { id: true }
    });
    if (existingAccount) {
      return respondWithRegistrationEligibility(res);
    }

    const otp = createCustomerEmailOtp();
    const sentAt = new Date();
    const account = await prisma.customerPortalAccount.create({
      data: {
        customerId: customer.id,
        email: cleanEmail,
        fullName: fullName.trim(),
        passwordHash: await bcrypt.hash(password, 12),
        verificationOtpHash: hashCustomerEmailOtp(otp),
        verificationOtpExpiresAt: new Date(sentAt.getTime() + CUSTOMER_EMAIL_OTP_TTL_MS),
        verificationOtpAttemptCount: 0,
        verificationOtpSentAt: sentAt
      },
      include: {
        customer: { select: { organisationId: true } }
      }
    });

    await sendPortalEmail(account, "EMAIL_VERIFICATION", otp);

    return respondWithRegistrationEligibility(res);
  } catch (error) {
    if (error.code === "P2002") {
      return respondWithRegistrationEligibility(res);
    }
    console.error("Customer registration failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to create the customer portal account."
    });
  }
};

export const loginCustomer = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (
      typeof email !== "string" ||
      !validEmail(email.trim()) ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address and password."
      });
    }

    const account = await prisma.customerPortalAccount.findUnique({
      where: { email: normalizeEmail(email) },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            status: true,
            organisationId: true
          }
        }
      }
    });

    if (
      !account ||
      account.customer.status !== "ACTIVE" ||
      !(await bcrypt.compare(password, account.passwordHash))
    ) {
      return res.status(401).json({
        success: false,
        message: "Email or password is incorrect."
      });
    }
    if (!account.emailVerifiedAt) {
      return res.status(403).json({
        success: false,
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Verify your email address before signing in."
      });
    }

    return res.status(200).json({
      success: true,
      token: issueCustomerToken(account),
      user: {
        accountId: account.id,
        customerId: account.customerId,
        fullName: account.fullName,
        email: account.email,
        emailVerifiedAt: account.emailVerifiedAt
      }
    });
  } catch (error) {
    console.error("Customer login failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to sign in."
    });
  }
};

export const verifyCustomerEmail = async (req, res) => {
  try {
    const email = typeof req.body?.email === "string"
      ? normalizeEmail(req.body.email)
      : "";
    const otp = req.body?.otp;
    if (!validEmail(email) || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address and six-digit verification code."
      });
    }

    const verifiedAt = new Date();
    const account = await prisma.customerPortalAccount.findFirst({
      where: {
        email,
        emailVerifiedAt: null,
        verificationOtpHash: { not: null },
        verificationOtpExpiresAt: { gt: verifiedAt },
        verificationOtpAttemptCount: { lt: CUSTOMER_EMAIL_OTP_MAX_ATTEMPTS }
      },
      include: { customer: { select: { organisationId: true } } }
    });
    if (!account) {
      return res.status(400).json({
        success: false,
        message: "The verification code is invalid, expired, or no longer accepted."
      });
    }

    if (!matchesCustomerEmailOtp(otp, account.verificationOtpHash)) {
      await prisma.customerPortalAccount.updateMany({
        where: {
          id: account.id,
          verificationOtpHash: account.verificationOtpHash,
          verificationOtpExpiresAt: { gt: verifiedAt },
          emailVerifiedAt: null,
          verificationOtpAttemptCount: { lt: CUSTOMER_EMAIL_OTP_MAX_ATTEMPTS }
        },
        data: {
          verificationOtpAttemptCount: { increment: 1 }
        }
      });
      return res.status(400).json({
        success: false,
        message: "The verification code is invalid, expired, or no longer accepted."
      });
    }

    const verification = await prisma.customerPortalAccount.updateMany({
      where: {
        id: account.id,
        verificationOtpHash: account.verificationOtpHash,
        verificationOtpExpiresAt: { gt: verifiedAt },
        emailVerifiedAt: null,
        verificationOtpAttemptCount: { lt: CUSTOMER_EMAIL_OTP_MAX_ATTEMPTS }
      },
      data: {
        emailVerifiedAt: verifiedAt,
        verificationOtpHash: null,
        verificationOtpExpiresAt: null,
        verificationOtpAttemptCount: 0
      }
    });
    if (verification.count !== 1) {
      return res.status(400).json({
        success: false,
        message: "The verification code is invalid, expired, or no longer accepted."
      });
    }
    await prisma.reminder.updateMany({
      where: {
        customerId: account.customerId,
        organisationId: account.customer.organisationId,
        status: "PENDING",
        deliveryStatus: "WAITING_FOR_VERIFIED_EMAIL"
      },
      data: { nextAttemptAt: verifiedAt }
    });
    await createCustomerNotification({
      customerId: account.customerId,
      organisationId: account.customer.organisationId,
      eventType: "ACCOUNT_VERIFIED",
      title: "Email verified",
      message: "Your customer portal email address has been verified."
    });

    return res.status(200).json({
      success: true,
      message: "Your email address is verified. You can now sign in."
    });
  } catch (error) {
    console.error("Customer email verification failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to verify your email address."
    });
  }
};

export const resendCustomerVerification = async (req, res) => {
  try {
    const email = typeof req.body?.email === "string"
      ? normalizeEmail(req.body.email)
      : "";
    if (validEmail(email) && await recordEmailRequest("EMAIL_VERIFICATION", email)) {
      const account = await prisma.customerPortalAccount.findFirst({
        where: { email, emailVerifiedAt: null },
        include: { customer: { select: { organisationId: true } } }
      });
      if (account) {
        const now = new Date();
        const otp = createCustomerEmailOtp();
        const updated = await prisma.customerPortalAccount.updateMany({
          where: {
            id: account.id,
            emailVerifiedAt: null,
            OR: [
              { verificationOtpSentAt: null },
              {
                verificationOtpSentAt: {
                  lte: new Date(now.getTime() - CUSTOMER_EMAIL_OTP_RESEND_COOLDOWN_MS)
                }
              }
            ]
          },
          data: {
            verificationOtpHash: hashCustomerEmailOtp(otp),
            verificationOtpExpiresAt: new Date(now.getTime() + CUSTOMER_EMAIL_OTP_TTL_MS),
            verificationOtpAttemptCount: 0,
            verificationOtpSentAt: now
          }
        });
        if (updated.count === 1) {
          await sendPortalEmail(account, "EMAIL_VERIFICATION", otp);
        }
      }
    } else if (validEmail(email)) {
      return res.status(429).json({
        success: false,
        message: "Too many verification requests. Please wait before trying again."
      });
    }

    return res.status(202).json({
      success: true,
      message: recoveryResponseMessage("EMAIL_VERIFICATION")
    });
  } catch (error) {
    console.error("Resend verification failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to process the verification request."
    });
  }
};

export const requestCustomerPasswordReset = async (req, res) => {
  try {
    const email = typeof req.body?.email === "string"
      ? normalizeEmail(req.body.email)
      : "";
    if (validEmail(email) && await recordEmailRequest("PASSWORD_RESET", email)) {
      const account = await prisma.customerPortalAccount.findFirst({
        where: { email, emailVerifiedAt: { not: null } },
        include: { customer: { select: { organisationId: true } } }
      });
      if (account) {
        const token = newPasswordResetToken();
        await prisma.customerPortalAccount.update({
          where: { id: account.id },
          data: {
            passwordResetTokenHash: hashPasswordResetToken(token),
            passwordResetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
            passwordResetSentAt: new Date()
          }
        });
        await sendPortalEmail(account, "PASSWORD_RESET", token);
      }
    } else if (validEmail(email)) {
      return res.status(429).json({
        success: false,
        message: "Too many password recovery requests. Please wait before trying again."
      });
    }

    return res.status(202).json({
      success: true,
      message: recoveryResponseMessage("PASSWORD_RESET")
    });
  } catch (error) {
    console.error("Password reset request failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to process the password recovery request."
    });
  }
};

export const resetCustomerPassword = async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body || {};
    if (
      typeof token !== "string" ||
      token.length < 32 ||
      token.length > 200 ||
      passwordError(password) ||
      password !== confirmPassword
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide a valid reset link and matching passwords of at least 12 characters."
      });
    }

    const account = await prisma.customerPortalAccount.findFirst({
      where: {
        passwordResetTokenHash: hashPasswordResetToken(token),
        passwordResetExpiresAt: { gt: new Date() },
        emailVerifiedAt: { not: null }
      },
      select: { id: true }
    });
    if (!account) {
      return res.status(400).json({
        success: false,
        message: "The password reset link is invalid, expired, or already used."
      });
    }

    const update = await prisma.customerPortalAccount.updateMany({
      where: {
        id: account.id,
        passwordResetTokenHash: hashPasswordResetToken(token),
        passwordResetExpiresAt: { gt: new Date() },
        emailVerifiedAt: { not: null }
      },
      data: {
        passwordHash: await bcrypt.hash(password, 12),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        sessionVersion: { increment: 1 }
      }
    });
    if (update.count !== 1) {
      return res.status(400).json({
        success: false,
        message: "The password reset link is invalid, expired, or already used."
      });
    }
    return res.status(200).json({
      success: true,
      message: "Your password was reset. Sign in with your new password."
    });
  } catch (error) {
    console.error("Customer password reset failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to reset your password."
    });
  }
};

export const logoutCustomer = async (req, res) => {
  try {
    await prisma.customerPortalAccount.update({
      where: { id: req.customer.accountId },
      data: { sessionVersion: { increment: 1 } }
    });
    return res.status(200).json({
      success: true,
      message: "You have been signed out."
    });
  } catch (error) {
    console.error("Customer logout failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to sign out securely."
    });
  }
};
