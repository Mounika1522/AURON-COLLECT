import prisma from "../config/prisma.js";
import {
  assertRazorpayTestMode,
  createRazorpayClient,
  verifyPaymentSignature
} from "./razorpay.service.js";
import {
  amountInPaise,
  createBillingOrderRecord,
  recordCapturedPayment,
  writeBillingOrderCreatedAudit
} from "./subscription-billing.service.js";
import { buildTokenizedCheckoutOptions } from "./subscription-auto-renewal.service.js";

export const CUSTOMER_ORGANIZATION_PLAN_CODES = Object.freeze([
  "STARTER",
  "GROWTH",
  "BUSINESS"
]);

export const getCustomerOrganizationBillingPayments = async (
  db,
  organisationId
) => {
  const payments = await db.billingPayment.findMany({
    where: { organisationId },
    select: {
      id: true,
      status: true,
      billingCycle: true,
      amount: true,
      currency: true,
      effectiveAt: true,
      periodEndsAt: true,
      paidAt: true,
      createdAt: true,
      razorpayPaymentId: true,
      plan: { select: { code: true, name: true } },
      invoice: { select: { id: true, invoiceNumber: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 20
  });

  return payments.map((payment) => ({
    ...payment,
    planName: payment.plan.name,
    amount: Number(payment.amount)
  }));
};

const isValidOrderInput = ({ planCode, billingCycle, idempotencyKey }) =>
  CUSTOMER_ORGANIZATION_PLAN_CODES.includes(planCode) &&
  billingCycle === "MONTHLY" &&
  typeof idempotencyKey === "string" &&
  /^[a-zA-Z0-9._:-]{16,80}$/.test(idempotencyKey);

export const createCustomerOrganizationBillingOrder = async ({
  organisationId,
  customerId,
  planCode,
  billingCycle,
  idempotencyKey,
  autoRenewRequested = false,
  contact = ""
}, {
  db = prisma,
  env = process.env,
  createOrderRecord = createBillingOrderRecord,
  createGatewayOrder = async ({ payment, amount }) => {
    const razorpay = createRazorpayClient(env);
    let razorpayCustomerId = payment.razorpayCustomerId;
    if (payment.autoRenewRequested && !razorpayCustomerId) {
      const customer = await db.customer.findFirst({
        where: { id: customerId, organisationId },
        select: {
          name: true,
          email: true,
          phone: true,
          portalAccount: { select: { fullName: true, email: true } }
        }
      });
      const phone = contact || customer?.phone || "";
      if (!/^[+\d][\d\s().-]{6,19}$/.test(phone)) {
        const error = new Error("A billing phone number is required for auto-renew.");
        error.code = "BILLING_AUTORENEW_PHONE_REQUIRED";
        throw error;
      }
      const providerCustomer = await razorpay.customers.create({
        name: customer?.portalAccount?.fullName || customer?.name || "Customer",
        email: customer?.portalAccount?.email || customer?.email,
        contact: phone,
        fail_existing: "0",
        notes: { organisationId, customerId }
      });
      if (typeof providerCustomer?.id !== "string" || !providerCustomer.id) {
        throw new Error("Razorpay did not return a customer ID.");
      }
      razorpayCustomerId = providerCustomer.id;
      await db.billingPayment.update({
        where: { id: payment.id },
        data: { razorpayCustomerId }
      });
      payment.razorpayCustomerId = razorpayCustomerId;
    }

    const notes = {
      billingPaymentId: payment.id,
      planCode: payment.plan.code
    };
    const request = payment.autoRenewRequested
      ? buildTokenizedCheckoutOptions({
          amount,
          currency: payment.currency,
          customerId: razorpayCustomerId,
          receipt: payment.id,
          notes
        })
      : { amount, currency: payment.currency, receipt: payment.id, notes };
    return razorpay.orders.create(request);
  },
  saveGatewayOrder = async (payment, gatewayOrder) =>
    db.$transaction(async (tx) => {
      const updated = await tx.billingPayment.updateMany({
        where: { id: payment.id, status: "CREATING" },
        data: { status: "CREATED", razorpayOrderId: gatewayOrder.id }
      });
      if (updated.count !== 1) {
        throw new Error("Billing order state changed unexpectedly");
      }
      await writeBillingOrderCreatedAudit(tx, payment);
    }),
  markGatewayOrderFailed = async (payment) =>
    db.$transaction(async (tx) => {
      await tx.billingPayment.updateMany({
        where: { id: payment.id, status: "CREATING" },
        data: { status: "FAILED", errorCode: "ORDER_CREATION_FAILED" }
      });
      await tx.auditLog.create({
        data: {
          organisationId: payment.organisationId,
          actorUserId: null,
          action: "SUBSCRIPTION_ORDER_CREATION_FAILED",
          entityType: "BILLING_PAYMENT",
          entityId: payment.id,
          metadata: { errorCode: "ORDER_CREATION_FAILED" }
        }
      });
    })
} = {}) => {
  assertRazorpayTestMode(env);
  if (!isValidOrderInput({ planCode, billingCycle, idempotencyKey })) {
    const error = new Error("Select an available official monthly plan.");
    error.code = "CUSTOMER_ORGANIZATION_PLAN_INVALID";
    throw error;
  }

  const record = await createOrderRecord(
    organisationId,
    null,
    planCode,
    billingCycle,
    idempotencyKey,
    db,
    { customerId, autoRenewRequested }
  );
  const payment = record.existing || record.record;
  if (record.existing) {
    return {
      payment,
      existing: true,
      alreadyPaid: payment.status === "PAID"
    };
  }

  const amount = amountInPaise(payment.amount);
  try {
    const gatewayOrder = await createGatewayOrder({ payment, amount });
    if (
      typeof gatewayOrder?.id !== "string" ||
      !gatewayOrder.id ||
      gatewayOrder.amount !== amount ||
      gatewayOrder.currency !== payment.currency
    ) {
      throw new Error("Gateway order response did not match billing record");
    }

    await saveGatewayOrder(payment, gatewayOrder);
    return {
      payment: {
        ...payment,
        status: "CREATED",
        razorpayOrderId: gatewayOrder.id
      },
      existing: false,
      alreadyPaid: false
    };
  } catch (error) {
    await markGatewayOrderFailed(payment);
    throw error;
  }
};

export const verifyCustomerOrganizationBillingPayment = async ({
  payment,
  orderId,
  paymentId,
  signature
}, {
  env = process.env,
  fetchProviderPayment,
  runTransaction
} = {}) => {
  assertRazorpayTestMode(env);
  if (
    !verifyPaymentSignature(
      orderId,
      paymentId,
      signature,
      env.RAZORPAY_KEY_SECRET
    )
  ) {
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
    providerPayment?.order_id !== orderId
  ) {
    return { status: "PAYMENT_MISMATCH" };
  }
  if (providerPayment.status !== "captured") {
    return { status: "PENDING" };
  }

  return runTransaction((tx) =>
    recordCapturedPayment(tx, payment, providerPayment)
  );
};
