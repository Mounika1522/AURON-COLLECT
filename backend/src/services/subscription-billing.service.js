import { Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";
import { getOfficialSubscriptionPlan } from "./official-subscription-plans.js";

const paiseFor = (amount) =>
  new Prisma.Decimal(amount).mul(100).toDecimalPlaces(0).toNumber();

export const addBillingPeriod = (start, cycle) => {
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + (cycle === "YEARLY" ? 12 : 1));
  const lastDay = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)
  ).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
};

const makeInvoiceNumber = (paymentId, createdAt) =>
  `AC-${createdAt.getUTCFullYear()}${String(
    createdAt.getUTCMonth() + 1
  ).padStart(2, "0")}-${paymentId.toUpperCase()}`;

export const recordCapturedPayment = async (
  tx,
  payment,
  gatewayPayment,
  now = new Date()
) => {
  await tx.$queryRaw`
    SELECT "id" FROM "BillingPayment" WHERE "id" = ${payment.id} FOR UPDATE
  `;

  const current = await tx.billingPayment.findUnique({
    where: { id: payment.id },
    include: { invoice: true, subscription: true }
  });

  if (!current) return { status: "NOT_FOUND" };
  if (current.status === "PAID") {
    return { status: "ALREADY_PAID", payment: current };
  }
  if (
    current.status !== "CREATED" ||
    current.razorpayOrderId !== gatewayPayment.order_id ||
    current.razorpayPaymentId ||
    gatewayPayment.status !== "captured" ||
    gatewayPayment.currency !== current.currency ||
    gatewayPayment.amount !== paiseFor(current.amount)
  ) {
    return { status: "PAYMENT_MISMATCH" };
  }

  const serviceStartsAt =
    current.periodEndsAt <= now ? now : current.effectiveAt;
  const serviceEndsAt =
    current.periodEndsAt <= now
      ? addBillingPeriod(serviceStartsAt, current.billingCycle)
      : current.periodEndsAt;
  const subscription = await tx.subscription.create({
    data: {
      organisationId: current.organisationId,
      planId: current.planId,
      billingCycle: current.billingCycle,
      status: serviceStartsAt > now ? "SCHEDULED" : "ACTIVE",
      startsAt: serviceStartsAt,
      endsAt: serviceEndsAt,
      billingAmount: current.amount,
      currency: current.currency
    }
  });

  const paidAt = gatewayPayment.created_at
    ? new Date(gatewayPayment.created_at * 1000)
    : now;

  const updatedPayment = await tx.billingPayment.update({
    where: { id: current.id },
    data: {
      status: "PAID",
      razorpayPaymentId: gatewayPayment.id,
      paidAt,
      effectiveAt: serviceStartsAt,
      periodEndsAt: serviceEndsAt,
      subscriptionId: subscription.id,
      errorCode: null
    },
    include: { plan: true, subscription: true }
  });

  const invoice = await tx.billingInvoice.create({
    data: {
      organisationId: current.organisationId,
      paymentId: current.id,
      invoiceNumber: makeInvoiceNumber(current.id, paidAt),
      planName: updatedPayment.plan.name,
      billingCycle: current.billingCycle,
      amount: current.amount,
      currency: current.currency,
      periodStart: serviceStartsAt,
      periodEnd: serviceEndsAt
    }
  });

  await tx.auditLog.create({
    data: {
      organisationId: current.organisationId,
      actorUserId: current.createdBy,
      action: "SUBSCRIPTION_PAYMENT_CAPTURED",
      entityType: "BILLING_PAYMENT",
      entityId: current.id,
      metadata: {
        planCode: updatedPayment.plan.code,
        billingCycle: current.billingCycle,
        amount: current.amount.toString(),
        currency: current.currency,
        invoiceId: invoice.id
      }
    }
  });

  return {
    status: "PAID",
    payment: { ...updatedPayment, invoice }
  };
};

export const amountInPaise = paiseFor;

export const isPlanPurchasableForCycle = (plan, billingCycle) => {
  if (!plan) return false;

  const officialPlan = getOfficialSubscriptionPlan(plan.code);
  if (officialPlan) {
    return billingCycle === "MONTHLY" && officialPlan.monthlyPrice !== null;
  }

  if (
    !plan.isActive ||
    plan.pricingStatus !== "APPROVED" ||
    plan.limitsStatus !== "APPROVED" ||
    plan.currency !== "INR"
  ) {
    return false;
  }
  const amount =
    billingCycle === "YEARLY" ? plan.yearlyPrice : plan.monthlyPrice;
  return Boolean(amount && amount.greaterThan(0));
};

