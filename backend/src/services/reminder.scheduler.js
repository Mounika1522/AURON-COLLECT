import cron from "node-cron";
import prisma from "../config/prisma.js";
import {
  getMissingSmtpConfiguration,
  isReminderSchedulerEnabled
} from "../config/runtime-safety.js";
import { getInvoiceOutstanding } from "./reminder.service.js";
import { notifyCustomerReminder } from "./customer-portal-notification.service.js";

const retryDelaysMs = [60_000, 5 * 60_000, 15 * 60_000];
const unverifiedEmailRetryMs = 24 * 60 * 60_000;
const staleProcessingAfterMs = 15 * 60_000;

const errorText = (error) =>
  String(error?.code || error?.message || "Reminder processing failed").slice(0, 200);

export const processReminder = async (
  reminder,
  {
    db = prisma,
    getOutstanding = getInvoiceOutstanding,
    notify = notifyCustomerReminder,
    now = () => new Date(),
    manualSend = false,
    schedulerSend = false
  } = {}
) => {
  const claimed = await db.reminder.updateMany({
    where: {
      id: reminder.id,
      organisationId: reminder.organisationId,
      ...(manualSend
        ? {
            OR: [
              { status: "PENDING" },
              {
                status: "FAILED",
                deliveryStatus: "DISABLED",
                lastError: "DELIVERY_DISABLED",
                sentAt: null
              }
            ]
          }
        : { status: "PENDING" })
    },
    data: {
      status: "PROCESSING",
      deliveryStatus: "PROCESSING",
      attemptCount: { increment: 1 },
      nextAttemptAt: null
    }
  });
  if (claimed.count !== 1) return { status: "NOT_CLAIMED" };

  try {
    if (!reminder.invoiceId) {
      const error = "INVOICE_REQUIRED";
      await db.reminder.update({
        where: { id: reminder.id },
        data: {
          status: "FAILED",
          deliveryStatus: "FAILED",
          lastError: error,
          sentAt: null
        }
      });
      return { status: "FAILED", errorCode: error };
    }

    const balance = await getOutstanding(
      db,
      reminder.invoiceId,
      reminder.organisationId
    );
    if (
      !balance ||
      balance.outstanding <= 0 ||
      ["CANCELLED", "WRITTEN_OFF", "DRAFT"].includes(balance.invoice.status)
    ) {
      await db.reminder.update({
        where: { id: reminder.id },
        data: {
          status: "CANCELLED",
          deliveryStatus: "CANCELLED",
          sentAt: null,
          nextAttemptAt: null
        }
      });
      return { status: "CANCELLED" };
    }

    const delivery = await notify({
      ...reminder,
      invoice: balance.invoice,
      outstanding: balance.outstanding
    }, { manualSend, schedulerSend });
    const processedAt = now();

    if (delivery.emailStatus === "SMTP_ACCEPTED") {
      const sentAt = delivery.acceptedAt || processedAt;
      await db.reminder.update({
        where: { id: reminder.id },
        data: {
          status: "SENT",
          deliveryStatus: "SMTP_ACCEPTED",
          sentAt,
          lastError: null,
          nextAttemptAt: null
        }
      });
      return { status: "SENT", sentAt };
    }

    if (delivery.emailStatus === "WAITING_FOR_VERIFIED_EMAIL") {
      const nextAttemptAt = new Date(
        processedAt.getTime() + unverifiedEmailRetryMs
      );
      await db.reminder.update({
        where: { id: reminder.id },
        data: {
          status: "PENDING",
          deliveryStatus: "WAITING_FOR_VERIFIED_EMAIL",
          lastError: "A verified customer portal email is required.",
          nextAttemptAt
        }
      });
      return {
        status: "PENDING",
        deliveryStatus: "WAITING_FOR_VERIFIED_EMAIL",
        errorCode: delivery.errorCode,
        errorMessage: delivery.errorMessage || "A verified customer portal email is required.",
        nextAttemptAt
      };
    }

    if (delivery.emailStatus === "RETRY_SCHEDULED" && delivery.retryable) {
      const attemptNumber = reminder.attemptCount + 1;
      const retryDelay = retryDelaysMs[attemptNumber - 1];
      if (retryDelay) {
        const nextAttemptAt = new Date(processedAt.getTime() + retryDelay);
        await db.reminder.update({
          where: { id: reminder.id },
          data: {
            status: "PENDING",
            deliveryStatus: "RETRY_SCHEDULED",
            lastError: delivery.errorCode || "SMTP_TEMPORARY_FAILURE",
            nextAttemptAt
          }
        });
        return {
          status: "PENDING",
          deliveryStatus: "RETRY_SCHEDULED",
          errorCode: delivery.errorCode || "SMTP_TEMPORARY_FAILURE",
          errorMessage: delivery.errorMessage || "SMTP temporarily rejected the email.",
          nextAttemptAt
        };
      }
    }

    const failure = delivery.errorCode || delivery.emailStatus || "EMAIL_FAILED";
    await db.reminder.update({
      where: { id: reminder.id },
      data: {
        status: "FAILED",
        deliveryStatus: delivery.emailStatus || "FAILED",
        lastError: failure,
        sentAt: null,
        nextAttemptAt: null
      }
    });
    return {
      status: "FAILED",
      errorCode: failure,
      errorMessage: delivery.errorMessage || failure
    };
  } catch (error) {
    const failure = errorText(error);
    await db.reminder.update({
      where: { id: reminder.id },
      data: {
        status: "FAILED",
        deliveryStatus: "DELIVERY_UNKNOWN",
        lastError: failure,
        sentAt: null,
        nextAttemptAt: null
      }
    });
    console.error(`Reminder processing failed: ${reminder.id}`, failure);
    return { status: "FAILED", errorCode: failure, errorMessage: failure };
  }
};

