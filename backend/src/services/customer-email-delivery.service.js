import prisma from "../config/prisma.js";
import { assertEmailDeliveryEnabled } from "../config/runtime-safety.js";
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

export const sendTrackedCustomerEmail = async ({
  accountId,
  customerId,
  invoiceId,
  receiptId,
  purpose,
  to,
  subject,
  text,
  html
}) => {
  const attempt = await prisma.emailDeliveryAttempt.create({
    data: {
      customerAccountId: accountId,
      customerId,
      invoiceId,
      receiptId,
      purpose,
      recipient: to,
      status: "PENDING"
    }
  });

  try {
    assertEmailDeliveryEnabled(purpose);
    const result = await sendEmail({ purpose, to, subject, text, html });
    const acceptedRecipients = (result.accepted || []).map((recipient) =>
      String(typeof recipient === "string" ? recipient : recipient?.address || "")
        .toLowerCase()
    );

    if (!acceptedRecipients.includes(String(to).toLowerCase())) {
      const error = new Error("SMTP did not accept the recipient");
      error.code = "SMTP_RECIPIENT_REJECTED";
      throw error;
    }

    await prisma.emailDeliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "SMTP_ACCEPTED",
        attemptCount: 1,
        providerMessageId: result.messageId || null,
        attemptedAt: new Date(),
        acceptedAt: new Date()
      }
    });

    return { status: "SMTP_ACCEPTED", attemptId: attempt.id };
  } catch (error) {
    const disabled = error.code === "NOTIFICATION_DELIVERY_DISABLED";
    const safeCode = SAFE_EMAIL_ERROR_CODES.has(error.code)
      ? error.code
      : error.code === "SMTP_RECIPIENT_REJECTED"
        ? error.code
        : "SMTP_SEND_FAILED";

    await prisma.emailDeliveryAttempt.update({
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
        attemptedAt: disabled ? null : new Date()
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
