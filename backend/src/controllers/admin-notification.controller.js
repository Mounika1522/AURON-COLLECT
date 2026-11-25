import prisma from "../config/prisma.js";
import { calculateInvoiceBalance } from "../services/dashboard-metrics.service.js";
import {
  AdminNotificationPermissionError,
  buildAdminNotificationResponse,
  getAdminNotificationAccess,
  isValidNotificationSourceKey,
  mapAutomatedEmailReminders,
} from "../services/admin-notification.service.js";
import {
  buildReceiptAllocationDataWhere,
  buildReceiptDataWhere,
  buildTaskDataWhere,
} from "../services/dashboard-access.service.js";

const EXCLUDED_INVOICE_STATUSES = ["DRAFT", "CANCELLED", "WRITTEN_OFF"];
const DAY_MS = 24 * 60 * 60 * 1000;

const utcDayStart = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const formatDate = (date) => new Date(date).toISOString().slice(0, 10);
const canAccessNotification = (event, access) =>
  event.organisationId === access.organisationId &&
  (access.canViewOrganisation ||
    event.assignedExecutive === access.assignedExecutive ||
    event.assignedExecutives?.includes(access.assignedExecutive));
const amountText = (value) =>
  typeof value?.toFixed === "function"
    ? value.toFixed(2)
    : Number(value || 0).toFixed(2);
const moneyText = (amount, currency) =>
  `${String(currency || "UNKNOWN").toUpperCase()} ${amountText(amount)}`;

const getInvoiceNotificationSelect = (organisationId) => ({
  id: true,
  invoiceNumber: true,
  dueDate: true,
  total: true,
  currency: true,
  organisationId: true,
  assignedExecutive: true,
  customer: {
    select: { name: true, organisationId: true },
  },
  allocations: {
    where: {
      organisationId,
      status: "POSTED",
      reversedAt: null,
      receipt: { organisationId, status: "POSTED" },
    },
    select: {
      amount: true,
      status: true,
      reversedAt: true,
      organisationId: true,
      receipt: {
        select: {
          status: true,
          receiptDate: true,
          organisationId: true,
          currency: true,
        },
      },
    },
  },
  creditAdjustments: {
    where: { organisationId, status: "APPROVED" },
    select: { amount: true, status: true, approvedAt: true },
  },
});

const getInvoiceAccessFilter = (access) => ({
  organisationId: access.organisationId,
  customer: { organisationId: access.organisationId },
  status: { notIn: EXCLUDED_INVOICE_STATUSES },
  ...(access.assignedExecutive
    ? { assignedExecutive: access.assignedExecutive }
    : {}),
});

const createEvent = ({
  type,
  sourceId,
  organisationId,
  assignedExecutive,
  assignedExecutives,
  title,
  message,
  createdAt,
}) => ({
  sourceKey: `${type}:${sourceId}`,
  type,
  organisationId,
  assignedExecutive,
  assignedExecutives,
  title,
  message,
  createdAt,
});

const getOutstandingInvoices = async ({
  organisationId,
  invoiceWhere,
  dueDateWhere,
  now,
}) => {
  const invoices = await prisma.invoice.findMany({
    where: {
      ...invoiceWhere,
      dueDate: dueDateWhere,
    },
    select: getInvoiceNotificationSelect(organisationId),
    orderBy: { dueDate: dueDateWhere.gte ? "asc" : "desc" },
    take: 30,
  });
  const asOfExclusive = new Date(utcDayStart(now).getTime() + DAY_MS);

  return invoices
    .map((invoice) => ({
      invoice,
      balance: calculateInvoiceBalance(
        invoice,
        asOfExclusive,
        organisationId,
      ),
    }))
    .filter(({ balance }) => balance.outstanding.gt(0));
};