export const getCurrentSubscriptionForOrganisation = async (
  db,
  organisationId,
  now = new Date()
) => {
  await db.subscription.updateMany({
    where: {
      organisationId,
      status: "ACTIVE",
      endsAt: { lte: now }
    },
    data: { status: "EXPIRED" }
  });

  await db.subscription.updateMany({
    where: {
      organisationId,
      status: "SCHEDULED",
      endsAt: { lte: now }
    },
    data: { status: "EXPIRED" }
  });

  await db.subscription.updateMany({
    where: {
      organisationId,
      status: "SCHEDULED",
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }]
    },
    data: { status: "ACTIVE" }
  });

  return db.subscription.findFirst({
    where: {
      organisationId,
      status: "ACTIVE",
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }]
    },
    include: { plan: true },
    orderBy: { startsAt: "desc" }
  });
};

export const createBillingOrderRecord = async (
  organisationId,
  userId,
  planCode,
  billingCycle,
  idempotencyKey,
  db = prisma,
  { customerId = null } = {}
) => db.$transaction(
  async (tx) => {
    await tx.$queryRaw`
      SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE
    `;

    const existing = await tx.billingPayment.findUnique({
      where: {
        organisationId_idempotencyKey: { organisationId, idempotencyKey }
      },
      include: { plan: true }
    });
    if (existing) {
      if (
        existing.status === "CREATED" &&
        existing.razorpayOrderId &&
        (!customerId || existing.customerId === customerId)
      ) {
        return { existing };
      }
      const error = new Error("This idempotency key cannot be reused");
      error.code = "BILLING_IDEMPOTENCY_CONFLICT";
      throw error;
    }

    const plan = await tx.subscriptionPlan.findUnique({
      where: { code: planCode }
    });
    if (!plan) {
      const error = new Error("This plan is not approved for purchase");
      error.code = "PLAN_NOT_PURCHASABLE";
      throw error;
    }

    const officialPlan = getOfficialSubscriptionPlan(plan.code);
    if (
      !officialPlan &&
      (!plan.isActive ||
        plan.pricingStatus !== "APPROVED" ||
        plan.limitsStatus !== "APPROVED")
    ) {
      const error = new Error("This plan is not approved for purchase");
      error.code = "PLAN_NOT_PURCHASABLE";
      throw error;
    }

    const amount =
      officialPlan
        ? officialPlan.monthlyPrice
        : billingCycle === "YEARLY"
          ? plan.yearlyPrice
          : plan.monthlyPrice;
    if (!isPlanPurchasableForCycle(plan, billingCycle)) {
      const error = new Error("No approved price is configured for this cycle");
      error.code = "PLAN_CYCLE_UNAVAILABLE";
      throw error;
    }

    const pending = await tx.billingPayment.findFirst({
      where: {
        organisationId,
        status: { in: ["CREATING", "CREATED"] }
      },
      include: { plan: true }
    });
    if (pending) {
      if (
        pending.status === "CREATED" &&
        pending.razorpayOrderId &&
        pending.planId === plan.id &&
        pending.billingCycle === billingCycle &&
        (!customerId || pending.customerId === customerId)
      ) {
        return { existing: pending };
      }
      const error = new Error("A billing order is already pending");
      error.code = "BILLING_ORDER_PENDING";
      throw error;
    }

    const now = new Date();
    const currentSubscription = await getCurrentSubscriptionForOrganisation(
      tx,
      organisationId,
      now
    );
    const scheduledSubscription = await tx.subscription.findFirst({
      where: {
        organisationId,
        status: "SCHEDULED",
        startsAt: { gt: now }
      }
    });
    if (scheduledSubscription) {
      const error = new Error("A plan change is already scheduled for renewal");
      error.code = "BILLING_PLAN_CHANGE_SCHEDULED";
      throw error;
    }

    const effectiveAt =
      currentSubscription?.endsAt && currentSubscription.endsAt > now
        ? currentSubscription.endsAt
        : now;
    const amountDecimal = new Prisma.Decimal(amount);

    const record = await tx.billingPayment.create({
      data: {
        organisationId,
        customerId,
        planId: plan.id,
        billingCycle,
        amount: amountDecimal,
        currency: officialPlan?.currency || plan.currency,
        status: "CREATING",
        idempotencyKey,
        effectiveAt,
        periodEndsAt: addBillingPeriod(effectiveAt, billingCycle),
        createdBy: userId
      },
      include: { plan: true }
    });

    return { record };
  },
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
);

export const writeBillingOrderCreatedAudit = async (tx, payment) =>
  tx.auditLog.create({
    data: {
      organisationId: payment.organisationId,
      actorUserId: payment.createdBy,
      action: "SUBSCRIPTION_ORDER_CREATED",
      entityType: "BILLING_PAYMENT",
      entityId: payment.id,
      metadata: {
        planCode: payment.plan.code,
        billingCycle: payment.billingCycle,
        amount: payment.amount.toString(),
        currency: payment.currency,
        effectiveAt: payment.effectiveAt.toISOString()
      }
    }
  });
