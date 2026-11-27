import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import prisma from "../config/prisma.js";
import { sendEmail } from "./email.service.js";
import { isStrongStaffPassword } from "./staff-password-policy.js";

export const STAFF_PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
export const STAFF_PASSWORD_RESET_RESEND_COOLDOWN_MS = 60 * 1000;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);

export const normalizeStaffResetEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

export const hashStaffPasswordResetToken = (token) =>
  createHash("sha256").update(token).digest("hex");

export const createStaffPasswordResetToken = () =>
  randomBytes(32).toString("base64url");

const isValidEmail = (email) =>
  email.length <= 254 && emailPattern.test(email);

const resetFrontendOrigin = (env) => {
  const configuredOrigin = env.FRONTEND_URL?.split(",")[0]?.trim();
  const origin =
    configuredOrigin ||
    (env.NODE_ENV === "development" ? "http://localhost:5173" : "");

  if (!origin) {
    const error = new Error("FRONTEND_URL must be configured for password reset links.");
    error.code = "FRONTEND_URL_REQUIRED";
    throw error;
  }

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    const error = new Error("FRONTEND_URL must be an absolute HTTP(S) URL.");
    error.code = "FRONTEND_URL_INVALID";
    throw error;
  }

  if (!["http:", "https:"].includes(parsedOrigin.protocol)) {
    const error = new Error("FRONTEND_URL must use HTTP or HTTPS.");
    error.code = "FRONTEND_URL_INVALID";
    throw error;
  }

  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(
    parsedOrigin.hostname.toLowerCase()
  );
  if (env.NODE_ENV === "production" && (parsedOrigin.protocol !== "https:" || isLocalhost)) {
    const error = new Error("Production password reset links require a public HTTPS frontend URL.");
    error.code = "FRONTEND_URL_INVALID";
    throw error;
  }

  return parsedOrigin.origin;
};

const resetLinkFor = (token, env) => {
  const url = new URL("/", resetFrontendOrigin(env));
  url.hash = new URLSearchParams({ staffReset: token }).toString();
  return url.toString();
};

const resetEmailFor = (user, token, env) => {
  const url = resetLinkFor(token, env);
  const safeName = escapeHtml(user.name || "AURON COLLECT user");
  const safeUrl = escapeHtml(url);
  const subject = "Reset your AURON COLLECT staff password";
  const text = [
    "Reset your AURON COLLECT staff password",
    "",
    `Hello ${user.name || "AURON COLLECT user"},`,
    "",
    "A password reset was requested for your staff account. This single-use link expires in 15 minutes:",
    url,
    "",
    "If you did not request this, you can ignore this email."
  ].join("\n");
  const html = `<div style="background:#f4f4f5;padding:32px;font-family:Arial,sans-serif"><div style="background:#fff;border-radius:12px;margin:0 auto;max-width:560px;padding:32px"><p style="color:#e50914;font-size:12px;font-weight:700;letter-spacing:1px">AURON COLLECT</p><h1 style="color:#18181b;font-size:22px">Reset your staff password</h1><p style="color:#27272a;font-size:14px;line-height:1.6">Hello ${safeName},</p><p style="color:#52525b;font-size:14px;line-height:1.6">A password reset was requested for your staff account. This single-use link expires in 15 minutes.</p><p style="margin:28px 0"><a href="${safeUrl}" style="background:#e50914;border-radius:8px;color:#fff;display:inline-block;font-weight:600;padding:12px 20px;text-decoration:none">Reset password</a></p><p style="color:#71717a;font-size:12px;line-height:1.6">If the button does not work, copy this link into your browser:<br>${safeUrl}</p><p style="color:#71717a;font-size:12px">If you did not request this, ignore this email.</p><hr style="border:0;border-top:1px solid #e4e4e7"><p style="color:#71717a;font-size:11px">Alpha Auron Collect · Staff account security</p></div></div>`;

  return { to: user.email, subject, text, html };
};

const logSafeFailure = (logger, message, error) => {
  logger.error(message, {
    code: error?.code || error?.name || "UNKNOWN"
  });
};