const notificationEvents = async (access, now) => {
  const { organisationId } = access;
  const invoiceWhere = getInvoiceAccessFilter(access);
  const todayStart = utcDayStart(now);
  const upcomingThrough = new Date(todayStart.getTime() + 8 * DAY_MS);
  const recentFrom = new Date(now.getTime() - 30 * DAY_MS);
  const receiptFrom = new Date(now.getTime() - 7 * DAY_MS);

  const receiptAllocationScope = buildReceiptAllocationDataWhere(access, {
    status: "POSTED",
    reversedAt: null,
    receipt: { organisationId, status: "POSTED" },
    invoice: {
      customer: { organisationId },
    },
  });

  const taskWhere = buildTaskDataWhere(access, {
    status: { in: ["PENDING", "IN_PROGRESS"] },
    ...(!access.assignedExecutive
      ? { assignedExecutive: { not: null, notIn: [""] } }
      : {}),
  });

  const invoiceRelationScope = {
    organisationId,
    customer: { organisationId },
    ...(access.assignedExecutive
      ? { assignedExecutive: access.assignedExecutive }
      : {}),
  };

  const [
    overdueInvoices,
    upcomingInvoices,
    receipts,
    brokenPromises,
    tasks,
    disputes,
    failedEmails,
  ] = await Promise.all([
    getOutstandingInvoices({
      organisationId,
      invoiceWhere,
      dueDateWhere: { lt: todayStart },
      now,
    }),
    getOutstandingInvoices({
      organisationId,
      invoiceWhere,
      dueDateWhere: { gte: todayStart, lt: upcomingThrough },
      now,
    }),
    prisma.receipt.findMany({
      where: buildReceiptDataWhere(access, {
        status: "POSTED",
        receiptDate: { gte: receiptFrom },
      }),
      select: {
        id: true,
        organisationId: true,
        receiptNumber: true,
        amount: true,
        currency: true,
        receiptDate: true,
        customer: { select: { name: true, organisationId: true } },
        allocations: {
          where: receiptAllocationScope,
          select: {
            invoice: {
              select: { assignedExecutive: true, organisationId: true },
            },
          },
        },
      },
      orderBy: { receiptDate: "desc" },
      take: 25,
    }),
    prisma.promiseToPay.findMany({
      where: {
        organisationId,
        status: "BROKEN",
        customer: { organisationId },
        invoice: invoiceRelationScope,
      },
      select: {
        id: true,
        organisationId: true,
        promisedAmount: true,
        promisedDate: true,
        updatedAt: true,
        invoice: {
          select: {
            invoiceNumber: true,
            currency: true,
            assignedExecutive: true,
            organisationId: true,
          },
        },
        customer: { select: { name: true, organisationId: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
    prisma.task.findMany({
      where: taskWhere,
      select: {
        id: true,
        organisationId: true,
        title: true,
        dueDate: true,
        status: true,
        assignedExecutive: true,
        customer: { select: { name: true, organisationId: true } },
        invoice: {
          select: { invoiceNumber: true, organisationId: true },
        },
      },
      orderBy: { dueDate: "asc" },
      take: 25,
    }),
    prisma.dispute.findMany({
      where: {
        organisationId,
        status: { in: ["OPEN", "UNDER_REVIEW"] },
        priority: "HIGH",
        customer: { organisationId },
        invoice: invoiceRelationScope,
      },
      select: {
        id: true,
        organisationId: true,
        disputeNumber: true,
        priority: true,
        status: true,
        createdAt: true,
        invoice: {
          select: {
            invoiceNumber: true,
            assignedExecutive: true,
            organisationId: true,
          },
        },
        customer: { select: { name: true, organisationId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.emailDeliveryAttempt.findMany({
      where: {
        status: "FAILED",
        purpose: { startsWith: "PAYMENT_REMINDER:" },
        createdAt: { gte: recentFrom },
        customer: { organisationId },
        invoice: invoiceRelationScope,
      },
      select: {
        id: true,
        customerId: true,
        recipient: true,
        errorCode: true,
        errorMessage: true,
        attemptedAt: true,
        createdAt: true,
        customer: { select: { name: true, organisationId: true } },
        invoice: {
          select: {
            invoiceNumber: true,
            assignedExecutive: true,
            organisationId: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);

  const events = [];
  for (const { invoice, balance } of overdueInvoices) {
    events.push(
      createEvent({
        type: "OVERDUE_INVOICE",
        sourceId: invoice.id,
        organisationId: invoice.organisationId,
        assignedExecutive: invoice.assignedExecutive,
        title: "Overdue invoice",
        message: `${invoice.customer.name} · ${invoice.invoiceNumber} · ${moneyText(balance.outstanding, invoice.currency)} outstanding · due ${formatDate(invoice.dueDate)}.`,
        createdAt: invoice.dueDate,
      }),
    );
  }
  for (const { invoice, balance } of upcomingInvoices) {
    events.push(
      createEvent({
        type: "UPCOMING_DUE",
        sourceId: invoice.id,
        organisationId: invoice.organisationId,
        assignedExecutive: invoice.assignedExecutive,
        title: "Payment due soon",
        message: `${invoice.customer.name} · ${invoice.invoiceNumber} · ${moneyText(balance.outstanding, invoice.currency)} due ${formatDate(invoice.dueDate)}.`,
        createdAt: invoice.dueDate,
      }),
    );
  }
  for (const receipt of receipts) {
    events.push(
      createEvent({
        type: "PAYMENT_RECEIVED",
        sourceId: receipt.id,
        organisationId: receipt.organisationId,
        assignedExecutives: receipt.allocations
          .map((allocation) => allocation.invoice?.assignedExecutive)
          .filter(Boolean),
        title: "Payment received",
        message: `${receipt.customer.name} · ${receipt.receiptNumber} · ${moneyText(receipt.amount, receipt.currency)} received.`,
        createdAt: receipt.receiptDate,
      }),
    );
  }
  for (const promise of brokenPromises) {
    events.push(
      createEvent({
        type: "BROKEN_PROMISE",
        sourceId: promise.id,
        organisationId: promise.organisationId,
        assignedExecutive: promise.invoice.assignedExecutive,
        title: "Broken payment promise",
        message: `${promise.customer.name} · ${promise.invoice.invoiceNumber} · promise of ${moneyText(promise.promisedAmount, promise.invoice.currency)} for ${formatDate(promise.promisedDate)} was marked broken.`,
        createdAt: promise.updatedAt,
      }),
    );
  }
  for (const task of tasks) {
    events.push(
      createEvent({
        type: "ASSIGNED_TASK",
        sourceId: task.id,
        organisationId: task.organisationId,
        assignedExecutive: task.assignedExecutive,
        title: "Collection task assigned",
        message: `${task.title} · ${task.customer.name}${task.invoice?.invoiceNumber ? ` · ${task.invoice.invoiceNumber}` : ""} · due ${formatDate(task.dueDate)}.`,
        createdAt: task.dueDate,
      }),
    );
  }
  for (const dispute of disputes) {
    events.push(
      createEvent({
        type: "IMPORTANT_DISPUTE",
        sourceId: dispute.id,
        organisationId: dispute.organisationId,
        assignedExecutive: dispute.invoice.assignedExecutive,
        title: "High-priority dispute",
        message: `${dispute.customer.name} · ${dispute.invoice.invoiceNumber} · ${dispute.status.toLowerCase().replace("_", " ")}${dispute.disputeNumber ? ` · ${dispute.disputeNumber}` : ""}.`,
        createdAt: dispute.createdAt,
      }),
    );
  }
  for (const attempt of failedEmails) {
    events.push(
      createEvent({
        type: "FAILED_EMAIL",
        sourceId: attempt.id,
        organisationId,
        assignedExecutive: attempt.invoice.assignedExecutive,
        title: "Automated email failed",
        message: `${attempt.customer.name} · ${attempt.invoice.invoiceNumber} · ${attempt.recipient} · ${attempt.errorCode || attempt.errorMessage || "Email delivery failed"}.`,
        createdAt: attempt.attemptedAt || attempt.createdAt,
      }),
    );
  }

  return events;
};

export const getAdminNotifications = async (req, res) => {
  try {
    const access = getAdminNotificationAccess(req.user);
    const events = await notificationEvents(access, new Date());
    const sourceKeys = events.map((event) => event.sourceKey);
    const readStates = sourceKeys.length
      ? await prisma.adminNotificationRead.findMany({
          where: {
            organisationId: access.organisationId,
            userId: access.userId,
            sourceKey: { in: sourceKeys },
          },
          select: { sourceKey: true, readAt: true },
        })
      : [];
    const response = buildAdminNotificationResponse(events, readStates, access);

    return res.status(200).json({ success: true, ...response });
  } catch (error) {
    if (error instanceof AdminNotificationPermissionError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    console.error("Admin notification query failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load notifications.",
    });
  }
};

export const markAdminNotificationRead = async (req, res) => {
  try {
    const access = getAdminNotificationAccess(req.user);
    const sourceKey = req.params.sourceKey;
    if (!isValidNotificationSourceKey(sourceKey)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification identifier.",
      });
    }

    const now = new Date();
    const events = await notificationEvents(access, now);
    if (!events.some((event) => event.sourceKey === sourceKey && canAccessNotification(event, access))) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }

    await prisma.adminNotificationRead.upsert({
      where: {
        organisationId_userId_sourceKey: {
          organisationId: access.organisationId,
          userId: access.userId,
          sourceKey,
        },
      },
      create: {
        organisationId: access.organisationId,
        userId: access.userId,
        sourceKey,
        readAt: now,
      },
      update: { readAt: now },
    });

    return res.status(200).json({ success: true, readAt: now });
  } catch (error) {
    if (error instanceof AdminNotificationPermissionError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    console.error("Mark admin notification read failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to update the notification.",
    });
  }
};

export const getAutomatedEmailReminderHistory = async (req, res) => {
  try {
    const access = getAdminNotificationAccess(req.user);
    const reminderWhere = {
      organisationId: access.organisationId,
      channel: "EMAIL",
      createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) },
      NOT: { dedupeKey: { startsWith: "manual:" } },
      customer: { organisationId: access.organisationId },
      invoice: {
        organisationId: access.organisationId,
        customer: { organisationId: access.organisationId },
        ...(access.assignedExecutive
          ? { assignedExecutive: access.assignedExecutive }
          : {}),
      },
    };

    const reminders = await prisma.reminder.findMany({
      where: reminderWhere,
      select: {
        id: true,
        dedupeKey: true,
        channel: true,
        subject: true,
        scheduledFor: true,
        sentAt: true,
        status: true,
        deliveryStatus: true,
        lastError: true,
        createdAt: true,
        customer: { select: { name: true, email: true, organisationId: true } },
        invoice: { select: { invoiceNumber: true, organisationId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const purposes = reminders.map(
      (reminder) => `PAYMENT_REMINDER:${reminder.dedupeKey}`,
    );
    const attempts = purposes.length
      ? await prisma.emailDeliveryAttempt.findMany({
          where: {
            purpose: { in: purposes },
            customer: { organisationId: access.organisationId },
            invoice: {
              organisationId: access.organisationId,
              customer: { organisationId: access.organisationId },
              ...(access.assignedExecutive
                ? { assignedExecutive: access.assignedExecutive }
                : {}),
            },
          },
          select: {
            purpose: true,
            recipient: true,
            status: true,
            errorCode: true,
            errorMessage: true,
            attemptedAt: true,
            acceptedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

    return res.status(200).json({
      success: true,
      emailReminders: mapAutomatedEmailReminders(reminders, attempts),
    });
  } catch (error) {
    if (error instanceof AdminNotificationPermissionError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    console.error("Automated email history query failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load automated email history.",
    });
  }
};
