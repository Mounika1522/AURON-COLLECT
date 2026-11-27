import crypto from "node:crypto";
import Razorpay from "razorpay";

const isHexSignature = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

const safeEqualHex = (provided, expected) => {
  if (!isHexSignature(provided) || !isHexSignature(expected)) return false;
  return crypto.timingSafeEqual(
    Buffer.from(provided, "hex"),
    Buffer.from(expected, "hex")
  );
};

export const assertCustomerSubscriptionTestMode = (env = process.env) => {
  if (
    env.CUSTOMER_RAZORPAY_MODE !== "test" ||
    !env.CUSTOMER_RAZORPAY_KEY_ID?.startsWith("rzp_test_") ||
    !env.CUSTOMER_RAZORPAY_KEY_SECRET ||
    !env.CUSTOMER_RAZORPAY_WEBHOOK_SECRET
  ) {
    const error = new Error("Customer subscription Test Mode is not configured");
    error.code = "CUSTOMER_SUBSCRIPTION_TEST_UNAVAILABLE";
    throw error;
  }
};

export const createCustomerRazorpayClient = (env = process.env) => {
  assertCustomerSubscriptionTestMode(env);
  return new Razorpay({
    key_id: env.CUSTOMER_RAZORPAY_KEY_ID,
    key_secret: env.CUSTOMER_RAZORPAY_KEY_SECRET
  });
};

export const verifyCustomerPaymentSignature = (
  orderId,
  paymentId,
  signature,
  secret = process.env.CUSTOMER_RAZORPAY_KEY_SECRET
) => {
  if (!orderId || !paymentId || !secret || !isHexSignature(signature)) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return safeEqualHex(signature, expected);
};

export const verifyCustomerSubscriptionPayment = async ({
  payment,
  orderId,
  paymentId,
  signature,
  secret,
  fetchProviderPayment,
  runTransaction
}) => {
  if (!verifyCustomerPaymentSignature(orderId, paymentId, signature, secret)) {
    return { status: "INVALID_SIGNATURE" };
  }
  if (
    typeof fetchProviderPayment !== "function" ||
    typeof runTransaction !== "function"
  ) {
    throw new TypeError("Payment verification requires provider and transaction handlers.");
  }

  const providerPayment = await fetchProviderPayment(paymentId);
  if (
    providerPayment?.id !== paymentId ||
    providerPayment?.order_id !== orderId ||
    providerPayment?.status !== "captured"
  ) {
    return { status: "PENDING" };
  }

  return runTransaction((tx) =>
    recordCapturedCustomerPayment(tx, payment, providerPayment)
  );
};

export const verifyCustomerWebhookSignature = (
  rawBody,
  signature,
  secret = process.env.CUSTOMER_RAZORPAY_WEBHOOK_SECRET
) => {
  if (!Buffer.isBuffer(rawBody) || !secret || !isHexSignature(signature)) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return safeEqualHex(signature, expected);
};

export const CUSTOMER_BILLING_CYCLES = Object.freeze([
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY"
]);

const customerCyclePriceFields = Object.freeze({
  MONTHLY: "monthlyPrice",
  QUARTERLY: "quarterlyPrice",
  HALF_YEARLY: "halfYearlyPrice",
  YEARLY: "yearlyPrice"
});

const customerCycleMonthCounts = Object.freeze({
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12
});

export const getCustomerPlanPrice = (plan, billingCycle) => {
  const field = customerCyclePriceFields[billingCycle];
  return field ? plan?.[field] ?? null : null;
};

export const isCustomerPlanEligibleForType = (plan, customerType) =>
  !plan?.eligibleCustomerTypes?.length ||
  plan.eligibleCustomerTypes.includes(customerType);

export const isCustomerPlanPurchasableForCycle = (plan, billingCycle) => {
  if (
    !plan?.isActive ||
    plan.pricingStatus !== "APPROVED" ||
    plan.pricingProposalStatus !== "APPROVED" ||
    plan.taxTermsStatus !== "APPROVED" ||
    plan.taxProposalStatus !== "APPROVED" ||
    !plan.taxTerms?.trim() ||
    !CUSTOMER_BILLING_CYCLES.includes(billingCycle)
  ) {
    return false;
  }

  const price = getCustomerPlanPrice(plan, billingCycle);
  return Number(price) > 0 && /^[A-Z]{3}$/.test(plan.currency || "");
};