export const reconcileStaleProcessingReminders = async (
  db = prisma,
  now = new Date(),
  { protectScheduledBefore = null } = {}
) => {
  const cutoff = new Date(now.getTime() - staleProcessingAfterMs);
  const staleReminders = await db.reminder.findMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lte: cutoff }
    },
    include: {
      emailDeliveryAttempt: {
        select: {
          id: true,
          status: true,
          attemptCount: true,
          acceptedAt: true
        }
      }
    },
    take: 50
  });

  for (const reminder of staleReminders) {
    const attempt = reminder.emailDeliveryAttempt;
    if (attempt?.status === "SMTP_ACCEPTED") {
      await db.reminder.update({
        where: { id: reminder.id },
        data: {
          status: "SENT",
          deliveryStatus: "SMTP_ACCEPTED",
          sentAt: attempt.acceptedAt || now,
          lastError: null,
          nextAttemptAt: null
        }
      });
      continue;
    }

    if (attempt?.status === "SENDING") {
      await db.emailDeliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "DELIVERY_UNKNOWN",
          errorCode: "DELIVERY_OUTCOME_UNKNOWN",
          errorMessage: "SMTP delivery outcome is unknown; automatic retry was withheld to prevent a duplicate."
        }
      });
      await db.reminder.update({
        where: { id: reminder.id },
        data: {
          status: "FAILED",
          deliveryStatus: "DELIVERY_UNKNOWN",
          lastError: "DELIVERY_OUTCOME_UNKNOWN",
          nextAttemptAt: null
        }
      });
      continue;
    }

    if (!attempt || ["PENDING", "RETRY_SCHEDULED"].includes(attempt.status)) {
      if (
        protectScheduledBefore &&
        reminder.scheduledFor <= protectScheduledBefore
      ) {
        await db.reminder.update({
          where: { id: reminder.id },
          data: {
            status: "PENDING",
            deliveryStatus: attempt?.status || "PENDING",
            lastError: null
          }
        });
        continue;
      }

      const retryDelay = attempt?.status === "RETRY_SCHEDULED"
        ? retryDelaysMs[attempt.attemptCount - 1]
        : 0;
      const nextAttemptAt = new Date(now.getTime() + (retryDelay || 0));
      await db.reminder.update({
        where: { id: reminder.id },
        data: {
          status: "PENDING",
          deliveryStatus: attempt?.status || "PENDING",
          scheduledFor: now,
          nextAttemptAt,
          lastError: null
        }
      });
      continue;
    }

    await db.reminder.update({
      where: { id: reminder.id },
      data: {
        status: "FAILED",
        deliveryStatus: attempt.status,
        lastError: attempt.status,
        nextAttemptAt: null
      }
    });
  }
  return staleReminders.length;
};

