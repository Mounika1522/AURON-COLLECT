import prisma from "../config/prisma.js";
import { customerEmailTemplate } from "./customer-email-templates.js";
import { sendTrackedCustomerEmail, sendTrackedReminderEmail } from "./customer-email-delivery.service.js";
import { buildCustomerReceiptPdf, getCustomerReceiptPdfFilename } from "./customer-receipt-pdf.service.js";
import { getInvoiceOutstanding } from "./reminder.service.js";

const toAmount = (value) => Number(value || 0).toFixed(2);

export const createCustomerNotification = async ({
  customerId,
  organisationId,
  eventType,
  title,
  message,
  invoiceId,
  receiptId
}) => {
  const account = await prisma.customerPortalAccount.findUnique({
    where: { customerId },
    select: { id: true }
  });

  if (!account) return null;

  return prisma.customerNotification.create({
    data: {
      customerId,
      organisationId,
      accountId: account.id,
      eventType,
      title,
      message,
      invoiceId,
      receiptId
    }
  });
};

const sendForCustomerEvent = async ({
  customerId,
  organisationId,
  eventType,
  title,
  message,
  invoiceId,
  receiptId,
  attachments,
  templateData
}, {
  db = prisma,
  deliver = sendTrackedCustomerEmail
} = {}) => {
  const account = await db.customerPortalAccount.findFirst({
    where: { customerId, customer: { organisationId } },
    include: { customer: true }
  });

  const notification = account
    ? await db.customerNotification.create({
        data: {
          customerId,
          organisationId,
          accountId: account.id,
          eventType,
          title,
          message,
          invoiceId,
          receiptId
        }
      })
    : null;

  const email = customerEmailTemplate(eventType, {
    fullName: account?.fullName || "Customer",
    ...templateData
  });
  const verifiedRecipient =
    account?.emailVerifiedAt && typeof account.email === "string"
      ? account.email.trim()
      : "";
  const delivery = await deliver({
    accountId: account?.id,
    customerId,
    invoiceId,
    receiptId,
    purpose: eventType,
    to: verifiedRecipient,
    ...(attachments ? { attachments } : {}),
    ...email
  });

  if (!account) {
    return { notification, emailStatus: "NO_PORTAL_ACCOUNT" };
  }
  if (!verifiedRecipient) {
    return { notification, emailStatus: "ACCOUNT_UNVERIFIED" };
  }
  return { notification, emailStatus: delivery.status };
};

export const notifyCustomerInvoice = async (
  invoice,
  eventType = "INVOICE_GENERATED",
  dependencies
) => {
  const generated = eventType === "INVOICE_GENERATED";
  return sendForCustomerEvent({
    customerId: invoice.customerId,
    organisationId: invoice.organisationId,
    eventType,
    title: generated ? "New invoice generated" : "Invoice updated",
    message: generated
      ? `Invoice ${invoice.invoiceNumber} is available.`
      : `Invoice ${invoice.invoiceNumber} was updated.`,
    invoiceId: invoice.id,
    templateData: {
      invoiceNumber: invoice.invoiceNumber,
      currency: invoice.currency,
      amount: toAmount(invoice.total),
      dueDate: new Date(invoice.dueDate).toLocaleDateString("en-GB")
    }
  }, dependencies);
};

const receiptPdfQuery = {
  customer: {
    select: {
      name: true,
      email: true,
      phone: true,
      billingAddress: true,
      taxRegistration: true
    }
  },
  allocations: {
    where: { status: "POSTED", reversedAt: null },
    include: {
      invoice: {
        select: {
          invoiceNumber: true,
          invoiceDate: true,
          dueDate: true,
          subtotal: true,
          tax: true,
          total: true,
          currency: true
        }
      }
    }
  }
};

const customerReceiptDownloadUrl = (receiptId) => {
  const configuredOrigin = process.env.FRONTEND_URL?.split(",")[0]?.trim();
  const url = new URL("/", configuredOrigin || "http://localhost:5173");
  url.searchParams.set("customerPortal", "1");
  url.searchParams.set("receiptId", receiptId);
  return url.toString();
};

