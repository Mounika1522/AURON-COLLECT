import cron from "node-cron";
import prisma from "../config/prisma.js";

export const settleDueCustomerSubscriptions = async (now = new Date()) => {
  await prisma.customerSubscription.updateMany({
    where: {
      status: "ACTIVE",
      cancelAtPeriodEnd: true,
      endsAt: { lte: now }
    },
    data: { status: "CANCELLED" }
  });
  await prisma.customerSubscription.updateMany({
    where: {
      status: "ACTIVE",
      cancelAtPeriodEnd: false,
      endsAt: { lte: now }
    },
    data: { status: "EXPIRED" }
  });

  const dueSubscriptions = await prisma.customerSubscription.findMany({
    where: { status: "SCHEDULED", startsAt: { lte: now } },
    select: {
      id: true,
      organisationId: true,
      customerId: true,
      startsAt: true
    },
    take: 100
  });

  for (const scheduled of dueSubscriptions) {
    await prisma.$transaction(async (tx) => {
      await tx.customerSubscription.updateMany({
        where: {
          organisationId: scheduled.organisationId,
          customerId: scheduled.customerId,
          status: "ACTIVE",
          endsAt: { lte: scheduled.startsAt }
        },
        data: { status: "EXPIRED" }
      });

      await tx.customerSubscription.updateMany({
        where: {
          id: scheduled.id,
          organisationId: scheduled.organisationId,
          customerId: scheduled.customerId,
          status: "SCHEDULED",
          startsAt: { lte: now }
        },
        data: { status: "ACTIVE" }
      });
    });
  }

  return dueSubscriptions.length;
};

export const startCustomerSubscriptionScheduler = () =>
  cron.schedule("*/5 * * * *", async () => {
    try {
      await settleDueCustomerSubscriptions();
    } catch (error) {
      console.error(
        "Customer subscription schedule settlement failed:",
        error.code || error.name
      );
    }
  });
