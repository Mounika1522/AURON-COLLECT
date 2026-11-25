import prisma from "../config/prisma.js";
import { customerEmailTemplate } from "./customer-email-templates.js";
import { sendTrackedCustomerEmail } from "./customer-email-delivery.service.js";

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
  templateData
}) => {
  const account = await prisma.customerPortalAccount.findFirst({
    where: { customerId, customer: { organisationId } },
    include: { customer: true }
  });

  if (!account) return { notification: null, emailStatus: "NO_PORTAL_ACCOUNT" };

  const notification = await prisma.customerNotification.create({
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

  if (!account.emailVerifiedAt) {
    return { notification, emailStatus: "ACCOUNT_UNVERIFIED" };
  }

  const email = customerEmailTemplate(eventType, {
    fullName: account.fullName,
    ...templateData
  });
  const delivery = await sendTrackedCustomerEmail({
    accountId: account.id,
    customerId,
    invoiceId,
    receiptId,
    purpose: eventType,
    to: account.email,
    ...email
  });

  return { notification, emailStatus: delivery.status };
};

export const notifyCustomerInvoice = async (invoice, eventType = "INVOICE_GENERATED") => {
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
  });
};

export const notifyCustomerPayment = async (receipt) =>
  sendForCustomerEvent({
    customerId: receipt.customerId,
    organisationId: receipt.organisationId,
    eventType: "PAYMENT_RECEIVED",
    title: "Payment received",
    message: `Payment ${receipt.receiptNumber} was recorded.`,
    receiptId: receipt.id,
    templateData: {
      receiptNumber: receipt.receiptNumber,
      currency: receipt.currency,
      amount: toAmount(receipt.amount),
      paymentDate: new Date(receipt.receiptDate).toLocaleDateString("en-GB")
    }
  });

export const notifyCustomerReminder = async (reminder) => {
  const account = await prisma.customerPortalAccount.findFirst({
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
    notification = await prisma.customerNotification.upsert({
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

  if (!reminder.customer?.email) {
    return { notification, emailStatus: "NO_EMAIL_ADDRESS" };
  }

  const template = customerEmailTemplate("PAYMENT_REMINDER", {
    fullName: account?.fullName || reminder.customer.name,
    message: reminder.message,
    details: reminder.invoice
      ? `Invoice ${reminder.invoice.invoiceNumber} · Due ${new Date(reminder.invoice.dueDate).toLocaleDateString("en-GB")}`
      : ""
  });
  const delivery = await sendTrackedCustomerEmail({
    accountId: account?.id,
    customerId: reminder.customerId,
    invoiceId: reminder.invoiceId,
    purpose: `PAYMENT_REMINDER:${reminder.dedupeKey}`,
    to: reminder.customer.email,
    ...template
  });

  return { notification, emailStatus: delivery.status, errorCode: delivery.errorCode };
};
