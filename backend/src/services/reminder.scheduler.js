import cron from "node-cron";
import prisma from "../config/prisma.js";
import { getInvoiceOutstanding } from "./reminder.service.js";
import { isReminderSchedulerEnabled } from "../config/runtime-safety.js";
import { notifyCustomerReminder } from "./customer-portal-notification.service.js";

const retryDelaysMs = [60_000, 5 * 60_000, 15 * 60_000];

export const startReminderScheduler = () => {
  if (!isReminderSchedulerEnabled()) {
    console.log(
      "Reminder scheduler disabled. Enable both REMINDER_SCHEDULER_ENABLED and NOTIFICATION_DELIVERY_MODE=live to start it."
    );
    return null;
  }

  console.log("Reminder scheduler started");

  cron.schedule("* * * * *", async () => {
    console.log("Cron tick:", new Date().toISOString());
    try {
      const dueReminders = await prisma.reminder.findMany({
        where: {
          status: "PENDING",
          channel: "EMAIL",
          scheduledFor: { lte: new Date() }
        },
        include: {
          customer: true,
          invoice: true
        },
        take: 50
      });
       console.log("Due reminders found:", dueReminders.length);
      for (const reminder of dueReminders) {
        const claimed = await prisma.reminder.updateMany({
          where: {
            id: reminder.id,
            organisationId: reminder.organisationId,
            status: "PENDING"
          },
          data: {
            status: "PROCESSING",
            deliveryStatus: "PROCESSING",
            attemptCount: { increment: 1 },
            nextAttemptAt: null
          }
        });

        if (claimed.count !== 1) continue;

        try {
          // Recheck invoice balance before processing reminder
          if (reminder.invoiceId) {
            const balance = await getInvoiceOutstanding(
              prisma,
              reminder.invoiceId,
              reminder.organisationId
            );

            if (
              !balance ||
              balance.outstanding <= 0 ||
              ["CANCELLED", "WRITTEN_OFF", "DRAFT"].includes(
                balance.invoice.status
              )
            ) {
              await prisma.reminder.update({
                where: { id: reminder.id },
                data: {
                  status: "CANCELLED",
                  deliveryStatus: "CANCELLED"
                }
              });

              continue;
            }
          }

          // CHANNEL DISPATCH
          switch (reminder.channel?.toUpperCase()) {

            // EMAIL - REAL DELIVERY
            case "EMAIL": {
              if (!reminder.customer?.email) {
                throw new Error("Customer email address is missing");
              }

              const delivery = await notifyCustomerReminder({
                ...reminder,
                invoice: reminder.invoice
              });
              if (delivery.emailStatus === "FAILED") {
                const error = new Error("SMTP submission failed");
                error.code = delivery.errorCode || "SMTP_SEND_FAILED";
                throw error;
              }

              await prisma.reminder.update({
                where: { id: reminder.id },
                data: {
                  status: delivery.emailStatus,
                  deliveryStatus: delivery.emailStatus,
                  sentAt: null,
                  lastError: null,
                  nextAttemptAt: null
                }
              });

              console.log(`Email reminder submission status ${delivery.emailStatus}: ${reminder.id}`);
              break;
            }

            default:
              throw new Error(
                `Unsupported reminder channel: ${reminder.channel}`
              );
          }

        } catch (sendError) {
          const attemptNumber = reminder.attemptCount + 1;
          const retryDelay = retryDelaysMs[attemptNumber - 1];
          const retryAt = retryDelay
            ? new Date(Date.now() + retryDelay)
            : null;
          await prisma.reminder.update({
            where: { id: reminder.id },
            data: {
              status: retryAt ? "PENDING" : "FAILED",
              deliveryStatus: retryAt ? "RETRY_SCHEDULED" : "FAILED",
              scheduledFor: retryAt || reminder.scheduledFor,
              nextAttemptAt: retryAt,
              lastError: String(sendError.code || sendError.message).slice(0, 200),
              sentAt: null
            }
          });

          console.error(
            `Reminder processing failed: ${reminder.id}`,
            sendError.code || sendError.message
          );
        }
      }
    } catch (error) {
      console.error("Reminder scheduler error:", error);
    }
  });
};