export const requestStaffPasswordReset = async (email, {
  db = prisma,
  env = process.env,
  deliverEmail = sendEmail,
  now = () => new Date(),
  tokenFactory = createStaffPasswordResetToken,
  logger = console
} = {}) => {
  const normalizedEmail = normalizeStaffResetEmail(email);
  if (!isValidEmail(normalizedEmail)) return { status: "ACCEPTED" };

  const user = await db.user.findFirst({
    where: { email: normalizedEmail },
    select: { id: true, name: true, email: true }
  });
  if (!user) return { status: "ACCEPTED" };

  const issuedAt = now();
  const token = tokenFactory();
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new TypeError("Password reset token generator returned an invalid token.");
  }
  let message;
  try {
    message = resetEmailFor(user, token, env);
  } catch (error) {
    logSafeFailure(logger, "Staff password reset link configuration failed:", error);
    return { status: "ACCEPTED" };
  }
  const tokenHash = hashStaffPasswordResetToken(token);
  const expiresAt = new Date(issuedAt.getTime() + STAFF_PASSWORD_RESET_TTL_MS);

  const issued = await db.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE
    `;
    const existing = await tx.staffPasswordResetToken.findUnique({
      where: { userId: user.id },
      select: { createdAt: true }
    });
    if (
      existing &&
      issuedAt.getTime() - existing.createdAt.getTime() <
        STAFF_PASSWORD_RESET_RESEND_COOLDOWN_MS
    ) {
      return false;
    }

    await tx.staffPasswordResetToken.upsert({
      where: { userId: user.id },
      create: { userId: user.id, tokenHash, expiresAt, createdAt: issuedAt },
      update: { tokenHash, expiresAt, createdAt: issuedAt }
    });
    return true;
  });

  if (!issued) return { status: "ACCEPTED" };

  try {
    const delivery = await deliverEmail({
      purpose: "STAFF_PASSWORD_RESET",
      ...message
    }, { manualSend: true, env });
    const acceptedRecipients = (delivery?.accepted || []).map((recipient) =>
      String(typeof recipient === "string" ? recipient : recipient?.address || "")
        .toLowerCase()
    );
    if (!acceptedRecipients.includes(user.email.toLowerCase())) {
      const error = new Error("SMTP did not accept the reset recipient.");
      error.code = "SMTP_RECIPIENT_REJECTED";
      throw error;
    }
  } catch (error) {
    logSafeFailure(logger, "Staff password reset email delivery failed:", error);
    try {
      await db.staffPasswordResetToken.deleteMany({
        where: { userId: user.id, tokenHash }
      });
    } catch (cleanupError) {
      logSafeFailure(logger, "Undelivered staff password reset token cleanup failed:", cleanupError);
    }
  }

  return { status: "ACCEPTED" };
};

export const resetStaffPassword = async ({
  token,
  password,
  confirmPassword
}, {
  db = prisma,
  now = () => new Date(),
  hashPassword = (value) => bcrypt.hash(value, 12)
} = {}) => {
  if (
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    !isStrongStaffPassword(password) ||
    password !== confirmPassword
  ) {
    return { status: "INVALID" };
  }

  const tokenHash = hashStaffPasswordResetToken(token);
  const reset = await db.staffPasswordResetToken.findFirst({
    where: { tokenHash, expiresAt: { gt: now() } },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          id: true,
          password: true,
          sessionVersion: true
        }
      }
    }
  });
  if (!reset?.user) return { status: "INVALID" };

  const hashedPassword = await hashPassword(password);
  const resetAt = now();
  return db.$transaction(async (tx) => {
    const consumed = await tx.staffPasswordResetToken.deleteMany({
      where: {
        id: reset.id,
        userId: reset.userId,
        tokenHash,
        expiresAt: { gt: resetAt }
      }
    });
    if (consumed.count !== 1) return { status: "INVALID" };

    const updated = await tx.user.updateMany({
      where: {
        id: reset.user.id,
        password: reset.user.password,
        sessionVersion: reset.user.sessionVersion
      },
      data: {
        password: hashedPassword,
        sessionVersion: { increment: 1 }
      }
    });
    return updated.count === 1
      ? { status: "RESET" }
      : { status: "INVALID" };
  });
};
