
import prisma from "../config/prisma.js";

const reminderStages = [
  { key: "BEFORE_DUE_3_DAYS", days: -3 },
  { key: "DUE_DATE", days: 0 },
  { key: "OVERDUE_1_DAY", days: 1 }
];

// Set reminder time to 9:00 AM India time.
const getReminderDate = (dueDate, offsetDays) => {
  const date = new Date(dueDate);

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate() + offsetDays;

  // 09:00 IST = 03:30 UTC
  return new Date(Date.UTC(year, month, day, 3, 30, 0));
};

// Display date in Indian format.
const formatIndianDate = (date) => {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata"
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
  organisationId
) => {
  return db.reminder.updateMany({
    where: {
      invoiceId,
      organisationId,
      status: "PENDING"
    },
    data: {
      status: "CANCELLED",
      deliveryStatus: "CANCELLED"
    }
  });
};

export const syncInvoiceReminders = async (db, invoice) => {
  if (!invoice?.id || !invoice?.organisationId) return;

  // Cancel pending reminders before rebuilding the schedule.
  await cancelPendingInvoiceReminders(
    db,
    invoice.id,
    invoice.organisationId
  );

  if (invoice.status !== "ISSUED") return;

  const customer = await db.customer.findFirst({
    where: {
      id: invoice.customerId,
      organisationId: invoice.organisationId,
      status: "ACTIVE"
    }
  });

  if (!customer?.email) return;

  const balance = await getInvoiceOutstanding(
    db,
    invoice.id,
    invoice.organisationId
  );

  if (!balance || balance.outstanding <= 0) return;

  const now = new Date();

  for (const stage of reminderStages) {
    const scheduledFor = getReminderDate(
      invoice.dueDate,
      stage.days
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
    const dueDateText = formatIndianDate(invoice.dueDate);

    const subject =
      template?.subject ||
      `Payment reminder: Invoice ${invoice.invoiceNumber}`;

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