export const notifyCustomerPayment = async (
  receipt,
  {
    db = prisma,
    deliver = sendTrackedCustomerEmail,
    buildReceiptPdf = buildCustomerReceiptPdf
  } = {}
) => {
  if (receipt.status !== "POSTED") {
    return { notification: null, emailStatus: "NOT_APPLICABLE" };
  }

  const postedReceipt = await db.receipt.findFirst({
    where: {
      id: receipt.id,
      organisationId: receipt.organisationId,
      status: "POSTED"
    },
    include: receiptPdfQuery
  });
  if (!postedReceipt) {
    throw new Error("Posted receipt could not be loaded for customer delivery.");
  }
  const pdfBytes = await buildReceiptPdf(postedReceipt);

  return sendForCustomerEvent({
    customerId: postedReceipt.customerId,
    organisationId: postedReceipt.organisationId,
    eventType: "PAYMENT_RECEIVED",
    title: "Payment received",
    message: `Payment ${postedReceipt.receiptNumber} was recorded.`,
    receiptId: postedReceipt.id,
    attachments: [{
      filename: getCustomerReceiptPdfFilename(postedReceipt.receiptNumber),
      content: Buffer.from(pdfBytes),
      contentType: "application/pdf"
    }],
    templateData: {
      receiptNumber: postedReceipt.receiptNumber,
      currency: postedReceipt.currency,
      amount: toAmount(postedReceipt.amount),
      paymentDate: new Date(postedReceipt.receiptDate).toLocaleDateString("en-GB"),
      paymentMethod: postedReceipt.paymentMethod,
      transactionReference: postedReceipt.transactionReference,
      receiptDownloadUrl: customerReceiptDownloadUrl(postedReceipt.id)
    }
  }, { db, deliver });
};

const getReminderEmailContent = async (reminder, account, db) => {
  if (!account?.emailVerifiedAt || !account.email?.trim()) {
    return {
      status: "WAITING_FOR_VERIFIED_EMAIL",
      errorMessage: "A verified customer portal email is required."
    };
  }
  if (!reminder.invoice || !reminder.invoiceId) {
    return {
      status: "FAILED",
      errorCode: "INVOICE_REQUIRED",
      errorMessage: "The reminder is not linked to an invoice."
    };
  }

  const outstanding = Number(reminder.outstanding);
  const dueDate = new Date(reminder.invoice.dueDate);
  if (!Number.isFinite(outstanding) || outstanding <= 0 || Number.isNaN(dueDate.getTime())) {
    return {
      status: "FAILED",
      errorCode: "INVALID_REMINDER_DETAILS",
      errorMessage: "The reminder invoice details are not valid for delivery."
    };
  }

  const reminderStage = reminder.dedupeKey || "";
  const eventType = reminderStage.includes("BEFORE_DUE")
    ? "UPCOMING_DUE"
    : reminderStage.includes("DUE_DATE")
      ? "PAYMENT_DUE"
      : reminderStage.includes("OVERDUE")
        ? "OVERDUE"
        : "PAYMENT_REMINDER";
  const dueDateText = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  }).format(dueDate);
  const paymentReference = reminder.invoice.invoiceNumber;
  const amount = toAmount(outstanding);
  const overdue = eventType === "OVERDUE";
  const emailTemplateType = overdue ? "OVERDUE_REMINDER" : "PAYMENT_REMINDER";
  const notificationMessage = `Payment reference ${paymentReference} has an outstanding balance of ${reminder.invoice.currency} ${amount}. Due date: ${dueDateText}.`;
  const activeTemplate = reminder.templateId
    ? await db.reminderTemplate.findFirst({
        where: {
          id: reminder.templateId,
          organisationId: reminder.organisationId,
          channel: "EMAIL",
          isActive: true
        },
        select: { body: true }
      })
    : null;
  const message = activeTemplate?.body
    ? activeTemplate.body
        .replaceAll("{{customerName}}", account.fullName)
        .replaceAll("{{invoiceNumber}}", paymentReference)
        .replaceAll("{{amount}}", amount)
        .replaceAll("{{dueDate}}", dueDateText)
    : String(reminder.dedupeKey || "").startsWith("invoice:")
      ? overdue
        ? `Payment for invoice ${paymentReference} is overdue. Please sign in to review the current balance and make a payment.`
        : `This is a payment reminder for invoice ${paymentReference}. Please sign in to review the current balance and make a payment.`
      : reminder.message || notificationMessage;

  const email = customerEmailTemplate(emailTemplateType, {
    fullName: account.fullName,
    subject: reminder.subject,
    message,
    details: `Payment reference: ${paymentReference} · Outstanding amount: ${reminder.invoice.currency} ${amount} · Due date: ${dueDateText}`
  });

  return {
    status: "READY",
    recipient: account.email,
    subject: email.subject,
    message: email.text,
    text: email.text,
    html: email.html,
    notificationMessage
  };
};

