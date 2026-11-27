import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createCustomerOrganizationBillingOrder,
  verifyCustomerOrganizationBillingPayment
} from "./customer-organization-subscription.service.js";

const testEnv = {
  NODE_ENV: "test",
  RAZORPAY_MODE: "test",
  RAZORPAY_KEY_ID: "rzp_test_checkout",
  RAZORPAY_KEY_SECRET: "test-only-secret"
};

const signatureFor = (orderId, paymentId) =>
  crypto
    .createHmac("sha256", testEnv.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

test("customer organization checkout uses only official monthly plan records and Test Mode", async () => {
  let orderRecordArgs;
  let gatewayOrderInput;
  let savedOrder;
  const result = await createCustomerOrganizationBillingOrder({
    organisationId: "org-from-session",
    customerId: "customer-from-session",
    planCode: "GROWTH",
    billingCycle: "MONTHLY",
    idempotencyKey: "portal-checkout-request-1234"
  }, {
    env: testEnv,
    createOrderRecord: async (...args) => {
      orderRecordArgs = args;
      return {
        record: {
          id: "billing-payment-1",
          organisationId: "org-from-session",
          customerId: "customer-from-session",
          amount: "2499.00",
          currency: "INR",
          status: "CREATING",
          plan: { code: "GROWTH", name: "Growth" }
        }
      };
    },
    createGatewayOrder: async (input) => {
      gatewayOrderInput = input;
      return { id: "order_test_1", amount: 249900, currency: "INR" };
    },
    saveGatewayOrder: async (payment, order) => {
      savedOrder = [payment.id, order.id];
    }
  });

  assert.equal(orderRecordArgs[0], "org-from-session");
  assert.equal(orderRecordArgs[1], null);
  assert.equal(orderRecordArgs[2], "GROWTH");
  assert.equal(orderRecordArgs[3], "MONTHLY");
  assert.deepEqual(orderRecordArgs[6], { customerId: "customer-from-session" });
  assert.equal(gatewayOrderInput.amount, 249900);
  assert.deepEqual(savedOrder, ["billing-payment-1", "order_test_1"]);
  assert.equal(result.payment.razorpayOrderId, "order_test_1");
});

test("customer checkout rejects Enterprise, non-monthly cycles and non-Test credentials", async () => {
  let recordCalls = 0;
  const dependencies = {
    env: testEnv,
    createOrderRecord: async () => {
      recordCalls += 1;
      return { record: {} };
    },
    createGatewayOrder: async () => ({ id: "order_test", amount: 99900, currency: "INR" })
  };
  await assert.rejects(
    createCustomerOrganizationBillingOrder({
      organisationId: "org-1",
      customerId: "customer-1",
      planCode: "ENTERPRISE",
      billingCycle: "MONTHLY",
      idempotencyKey: "portal-checkout-request-1234"
    }, dependencies),
    { code: "CUSTOMER_ORGANIZATION_PLAN_INVALID" }
  );
  await assert.rejects(
    createCustomerOrganizationBillingOrder({
      organisationId: "org-1",
      customerId: "customer-1",
      planCode: "STARTER",
      billingCycle: "YEARLY",
      idempotencyKey: "portal-checkout-request-1234"
    }, dependencies),
    { code: "CUSTOMER_ORGANIZATION_PLAN_INVALID" }
  );
  await assert.rejects(
    createCustomerOrganizationBillingOrder({
      organisationId: "org-1",
      customerId: "customer-1",
      planCode: "STARTER",
      billingCycle: "MONTHLY",
      idempotencyKey: "portal-checkout-request-1234"
    }, {
      ...dependencies,
      env: { ...testEnv, RAZORPAY_MODE: "live", RAZORPAY_KEY_ID: "rzp_live_not-allowed" }
    }),
    { code: "RAZORPAY_TEST_MODE_UNAVAILABLE" }
  );
  assert.equal(recordCalls, 0);
});

test("customer payment verification rejects bad signatures and reports uncaptured payments as pending", async () => {
  let providerCalls = 0;
  let transactionCalls = 0;
  const input = {
    payment: { id: "billing-payment-1" },
    orderId: "order_test_1",
    paymentId: "pay_test_1",
    signature: "invalid"
  };
  const dependencies = {
    env: testEnv,
    fetchProviderPayment: async () => {
      providerCalls += 1;
      return {
        id: "pay_test_1",
        order_id: "order_test_1",
        status: "authorized"
      };
    },
    runTransaction: async () => {
      transactionCalls += 1;
      return { status: "PAID" };
    }
  };

  assert.deepEqual(
    await verifyCustomerOrganizationBillingPayment(input, dependencies),
    { status: "INVALID_SIGNATURE" }
  );
  assert.equal(providerCalls, 0);
  assert.deepEqual(
    await verifyCustomerOrganizationBillingPayment({
      ...input,
      signature: signatureFor(input.orderId, input.paymentId)
    }, dependencies),
    { status: "PENDING" }
  );
  assert.equal(providerCalls, 1);
  assert.equal(transactionCalls, 0);
});

test("captured customer payments are committed only through the verified billing transaction", async () => {
  const now = new Date();
  const payment = {
    id: "billing-payment-1",
    organisationId: "org-1",
    planId: "plan-1",
    status: "CREATED",
    billingCycle: "MONTHLY",
    amount: 999,
    currency: "INR",
    razorpayOrderId: "order_test_1",
    effectiveAt: new Date(now.getTime() - 1000),
    periodEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  };
  let subscriptionCreates = 0;
  const tx = {
    $queryRaw: async () => [],
    billingPayment: {
      findUnique: async () => payment,
      update: async ({ data }) => ({
        ...payment,
        ...data,
        plan: { code: "STARTER", name: "Starter" },
        subscription: { id: "sub-1" }
      })
    },
    subscription: {
      create: async ({ data }) => {
        subscriptionCreates += 1;
        return { id: "sub-1", ...data };
      }
    },
    customer: { findUnique: async () => ({ name: "Test customer", email: "customer@example.invalid" }) },
    customerPortalAccount: { findUnique: async () => null },
    billingInvoice: { create: async ({ data }) => ({ id: "invoice-1", ...data }) },
    auditLog: { create: async () => ({ id: "audit-1" }) }
  };
  const result = await verifyCustomerOrganizationBillingPayment({
    payment,
    orderId: "order_test_1",
    paymentId: "pay_test_1",
    signature: signatureFor("order_test_1", "pay_test_1")
  }, {
    env: testEnv,
    fetchProviderPayment: async () => ({
      id: "pay_test_1",
      order_id: "order_test_1",
      status: "captured",
      currency: "INR",
      amount: 99900,
      created_at: Math.floor(now.getTime() / 1000)
    }),
    runTransaction: async (callback) => callback(tx)
  });

  assert.equal(result.status, "PAID");
  assert.equal(subscriptionCreates, 1);
});