export const addCustomerBillingPeriod = (date, billingCycle) => {
  const monthCount = customerCycleMonthCounts[billingCycle];
  if (!monthCount) {
    throw new TypeError("Unsupported customer subscription billing cycle");
  }
  const result = new Date(date);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + monthCount);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
};

export const amountInPaise = (amount) => {
  const numericAmount = Number(amount);
  const paise = Math.round(numericAmount * 100);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !Number.isSafeInteger(paise)) {
    throw new TypeError("Invalid customer subscription amount");
  }
  return paise;
};

export const recordCapturedCustomerPayment = async (
  tx,
  payment,
  providerPayment,
  now = new Date()
) => {
  if (payment.status === "PAID") return { status: "ALREADY_PAID" };
  if (payment.status !== "CREATED") return { status: "PAYMENT_NOT_PAYABLE" };

  if (
    typeof providerPayment?.id !== "string" ||
    !providerPayment.id ||
    providerPayment?.status !== "captured" ||
    providerPayment.order_id !== payment.razorpayOrderId ||
    (payment.razorpayPaymentId && payment.razorpayPaymentId !== providerPayment.id) ||
    providerPayment.currency !== payment.currency ||
    Number(providerPayment.amount) !== amountInPaise(payment.amount)
  ) {
    return { status: "PAYMENT_MISMATCH" };
  }

  const providerCreatedAt = Number(providerPayment.created_at);
  const providerDate =
    Number.isFinite(providerCreatedAt) && providerCreatedAt > 0
      ? new Date(providerCreatedAt * 1000)
      : null;
  const paidAt =
    providerDate && Number.isFinite(providerDate.getTime()) ? providerDate : now;
  const updated = await tx.customerSubscriptionPayment.updateMany({
    where: { id: payment.id, status: "CREATED" },
    data: {
      status: "PAID",
      razorpayPaymentId: providerPayment.id,
      paymentMethod: providerPayment.method || null,
      paidAt,
      errorCode: null
    }
  });
  if (updated.count !== 1) return { status: "PAYMENT_NOT_PAYABLE" };

  const subscriptionStatus =
    payment.periodStart > now ? "SCHEDULED" : "ACTIVE";
  await tx.customerSubscription.update({
    where: { id: payment.subscriptionId },
    data: {
      status: subscriptionStatus,
      startsAt: payment.periodStart,
      renewalAt: payment.periodEnd,
      endsAt: payment.periodEnd
    }
  });

  if (payment.periodStart > now) {
    await tx.customerSubscription.updateMany({
      where: {
        organisationId: payment.organisationId,
        customerId: payment.customerId,
        status: "ACTIVE",
        endsAt: { lte: payment.periodStart }
      },
      data: { cancelAtPeriodEnd: true }
    });
  }

  const invoiceNumber = `CS-INV-${payment.id}`;
  const receiptNumber = `CS-REC-${payment.id}`;
  const [customer, portalAccount] = await Promise.all([
    tx.customer.findUnique({
      where: { id: payment.customerId },
      select: { name: true, email: true }
    }),
    tx.customerPortalAccount.findUnique({
      where: { customerId: payment.customerId },
      select: { fullName: true, email: true }
    })
  ]);
  if (!customer) {
    throw new Error("Customer record is required to issue a payment receipt.");
  }

  await tx.customerSubscriptionInvoice.create({
    data: {
      organisationId: payment.organisationId,
      customerId: payment.customerId,
      paymentId: payment.id,
      invoiceNumber,
      planName: payment.planName,
      billingCycle: payment.billingCycle,
      amount: payment.amount,
      currency: payment.currency,
      taxTerms: payment.taxTerms,
      periodStart: payment.periodStart,
      periodEnd: payment.periodEnd
    }
  });
  await tx.customerSubscriptionReceipt.create({
    data: {
      organisationId: payment.organisationId,
      customerId: payment.customerId,
      paymentId: payment.id,
      receiptNumber,
      transactionId: providerPayment.id,
      customerName: portalAccount?.fullName || customer.name,
      customerEmail: portalAccount?.email || customer.email,
      paymentMethod: providerPayment.method || null,
      amount: payment.amount,
      currency: payment.currency,
      paidAt
    }
  });
  await tx.auditLog.create({
    data: {
      organisationId: payment.organisationId,
      action: "CUSTOMER_SUBSCRIPTION_PAYMENT_CAPTURED",
      entityType: "CustomerSubscriptionPayment",
      entityId: payment.id,
      metadata: { customerId: payment.customerId }
    }
  });

  return { status: subscriptionStatus, invoiceNumber, receiptNumber };
};