export const buildReminderEmailPreview = async (reminder, { db = prisma } = {}) => {
  const account = await db.customerPortalAccount.findFirst({
    where: {
      customerId: reminder.customerId,
      customer: { organisationId: reminder.organisationId }
    }
  });

  if (!account?.emailVerifiedAt || !account.email?.trim()) {
    return {
      status: "WAITING_FOR_VERIFIED_EMAIL",
      errorMessage: "A verified customer portal email is required."
    };
  }
  if (!reminder.invoiceId) {
    return {
      status: "FAILED",
      errorCode: "INVOICE_REQUIRED",
      errorMessage: "The reminder is not linked to an invoice."
    };
  }

  const balance = await getInvoiceOutstanding(db, reminder.invoiceId, reminder.organisationId);
  if (
    !balance ||
    balance.outstanding <= 0 ||
    ["CANCELLED", "WRITTEN_OFF", "DRAFT"].includes(balance.invoice.status)
  ) {
    return {
      status: "CANCELLED",
      errorCode: "INVOICE_NOT_ELIGIBLE",
      errorMessage: "The invoice is no longer eligible for a payment reminder."
    };
  }

  return getReminderEmailContent({
    ...reminder,
    invoice: balance.invoice,
    outstanding: balance.outstanding
  }, account, db);
};

export const notifyCustomerReminder = async (
  reminder,
  {
    db = prisma,
    deliver = sendTrackedReminderEmail,
    manualSend = false,
    schedulerSend = false
  } = {}
) => {
  const account = await db.customerPortalAccount.findFirst({
    where: {
      customerId: reminder.customerId,
      customer: { organisationId: reminder.organisationId }
    }
  });
  let notification = null;
  const reminderStage = reminder.dedupeKey || "";
  const eventType = reminderStage.includes("BEFORE_DUE")
    ? "UPCOMING_DUE"
    : reminderStage.includes("DUE_DATE")
      ? "PAYMENT_DUE"
      : reminderStage.includes("OVERDUE")
        ? "OVERDUE"
        : "PAYMENT_REMINDER";

  if (account) {
    notification = await db.customerNotification.upsert({
      where: { reminderId: reminder.id },
      create: {
        customerId: reminder.customerId,
        organisationId: reminder.organisationId,
        accountId: account.id,
        reminderId: reminder.id,
        invoiceId: reminder.invoiceId,
        eventType,
        title: eventType === "UPCOMING_DUE"
          ? "Upcoming payment due"
          : eventType === "PAYMENT_DUE"
            ? "Payment due today"
            : eventType === "OVERDUE"
              ? "Invoice overdue"
              : "Payment reminder",
        message: reminder.message
      },
      update: {}
    });
  }

  const content = await getReminderEmailContent(reminder, account, db);
  if (content.status !== "READY") {
    return {
      notification,
      emailStatus: content.status,
      errorCode: content.errorCode,
      errorMessage: content.errorMessage
    };
  }
  if (notification && notification.message !== content.notificationMessage) {
    await db.customerNotification.update({
      where: { id: notification.id },
      data: { message: content.notificationMessage }
    });
  }
  const delivery = await deliver({
      accountId: account.id,
      customerId: reminder.customerId,
      invoiceId: reminder.invoiceId,
      reminderId: reminder.id,
      purpose: `PAYMENT_REMINDER:${reminder.dedupeKey}`,
      to: content.recipient,
      subject: content.subject,
      text: content.text,
      html: content.html
    }, { manualSend, schedulerSend });

  return {
    notification,
    emailStatus: delivery.status,
    errorCode: delivery.errorCode,
    errorMessage: delivery.errorMessage,
    retryable: delivery.retryable,
    acceptedAt: delivery.acceptedAt
  };
};
