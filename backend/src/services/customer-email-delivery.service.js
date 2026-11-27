import prisma from "../config/prisma.js";
import {
  assertEmailDeliveryEnabled,
  isEmailPurposeEnabled
} from "../config/runtime-safety.js";
import { sendEmail } from "./email.service.js";

const SAFE_EMAIL_ERROR_CODES = new Set([
  "DELIVERY_DISABLED",
  "NOTIFICATION_DELIVERY_DISABLED",
  "ECONNECTION",
  "ETIMEDOUT",
  "EAUTH",
  "EENVELOPE",
  "EMESSAGE"
]);

const isSafeTransientEmailFailure = (error) => {
  const responseCode = Number(error.responseCode);
  if (responseCode >= 400 && responseCode < 500) return true;

  const command = String(error.command || "").toUpperCase();
  if (
    ["ECONNECTION", "ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH"].includes(
      error.code
    ) &&
    (!command || command === "CONN" || command === "CONNECT")
  ) {
    return true;
  }

  return (
    error.code === "ETIMEDOUT" &&
    ["CONN", "CONNECT", "AUTH", "MAIL FROM", "RCPT TO"].includes(command)
  );
};

const isAmbiguousDeliveryFailure = (error) =>
  ["ETIMEDOUT", "ECONNRESET", "EPIPE"].includes(error.code) &&
  !isSafeTransientEmailFailure(error);

const getSafeDeliveryErrorMessage = (error) =>
  String(error?.message || "SMTP submission failed")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 240);

export const sendTrackedCustomerEmail = async ({
  accountId,
  customerId,
  invoiceId,
  receiptId,
  customerSubscriptionReceiptId,
  billingPaymentId,
  purpose,
  to,
  subject,
  text,
  html,
  attachments
}, {
  db = prisma,
  deliver = sendEmail,
  env = process.env,
  now = () => new Date()
} = {}) => {
  let attempt;
if (billingPaymentId) {
  const existing = await db.emailDeliveryAttempt.findUnique({
    where: { billingPaymentId },
    select: { id: true }
  });
  if (existing) {
    return { status: "ALREADY_ATTEMPTED", attemptId: existing.id };
  }
}
  if (customerSubscriptionReceiptId) {
    const existing = await db.emailDeliveryAttempt.findFirst({
      where: { customerSubscriptionReceiptId, purpose },
      select: { id: true, status: true, errorCode: true }
    });
    if (existing) {
      if (
        to &&
        existing.status === "SKIPPED" &&
        existing.errorCode === "NO_VERIFIED_EMAIL"
      ) {
        const resumed = await db.emailDeliveryAttempt.updateMany({
          where: {
            id: existing.id,
            status: "SKIPPED",
            errorCode: "NO_VERIFIED_EMAIL"
          },
          data: {
            customerAccountId: accountId,
            recipient: to,
            status: "PENDING",
            errorCode: null,
            errorMessage: null,
            attemptedAt: null,
            acceptedAt: null,
            providerMessageId: null
          }
        });
        if (resumed.count !== 1) {
          return { status: "ALREADY_ATTEMPTED", attemptId: existing.id };
        }
        attempt = { id: existing.id };
      } else {
        return { status: "ALREADY_ATTEMPTED", attemptId: existing.id };
      }
    }
  }

  if (!attempt) {
    try {
      attempt = await db.emailDeliveryAttempt.create({
        data: {
          customerAccountId: accountId,
          customerId,
          invoiceId,
          receiptId,
          customerSubscriptionReceiptId,
          billingPaymentId,
          purpose,
          recipient: to || "",
          status: "PENDING"
        }
      });
    } catch (error) {
      if (
        error.code !== "P2002" ||
        (!customerSubscriptionReceiptId && !billingPaymentId)
      ) {
        throw error;
      }
      const existing = billingPaymentId
        ? await db.emailDeliveryAttempt.findUnique({
            where: { billingPaymentId },
            select: { id: true, status: true }
          })
        : await db.emailDeliveryAttempt.findFirst({
            where: { customerSubscriptionReceiptId, purpose },
            select: { id: true, status: true }
          });
      if (!existing) throw error;
      return { status: "ALREADY_ATTEMPTED", attemptId: existing.id };
    }
  }

  if (!to) {
    await db.emailDeliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "SKIPPED",
        errorCode: "NO_VERIFIED_EMAIL",
        errorMessage: "No verified customer email is available"
      }
    });
    return { status: "SKIPPED", attemptId: attempt.id };
  }

  try {
    assertEmailDeliveryEnabled(purpose, env);
    const result = await deliver({
      purpose,
      to,
      subject,
      text,
      html,
      attachments
    });
    const acceptedRecipients = (result.accepted || []).map((recipient) =>
      String(typeof recipient === "string" ? recipient : recipient?.address || "")
        .toLowerCase()
    );

    if (!acceptedRecipients.includes(String(to).toLowerCase())) {
      const error = new Error("SMTP did not accept the recipient");
      error.code = "SMTP_RECIPIENT_REJECTED";
      throw error;
    }

    const acceptedAt = now();
    await db.emailDeliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "SMTP_ACCEPTED",
        attemptCount: 1,
        providerMessageId: result.messageId || null,
        attemptedAt: acceptedAt,
        acceptedAt
      }
    });

    return { status: "SMTP_ACCEPTED", attemptId: attempt.id, acceptedAt };
  } catch (error) {
    const disabled = error.code === "NOTIFICATION_DELIVERY_DISABLED";
    const safeCode = SAFE_EMAIL_ERROR_CODES.has(error.code)
      ? error.code
      : error.code === "SMTP_RECIPIENT_REJECTED"
        ? error.code
        : "SMTP_SEND_FAILED";

    await db.emailDeliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        status: disabled ? "DISABLED" : "FAILED",
        attemptCount: disabled ? 0 : 1,
        errorCode: safeCode,
        errorMessage: disabled
          ? "Email delivery is disabled by runtime safety settings"
          : error.code === "SMTP_RECIPIENT_REJECTED"
            ? error.message
            : "SMTP submission failed",
        attemptedAt: disabled ? null : now()
      }
    });

    if (!disabled) {
      console.error("Customer email submission failed:", {
        purpose,
        attemptId: attempt.id,
        errorCode: safeCode
      });
    }

    return {
      status: disabled ? "DISABLED" : "FAILED",
      attemptId: attempt.id,
      errorCode: safeCode
    };
  }
};