export const runReminderSchedulerTick = async ({
  db = prisma,
  now = new Date(),
  schedulerStartedAt = null,
  developmentScheduler = false,
  getOutstanding = getInvoiceOutstanding,
  notify = notifyCustomerReminder
} = {}) => {
  await reconcileStaleProcessingReminders(db, now, {
    protectScheduledBefore: developmentScheduler ? schedulerStartedAt : null
  });
  const scheduledFor = developmentScheduler
    ? { gt: schedulerStartedAt, lte: now }
    : { lte: now };
  const dueReminders = await db.reminder.findMany({
    where: {
      status: "PENDING",
      channel: "EMAIL",
      scheduledFor,
      OR: [
        { nextAttemptAt: null },
        { nextAttemptAt: { lte: now } }
      ]
    },
    include: {
      customer: true,
      invoice: true
    },
    orderBy: { scheduledFor: "asc" },
    take: 50
  });

  for (const reminder of dueReminders) {
    await processReminder(reminder, {
      db,
      getOutstanding,
      notify,
      now: () => now,
      schedulerSend: developmentScheduler
    });
  }
  return dueReminders.length;
};

export const startReminderScheduler = ({
  db = prisma,
  env = process.env,
  schedule = cron.schedule,
  now = () => new Date()
} = {}) => {
  if (!isReminderSchedulerEnabled(env)) {
    const missing = getMissingSmtpConfiguration(env);
    if (env.NODE_ENV === "development" && env.ENABLE_DEV_REMINDER_SCHEDULER !== "true") {
      console.log(
        "Reminder scheduler disabled in development; set ENABLE_DEV_REMINDER_SCHEDULER=true for explicit testing."
      );
    } else if (missing.length) {
      console.error(
        `Reminder scheduler not started; missing SMTP configuration: ${missing.join(", ")}`
      );
    } else if (env.NODE_ENV !== "production") {
      console.log("Reminder scheduler disabled outside production.");
    } else {
      console.log("Reminder scheduler disabled by background scheduler settings.");
    }
    return null;
  }

  const developmentScheduler =
    env.NODE_ENV === "development" &&
    env.ENABLE_DEV_REMINDER_SCHEDULER === "true";
  const schedulerStartedAt = now();
  if (developmentScheduler) {
    void db.reminder.count({
      where: {
        status: "PENDING",
        channel: "EMAIL",
        scheduledFor: { lte: schedulerStartedAt }
      }
    }).then((count) => {
      console.log(
        `Development reminder scheduler left ${count} overdue reminder(s) pending for explicit review.`
      );
    }).catch((error) => {
      console.error(
        "Unable to count overdue reminders before development scheduling:",
        errorText(error)
      );
    });
  }
  console.log(
    developmentScheduler
      ? "Development reminder scheduler started; only reminders scheduled after startup will run automatically."
      : "Reminder scheduler started"
  );
  return schedule("* * * * *", async () => {
    const tickNow = now();
    try {
      await runReminderSchedulerTick({
        db,
        now: tickNow,
        schedulerStartedAt,
        developmentScheduler
      });
    } catch (error) {
      console.error("Reminder scheduler error:", errorText(error));
    }
  });
};
