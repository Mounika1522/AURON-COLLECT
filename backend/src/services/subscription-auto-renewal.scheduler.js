import cron from "node-cron";
import { Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";
import {
  addBillingPeriod,
  amountInPaise,
  recordCapturedPayment
} from "./subscription-billing.service.js";
import {
  addCustomerBillingPeriod,
  amountInPaise as customerAmountInPaise,
  getCustomerPlanPrice,
  recordCapturedCustomerPayment
} from "./customer-subscription.service.js";
import { getOfficialSubscriptionPlan } from "./official-subscription-plans.js";
import { createRazorpayClient } from "./razorpay.service.js";
import {
  createCustomerRazorpayClient
} from "./customer-subscription.service.js";
import {
  buildRecurringPaymentRequest,
  getRenewalFailureState
} from "./subscription-auto-renewal.service.js";
import {
  sendOrganizationSubscriptionReceiptEmail
} from "./organization-subscription-receipt.service.js";
import {
  finalizeCustomerSubscriptionReceipt,
  sendCustomerSubscriptionReceiptEmail
} from "./customer-subscription-receipt.service.js";
import { customerEmailTemplate } from "./customer-email-templates.js";
import { sendTrackedCustomerEmail } from "./customer-email-delivery.service.js";

const cyclePrice = (subscription) => {
  const officialPlan = getOfficialSubscriptionPlan(subscription.plan.code);
  const value = officialPlan
    ? officialPlan.monthlyPrice
    : subscription.billingCycle === "YEARLY"
      ? subscription.plan.yearlyPrice
      : subscription.plan.monthlyPrice;
  if (value == null || Number(value) <= 0) {
    throw new Error("The subscription no longer has an approved renewal price.");
  }
  return new Prisma.Decimal(value);
};

const customerCyclePrice = (subscription) => {
  const value = getCustomerPlanPrice(subscription.plan, subscription.billingCycle);
  if (value == null || Number(value) <= 0) {
    throw new Error("The customer subscription no longer has an approved renewal price.");
  }
  return new Prisma.Decimal(value);
};

const renewalIdempotencyKey = (subscriptionId, dueAt, attempt) =>
  `auto-renew:${subscriptionId}:${dueAt.getTime()}:${attempt}`;

const claimOrganizationRenewal = async (subscription, now, db) =>
  db.$transaction(async (tx) => {
    const claimed = await tx.subscription.updateMany({
      where: {
        id: subscription.id,
        status: "ACTIVE",
        autoRenew: true,
        nextRenewalDate: { lte: now },
        renewalAttempts: subscription.renewalAttempts,
        lastRenewalStatus: { not: "PROCESSING" }
      },
      data: {
        lastRenewalStatus: "PROCESSING",
        renewalAttempts: { increment: 1 }
      }
    });
    if (claimed.count !== 1) return null;

    const attempt = subscription.renewalAttempts + 1;
    const dueAt = subscription.nextRenewalDate;
    const payment = await tx.billingPayment.create({
      data: {
        organisationId: subscription.organisationId,
        customerId: subscription.payment?.customerId || null,
        planId: subscription.planId,
        billingCycle: subscription.billingCycle,
        amount: cyclePrice(subscription),
        currency: subscription.currency,
        status: "CREATING",
        idempotencyKey: renewalIdempotencyKey(subscription.id, dueAt, attempt),
        effectiveAt: dueAt > now ? dueAt : now,
        periodEndsAt: addBillingPeriod(
          dueAt > now ? dueAt : now,
          subscription.billingCycle
        ),
        autoRenewRequested: true,
        razorpayCustomerId: subscription.razorpayCustomerId,
        razorpayTokenId: subscription.razorpayTokenId,
        paymentMethod: subscription.paymentMethod,
        renewalSourceSubscriptionId: subscription.id
      }
    });
    return { payment, attempt };
  });

const claimCustomerRenewal = async (subscription, now, db) =>
  db.$transaction(async (tx) => {
    const claimed = await tx.customerSubscription.updateMany({
      where: {
        id: subscription.id,
        status: "ACTIVE",
        autoRenew: true,
        nextRenewalDate: { lte: now },
        renewalAttempts: subscription.renewalAttempts,
        lastRenewalStatus: { not: "PROCESSING" }
      },
      data: {
        lastRenewalStatus: "PROCESSING",
        renewalAttempts: { increment: 1 }
      }
    });
    if (claimed.count !== 1) return null;

    const attempt = subscription.renewalAttempts + 1;
    const dueAt = subscription.nextRenewalDate;
    const periodStart = dueAt > now ? dueAt : now;
    const periodEnd = addCustomerBillingPeriod(periodStart, subscription.billingCycle);
    const replacement = await tx.customerSubscription.create({
      data: {
        organisationId: subscription.organisationId,
        customerId: subscription.customerId,
        planId: subscription.planId,
        replacesSubscriptionId: subscription.id,
        status: "PENDING",
        billingCycle: subscription.billingCycle,
        startsAt: periodStart,
        renewalAt: periodEnd,
        endsAt: periodEnd,
        autoRenewRequested: true,
        razorpayCustomerId: subscription.razorpayCustomerId,
        razorpayTokenId: subscription.razorpayTokenId,
        paymentMethod: subscription.paymentMethod,
        lastRenewalStatus: "PROCESSING"
      }
    });
    const payment = await tx.customerSubscriptionPayment.create({
      data: {
        organisationId: subscription.organisationId,
        customerId: subscription.customerId,
        planId: subscription.planId,
        subscriptionId: replacement.id,
        planName: subscription.plan.name,
        billingCycle: subscription.billingCycle,
        amount: customerCyclePrice(subscription),
        currency: subscription.plan.currency,
        taxTerms: subscription.plan.taxTerms,
        status: "CREATING",
        idempotencyKey: renewalIdempotencyKey(subscription.id, dueAt, attempt),
        periodStart,
        periodEnd,
        autoRenewRequested: true,
        razorpayCustomerId: subscription.razorpayCustomerId,
        razorpayTokenId: subscription.razorpayTokenId,
        paymentMethod: subscription.paymentMethod,
        renewalSourceSubscriptionId: subscription.id
      }
    });
    return { payment, attempt };
  });

const setOrderCreated = async (payment, order, model, db) => {
  const updated = await db[model].updateMany({
    where: { id: payment.id, status: "CREATING" },
    data: { status: "CREATED", razorpayOrderId: order.id }
  });
  if (updated.count !== 1) throw new Error("Renewal payment state changed unexpectedly.");
  return { ...payment, status: "CREATED", razorpayOrderId: order.id };
};

const markRenewalFailed = async (kind, payment, now, db, errorCode = "RENEWAL_FAILED") => {
  const paymentModel = kind === "organization"
    ? "billingPayment"
    : "customerSubscriptionPayment";
  const subscriptionModel = kind === "organization"
    ? "subscription"
    : "customerSubscription";
  const sourceId = payment.renewalSourceSubscriptionId;

  const result = await db.$transaction(async (tx) => {
    await tx[paymentModel].updateMany({
      where: { id: payment.id, status: { in: ["CREATING", "CREATED"] } },
      data: { status: "FAILED", errorCode }
    });
    if (kind === "customer") {
      await tx.customerSubscription.updateMany({
        where: { id: payment.subscriptionId, status: "PENDING" },
        data: { status: "PAYMENT_FAILED" }
      });
    }
    const source = await tx[subscriptionModel].findUnique({
      where: { id: sourceId },
      include: { plan: { select: { name: true } } }
    });
    if (!source || source.status === "PAST_DUE") return { pastDue: false };
    const failureState = getRenewalFailureState(source.renewalAttempts, now);
    const data = { ...failureState };
    delete data.subscriptionStatus;
    if (failureState.subscriptionStatus) data.status = failureState.subscriptionStatus;
    await tx[subscriptionModel].update({
      where: { id: source.id },
      data
    });
    return {
      pastDue: Boolean(failureState.subscriptionStatus),
      source,
      payment
    };
  });

  if (result.pastDue) {
    await sendPastDueNotice(kind, result.source, payment, db);
  }
  return result;
};

const sendPastDueNotice = async (kind, subscription, payment, db) => {
  try {
    if (kind === "customer") {
      const customer = await db.customer.findFirst({
        where: {
          id: subscription.customerId,
          organisationId: subscription.organisationId
        },
        include: { portalAccount: true }
      });
      const account = customer?.portalAccount;
      const to = account?.emailVerifiedAt ? account.email : "";
      const email = customerEmailTemplate("SUBSCRIPTION_RENEWAL_FAILED", {
        fullName: account?.fullName || customer?.name || "Customer",
        planName: subscription.plan?.name || subscription.planId,
        message: "We could not renew your subscription after three payment attempts. Auto-renew is now disabled; please make a manual payment to restore service."
      });
      const receipt = await db.customerSubscriptionReceipt.findFirst({
        where: { customerId: subscription.customerId },
        orderBy: { createdAt: "desc" },
        select: { id: true }
      });
      await sendTrackedCustomerEmail({
        accountId: account?.id,
        customerId: subscription.customerId,
        customerSubscriptionReceiptId: receipt?.id,
        purpose: "PAYMENT_REMINDER",
        to,
        ...email
      });
      return;
    }

    const owner = await db.user.findFirst({
      where: {
        organisationId: subscription.organisationId,
        role: { in: ["OWNER", "ADMIN"] }
      },
      orderBy: { role: "asc" },
      select: { name: true, email: true }
    });
    const email = customerEmailTemplate("SUBSCRIPTION_RENEWAL_FAILED", {
      fullName: owner?.name || "Administrator",
      planName: subscription.plan?.name || subscription.planId,
      message: "We could not renew your organization plan after three payment attempts. Auto-renew is now disabled; please update billing or make a manual payment."
    });
    await sendTrackedCustomerEmail({
      billingPaymentId: payment.id,
      purpose: "PAYMENT_REMINDER",
      to: owner?.email || "",
      ...email
    });
  } catch (error) {
    console.error("Auto-renewal past-due email failed:", error.code || error.name);
  }
};

const executeRenewal = async (kind, payment, razorpay, now, db) => {
  const paymentModel = kind === "organization"
    ? "billingPayment"
    : "customerSubscriptionPayment";
  const amount = kind === "organization"
    ? amountInPaise(payment.amount)
    : customerAmountInPaise(payment.amount);
  let order;
  try {
    order = await razorpay.orders.create({
      amount,
      currency: payment.currency,
      receipt: payment.id,
      notes: { renewalPaymentId: payment.id }
    });
    if (
      typeof order?.id !== "string" ||
      !order.id ||
      order.amount !== amount ||
      order.currency !== payment.currency
    ) {
      throw new Error("Razorpay renewal order did not match the billing record.");
    }
    payment = await setOrderCreated(payment, order, paymentModel, db);
  } catch (error) {
    await markRenewalFailed(kind, payment, now, db, "RENEWAL_ORDER_FAILED");
    throw error;
  }

  let customer;
  try {
    customer = await razorpay.customers.fetch(payment.razorpayCustomerId);
  } catch (error) {
    await markRenewalFailed(
      kind,
      payment,
      now,
      db,
      "RAZORPAY_CUSTOMER_FETCH_FAILED"
    );
    throw error;
  }
  if (!customer?.email || !customer?.contact) {
    await markRenewalFailed(kind, payment, now, db, "RAZORPAY_CUSTOMER_DETAILS_MISSING");
    return { status: "FAILED" };
  }

  let recurringPayment;
  try {
    recurringPayment = await razorpay.payments.createRecurringPayment(
      buildRecurringPaymentRequest({
        amount,
        currency: payment.currency,
        orderId: order.id,
        customerId: payment.razorpayCustomerId,
        tokenId: payment.razorpayTokenId,
        email: customer.email,
        contact: customer.contact,
        description: "Auron Collect subscription renewal",
        notes: { renewalPaymentId: payment.id }
      })
    );
  } catch (error) {
    if (Number(error.statusCode) >= 400 && Number(error.statusCode) < 500) {
      await markRenewalFailed(kind, payment, now, db, "RENEWAL_CHARGE_FAILED");
    } else {
      console.error("Razorpay recurring charge outcome is pending:", error.code || error.name);
    }
    throw error;
  }

  const paymentId =
    recurringPayment?.razorpay_payment_id || recurringPayment?.id;
  if (typeof paymentId !== "string" || !paymentId) {
    console.error("Razorpay recurring charge returned no payment ID.");
    return { status: "PROCESSING" };
  }
  const providerPayment = await razorpay.payments.fetch(paymentId);
  if (providerPayment?.status === "failed") {
    await markRenewalFailed(kind, payment, now, db, "RENEWAL_CHARGE_FAILED");
    return { status: "FAILED" };
  }
  if (providerPayment?.status !== "captured") {
    return { status: "PROCESSING" };
  }

  const capture = await db.$transaction((tx) =>
    kind === "organization"
      ? recordCapturedPayment(tx, payment, providerPayment, now)
      : recordCapturedCustomerPayment(tx, payment, providerPayment, now)
  );
  if (capture.status !== "PAID" && capture.status !== "ACTIVE") {
    if (capture.status === "PAYMENT_MISMATCH") {
      throw new Error("Razorpay renewal payment did not match its billing record.");
    }
    return { status: capture.status };
  }

  try {
    if (kind === "organization") {
      await sendOrganizationSubscriptionReceiptEmail(payment.id);
    } else {
      const receipt = await db.customerSubscriptionReceipt.findUnique({
        where: { paymentId: payment.id },
        select: { id: true }
      });
      if (receipt) {
        const origin =
          process.env.PUBLIC_API_URL ||
          (process.env.NODE_ENV === "production" ? null : "http://localhost:5000");
        if (!origin) throw new Error("PUBLIC_API_URL is required for renewal receipts.");
        await finalizeCustomerSubscriptionReceipt(payment.id, origin);
        await sendCustomerSubscriptionReceiptEmail(receipt.id);
      }
    }
  } catch (error) {
    console.error("Auto-renewal receipt email failed:", error.code || error.name);
  }
  return { status: "PAID" };
};

export const runDueAutoRenewals = async (
  now = new Date(),
  {
    db = prisma,
    createOrganizationGateway = createRazorpayClient,
    createCustomerGateway = createCustomerRazorpayClient
  } = {}
) => {
  const [organizationSubscriptions, customerSubscriptions] = await Promise.all([
    db.subscription.findMany({
      where: {
        status: "ACTIVE",
        autoRenew: true,
        nextRenewalDate: { lte: now },
        razorpayCustomerId: { not: null },
        razorpayTokenId: { not: null }
      },
      include: { plan: true, payment: { select: { customerId: true } } },
      orderBy: { nextRenewalDate: "asc" },
      take: 100
    }),
    db.customerSubscription.findMany({
      where: {
        status: "ACTIVE",
        autoRenew: true,
        nextRenewalDate: { lte: now },
        razorpayCustomerId: { not: null },
        razorpayTokenId: { not: null }
      },
      include: { plan: true },
      orderBy: { nextRenewalDate: "asc" },
      take: 100
    })
  ]);
  const results = [];

  for (const subscription of organizationSubscriptions) {
    let payment;
    try {
      const claim = await claimOrganizationRenewal(subscription, now, db);
      if (!claim) continue;
      payment = claim.payment;
      const razorpay = createOrganizationGateway();
      const result = await executeRenewal("organization", payment, razorpay, now, db);
      results.push({ type: "organization", subscriptionId: subscription.id, ...result });
    } catch (error) {
      if (payment?.status === "CREATING") {
        await markRenewalFailed("organization", payment, now, db);
      }
      console.error("Organization auto-renewal failed:", error.code || error.name);
      results.push({ type: "organization", subscriptionId: subscription.id, status: "FAILED" });
    }
  }

  for (const subscription of customerSubscriptions) {
    let payment;
    try {
      const claim = await claimCustomerRenewal(subscription, now, db);
      if (!claim) continue;
      payment = claim.payment;
      const razorpay = createCustomerGateway();
      const result = await executeRenewal("customer", payment, razorpay, now, db);
      results.push({ type: "customer", subscriptionId: subscription.id, ...result });
    } catch (error) {
      if (payment?.status === "CREATING") {
        await markRenewalFailed("customer", payment, now, db);
      }
      console.error("Customer auto-renewal failed:", error.code || error.name);
      results.push({ type: "customer", subscriptionId: subscription.id, status: "FAILED" });
    }
  }
  return results;
};

export const startSubscriptionAutoRenewalScheduler = () =>
  cron.schedule(
    "0 2 * * *",
    async () => {
      try {
        await runDueAutoRenewals();
      } catch (error) {
        console.error("Subscription auto-renewal scheduler failed:", error.code || error.name);
      }
    },
    { timezone: "Asia/Kolkata" }
  );

export { markRenewalFailed };