export const sendTrackedReminderEmail = async ({
  accountId,
  customerId,
  invoiceId,
  reminderId,
  purpose,
  to,
  subject,
  text,
  html
}, {
  db = prisma,
  deliver = sendEmail,
  env = process.env,
  now = () => new Date(),
  manualSend = false,
  schedulerSend = false
} = {}) => {
  if (!reminderId) {
    throw new Error("A reminder ID is required for idempotent email delivery.");
  }
  if (!to) return { status: "WAITING_FOR_VERIFIED_EMAIL" };

  let attempt = await db.emailDeliveryAttempt.findUnique({
    where: { reminderId }
  });
  let attemptClaimed = false;
  if (
    attempt?.status === "DISABLED" &&
    manualSend &&
    attempt.errorCode === "DELIVERY_DISABLED" &&
    !attempt.acceptedAt &&
    !attempt.providerMessageId &&
    isEmailPurposeEnabled(purpose, env, {
      allowDevelopmentManualSend: true
    })
  ) {
    const rearmed = await db.emailDeliveryAttempt.updateMany({
      where: {
        id: attempt.id,
        status: "DISABLED",
        errorCode: "DELIVERY_DISABLED",
        acceptedAt: null,
        providerMessageId: null
      },
      data: {
        status: "SENDING",
        customerAccountId: accountId,
        recipient: to,
        errorCode: null,
        errorMessage: null,
        attemptCount: Math.max(Number(attempt.attemptCount || 0), 1),
        attemptedAt: now()
      }
    });
    if (rearmed.count === 1) {
      attempt = {
        ...attempt,
        status: "SENDING",
        errorCode: null,
        errorMessage: null,
        attemptCount: Math.max(Number(attempt.attemptCount || 0), 1)
      };
      attemptClaimed = true;
    } else {
      attempt = await db.emailDeliveryAttempt.findUnique({
        where: { reminderId }
      });
    }
  }

  if (attempt?.status === "SMTP_ACCEPTED") {
    return {
      status: "SMTP_ACCEPTED",
      attemptId: attempt.id,
      acceptedAt: attempt.acceptedAt,
      alreadyAccepted: true
    };
  }
  if (
    !attemptClaimed &&
    attempt &&
    !["PENDING", "RETRY_SCHEDULED"].includes(attempt.status)
  ) {
    return {
      status: attempt.status,
      attemptId: attempt.id,
      errorCode: attempt.errorCode || undefined,
      errorMessage: attempt.errorMessage || undefined,
      retryable: false
    };
  }

  if (!attempt) {
    try {
      attempt = await db.emailDeliveryAttempt.create({
        data: {
          customerAccountId: accountId,
          customerId,
          invoiceId,
          reminderId,
          purpose,
          recipient: to,
          status: "PENDING"
        }
      });
    } catch (error) {
      if (error.code !== "P2002") throw error;
      attempt = await db.emailDeliveryAttempt.findUnique({
        where: { reminderId }
      });
      if (!attempt) throw error;
      if (
        attempt.status !== "PENDING" &&
        attempt.status !== "RETRY_SCHEDULED"
      ) {
        return {
          status: attempt.status,
          attemptId: attempt.id,
          errorCode: attempt.errorCode || undefined,
          errorMessage: attempt.errorMessage || undefined,
          retryable: false
        };
      }
    }
  }

  if (!attemptClaimed) {
    const claimed = await db.emailDeliveryAttempt.updateMany({
      where: { id: attempt.id, status: attempt.status },
      data: {
        status: "SENDING",
        attemptCount: { increment: 1 },
        attemptedAt: now(),
        errorCode: null,
        errorMessage: null
      }
    });
    if (claimed.count !== 1) {
      const current = await db.emailDeliveryAttempt.findUnique({
        where: { reminderId }
      });
      return {
        status: current?.status || "DELIVERY_UNKNOWN",
        attemptId: current?.id,
        errorCode: current?.errorCode || undefined,
        errorMessage: current?.errorMessage || undefined,
        retryable: false
      };
    }
  }

  let result;
  try {
    assertEmailDeliveryEnabled(purpose, env, {
      allowDevelopmentManualSend: manualSend,
      allowDevelopmentReminderScheduler: schedulerSend
    });
    result = await deliver(
      { purpose, to, subject, text, html },
      { manualSend, schedulerSend }
    );
    const acceptedRecipients = (result.accepted || []).map((recipient) =>
      String(typeof recipient === "string" ? recipient : recipient?.address || "")
        .toLowerCase()
    );
    if (!acceptedRecipients.includes(String(to).toLowerCase())) {
      const error = new Error("SMTP did not accept the recipient");
      error.code = "SMTP_RECIPIENT_REJECTED";
      throw error;
    }
  } catch (error) {
    const retryable = isSafeTransientEmailFailure(error);
    const ambiguous = isAmbiguousDeliveryFailure(error);
    const disabled = error.code === "NOTIFICATION_DELIVERY_DISABLED";
    const errorCode = disabled
      ? "DELIVERY_DISABLED"
      : ambiguous
        ? "DELIVERY_OUTCOME_UNKNOWN"
        : error.responseCode
          ? `SMTP_${error.responseCode}`
          : SAFE_EMAIL_ERROR_CODES.has(error.code)
            ? error.code
            : "SMTP_SEND_FAILED";
    const status = disabled
      ? "DISABLED"
      : retryable
        ? "RETRY_SCHEDULED"
        : ambiguous
          ? "DELIVERY_UNKNOWN"
          : "FAILED";

    await db.emailDeliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        status,
        errorCode,
        errorMessage: retryable
          ? "SMTP temporarily rejected the email before acceptance."
          : ambiguous
            ? "SMTP delivery outcome is unknown; automatic retry was withheld to prevent a duplicate."
            : disabled
              ? "Email delivery is disabled for this runtime."
              : "SMTP rejected the email."
      }
    });

    return {
      status,
      attemptId: attempt.id,
      errorCode,
      errorMessage: getSafeDeliveryErrorMessage(error),
      retryable
    };
  }

  const acceptedAt = now();
  await db.emailDeliveryAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "SMTP_ACCEPTED",
      providerMessageId: result.messageId || null,
      acceptedAt,
      errorCode: null,
      errorMessage: null
    }
  });
  return { status: "SMTP_ACCEPTED", attemptId: attempt.id, acceptedAt };
};
