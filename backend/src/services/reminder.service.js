
import {
  isValidIanaTimeZone,
  localDateTimeToUtc
} from "./reminder-time.service.js";

const reminderStages = [
  { key: "BEFORE_DUE_3_DAYS", days: -3 },
  { key: "DUE_DATE", days: 0 },
  { key: "OVERDUE_1_DAY", days: 1 }
];

export const getReminderDate = (
  dueDate,
  offsetDays,
  timeZone = "Asia/Kolkata"
) => {
  const date = new Date(dueDate);
  if (!Number.isFinite(date.getTime()) || !isValidIanaTimeZone(timeZone)) {
    throw new RangeError("A valid invoice date and customer time zone are required.");
  }
  const calendarDate = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + offsetDays
  ));
  const scheduledFor = localDateTimeToUtc({
    year: calendarDate.getUTCFullYear(),
    month: calendarDate.getUTCMonth() + 1,
    day: calendarDate.getUTCDate(),
    hour: 9,
    minute: 0,
    second: 0
  }, timeZone);
  if (!scheduledFor) {
    throw new RangeError("The reminder time does not exist in the customer time zone.");
  }
  return scheduledFor;
};

const formatInvoiceDate = (date) => {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(date));
};

export const getInvoiceOutstanding = async (
  db,
  invoiceId,
  organisationId
) => {
  const invoice = await db.invoice.findFirst({
    where: {
      id: invoiceId,
      organisationId
    }
  });

  if (!invoice) return null;

  const allocations = await db.receiptAllocation.aggregate({
    where: {
      invoiceId,
      organisationId,
      status: "POSTED",
      receipt: {
        status: "POSTED"
      }
    },
    _sum: {
      amount: true
    }
  });

  const adjustments = await db.creditAdjustment.aggregate({
    where: {
      invoiceId,
      organisationId,
      status: "APPROVED"
    },
    _sum: {
      amount: true
    }
  });

  const total = Number(invoice.total);
  const paid = Number(allocations._sum.amount || 0);
  const adjusted = Number(adjustments._sum.amount || 0);

  const outstanding = Math.max(
    0,
    Number((total - paid - adjusted).toFixed(2))
  );

  return {
    invoice,
    outstanding
  };
};

export const cancelPendingInvoiceReminders = async (
  db,
  invoiceId,
  organisationId,
  { preserveScheduledRetries = false } = {}
) => {
  return db.reminder.updateMany({
    where: {
      invoiceId,
      organisationId,
      status: "PENDING",
      ...(preserveScheduledRetries
        ? { deliveryStatus: { notIn: ["WAITING_FOR_VERIFIED_EMAIL", "RETRY_SCHEDULED"] } }
        : {})
    },
    data: {
      status: "CANCELLED",
      deliveryStatus: "CANCELLED"
    }
  });
};

export const syncInvoiceReminders = async (
  db,
  invoice,
  { preserveScheduledRetries = false } = {}
) => {
  if (!invoice?.id || !invoice?.organisationId) return;

  // Cancel pending reminders before rebuilding the schedule.
  await cancelPendingInvoiceReminders(
    db,
    invoice.id,
    invoice.organisationId,
    { preserveScheduledRetries }
  );

  if (invoice.status !== "ISSUED") return;

  const customer = await db.customer.findFirst({
    where: {
      id: invoice.customerId,
      organisationId: invoice.organisationId,
      status: "ACTIVE"
    }
  });

  if (!customer) return;

  const balance = await getInvoiceOutstanding(
    db,
    invoice.id,
    invoice.organisationId
  );

  if (!balance || balance.outstanding <= 0) return;

  const portalAccount = await db.customerPortalAccount.findUnique({
    where: { customerId: customer.id },
    select: { timeZone: true }
  });
  const timeZone = portalAccount?.timeZone || "Asia/Kolkata";
  const now = new Date();

  for (const stage of reminderStages) {
    const scheduledFor = getReminderDate(
      invoice.dueDate,
      stage.days,
      timeZone
    );

    // Do not schedule reminders for dates that have passed.
    if (scheduledFor <= now) continue;

    const template = await db.reminderTemplate.findFirst({
      where: {
        organisationId: invoice.organisationId,
        triggerStage: stage.key,
        channel: "EMAIL",
        isActive: true
      }
    });

    const amount = balance.outstanding.toFixed(2);
    const dueDateText = formatInvoiceDate(invoice.dueDate);

    const defaultSubject =
      stage.key === "OVERDUE_1_DAY"
        ? `Overdue payment reminder: Invoice ${invoice.invoiceNumber}`
        : `Payment reminder: Invoice ${invoice.invoiceNumber}`;
    const subject = template?.subject || defaultSubject;

    const message = template?.body
      ? template.body
          .replaceAll("{{customerName}}", customer.name)
          .replaceAll("{{invoiceNumber}}", invoice.invoiceNumber)
          .replaceAll("{{amount}}", amount)
          .replaceAll("{{dueDate}}", dueDateText)
      : `Dear ${customer.name},

This is a payment reminder for invoice ${invoice.invoiceNumber}.

Outstanding amount: ${invoice.currency} ${amount}
Due date: ${dueDateText}

Please arrange the payment.

Regards,
Auron Collect`;

    const dueDateKey = new Date(invoice.dueDate).toISOString();

    const dedupeKey =
      `invoice:${invoice.id}:${stage.key}:${dueDateKey}:EMAIL`;

    const reminderData = {
      scheduledFor,
      subject,
      message,
      deliveryStatus: "PENDING",
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      templateId: template?.id || null
    };

    // Check whether this reminder was already created.
    const existingReminder = await db.reminder.findFirst({
      where: {
        organisationId: invoice.organisationId,
        dedupeKey
      }
    });

    if (existingReminder) {
      // Never resend a reminder that was already sent
      // or is currently being processed.
      if (
        existingReminder.status === "SENT" ||
        existingReminder.status === "SMTP_ACCEPTED" ||
        existingReminder.status === "PROCESSING"
      ) {
        continue;
      }

      // Reuse cancelled or failed reminders instead of
      // creating another row with the same unique key.
      if (
        existingReminder.status === "CANCELLED" ||
        existingReminder.status === "FAILED" ||
        existingReminder.status === "PENDING"
      ) {
        await db.reminder.update({
          where: {
            id: existingReminder.id
          },
          data: {
            ...reminderData,
            status: "PENDING",
            sentAt: null
          }
        });
      }

      continue;
    }

    // Create a reminder only when one does not already exist.
    await db.reminder.createMany({
      data: [
        {
          ...reminderData,
          status: "PENDING",
          channel: "EMAIL",
          dedupeKey,
          organisationId: invoice.organisationId
        }
      ],
      skipDuplicates: true
    });
  }
};

export const refreshInvoiceReminders = async (
  db,
  invoiceId,
  organisationId
) => {
  const balance = await getInvoiceOutstanding(
    db,
    invoiceId,
    organisationId
  );

  if (!balance) return;

  if (
    balance.outstanding <= 0 ||
    ["CANCELLED", "WRITTEN_OFF", "DRAFT"].includes(
      balance.invoice.status
    )
  ) {
    await cancelPendingInvoiceReminders(
      db,
      invoiceId,
      organisationId
    );

    return;
  }

  // Rebuild future reminders using the latest outstanding amount.
  await syncInvoiceReminders(db, balance.invoice);
};
