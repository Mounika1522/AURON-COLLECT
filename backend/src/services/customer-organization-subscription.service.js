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

export const CUSTOMER_ORGANIZATION_PLAN_CODES = Object.freeze([
  "STARTER",
  "GROWTH",
  "BUSINESS"
]);

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
  idempotencyKey
}, {
  db = prisma,
  env = process.env,
  createOrderRecord = createBillingOrderRecord,
  createGatewayOrder = async ({ payment, amount }) => {
    const razorpay = createRazorpayClient(env);
    return razorpay.orders.create({
      amount,
      currency: payment.currency,
      receipt: payment.id,
      notes: {
        billingPaymentId: payment.id,
        planCode: payment.plan.code
      }
    });
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
    { customerId }
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
