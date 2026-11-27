import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  addCustomerBillingPeriod,
  assertCustomerSubscriptionTestMode,
  getCustomerPlanPrice,
  isCustomerPlanEligibleForType,
  isCustomerPlanPurchasableForCycle,
  recordCapturedCustomerPayment,
  verifyCustomerPaymentSignature,
  verifyCustomerSubscriptionPayment,
  verifyCustomerWebhookSignature
} from "./customer-subscription.service.js";

test("customer subscription checkout accepts only complete Test Mode credentials", () => {
  assert.doesNotThrow(() => assertCustomerSubscriptionTestMode({
    CUSTOMER_RAZORPAY_MODE: "test",
    CUSTOMER_RAZORPAY_KEY_ID: "rzp_test_example",
    CUSTOMER_RAZORPAY_KEY_SECRET: "test-secret",
    CUSTOMER_RAZORPAY_WEBHOOK_SECRET: "webhook-secret"
  }));
  assert.throws(() => assertCustomerSubscriptionTestMode({
    CUSTOMER_RAZORPAY_MODE: "live",
    CUSTOMER_RAZORPAY_KEY_ID: "rzp_live_example",
    CUSTOMER_RAZORPAY_KEY_SECRET: "live-secret",
    CUSTOMER_RAZORPAY_WEBHOOK_SECRET: "webhook-secret"
  }), { code: "CUSTOMER_SUBSCRIPTION_TEST_UNAVAILABLE" });
  assert.throws(() => assertCustomerSubscriptionTestMode({
    CUSTOMER_RAZORPAY_MODE: "test",
    CUSTOMER_RAZORPAY_KEY_ID: "rzp_test_example",
    CUSTOMER_RAZORPAY_KEY_SECRET: "test-secret"
  }), { code: "CUSTOMER_SUBSCRIPTION_TEST_UNAVAILABLE" });
});

test("customer subscription periods clamp month ends and require approved prices/tax terms", () => {
  assert.equal(
    addCustomerBillingPeriod(new Date("2025-01-31T12:00:00.000Z"), "MONTHLY").toISOString(),
    "2025-02-28T12:00:00.000Z"
  );
  assert.equal(
    addCustomerBillingPeriod(new Date("2025-01-31T12:00:00.000Z"), "QUARTERLY").toISOString(),
    "2025-04-30T12:00:00.000Z"
  );
  assert.equal(
    addCustomerBillingPeriod(new Date("2024-02-29T12:00:00.000Z"), "YEARLY").toISOString(),
    "2025-02-28T12:00:00.000Z"
  );
  const plan = {
    isActive: true,
    pricingStatus: "APPROVED",
    pricingProposalStatus: "APPROVED",
    taxTermsStatus: "APPROVED",
    taxProposalStatus: "APPROVED",
    taxTerms: "No tax calculation included.",
    monthlyPrice: 100,
    quarterlyPrice: 275,
    halfYearlyPrice: 525,
    yearlyPrice: 1000,
    currency: "INR",
    eligibleCustomerTypes: ["BUSINESS"]
  };
  assert.equal(isCustomerPlanPurchasableForCycle(plan, "YEARLY"), true);
  assert.equal(isCustomerPlanPurchasableForCycle(plan, "QUARTERLY"), true);
  assert.equal(getCustomerPlanPrice(plan, "HALF_YEARLY"), 525);
  assert.equal(isCustomerPlanEligibleForType(plan, "BUSINESS"), true);
  assert.equal(isCustomerPlanEligibleForType(plan, "INDIVIDUAL"), false);
  assert.equal(isCustomerPlanEligibleForType({ ...plan, eligibleCustomerTypes: [] }, "INDIVIDUAL"), true);
  assert.equal(isCustomerPlanPurchasableForCycle({ ...plan, taxTerms: "" }, "YEARLY"), false);
});

test("customer payment and webhook signatures are checked against exact HMAC data", () => {
  const secret = "unit-test-secret";
  const orderId = "order_test_1";
  const paymentId = "pay_test_1";
  const signature = crypto.createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  assert.equal(verifyCustomerPaymentSignature(orderId, paymentId, signature, secret), true);
  assert.equal(verifyCustomerPaymentSignature(orderId, paymentId, "0".repeat(64), secret), false);
  assert.equal(verifyCustomerPaymentSignature(orderId, paymentId, "invalid", secret), false);

  const body = Buffer.from('{"event":"payment.captured"}');
  const webhookSignature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyCustomerWebhookSignature(body, webhookSignature, secret), true);
  assert.equal(verifyCustomerWebhookSignature(body.toString(), webhookSignature, secret), false);
});

test("customer payment verification rejects invalid signatures and does not record failed or pending provider states", async () => {
  const secret = "test-only-verification-secret";
  const orderId = "order_test_only";
  const paymentId = "pay_test_only";
  const signature = crypto.createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  let fetchCount = 0;
  let transactionCount = 0;

  const verify = (providerStatus, providedSignature = signature) =>
    verifyCustomerSubscriptionPayment({
      payment: { id: "payment_test_only" },
      orderId,
      paymentId,
      signature: providedSignature,
      secret,
      fetchProviderPayment: async () => {
        fetchCount += 1;
        return {
          id: paymentId,
          order_id: orderId,
          status: providerStatus
        };
      },
      runTransaction: async () => {
        transactionCount += 1;
        return { status: "PAID" };
      }
    });

  assert.deepEqual(await verify("captured", "0".repeat(64)), {
    status: "INVALID_SIGNATURE"
  });
  assert.equal(fetchCount, 0);
  assert.equal(transactionCount, 0);

  assert.deepEqual(await verify("failed"), { status: "PENDING" });
  assert.deepEqual(await verify("authorized"), { status: "PENDING" });
  assert.equal(fetchCount, 2);
  assert.equal(transactionCount, 0);
});

test("only a matching captured provider payment can activate the customer subscription", async () => {
  const payment = {
    id: "customer-payment-1",
    status: "CREATED",
    organisationId: "org-1",
    customerId: "customer-1",
    subscriptionId: "subscription-1",
    amount: 125,
    currency: "INR",
    razorpayOrderId: "order_test_2",
    razorpayPaymentId: null,
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2026-02-01T00:00:00.000Z"),
    planName: "Professional",
    billingCycle: "MONTHLY",
    taxTerms: "Tax not inferred."
  };
  const writes = [];
  const tx = {
    customerSubscriptionPayment: {
      updateMany: async ({ data }) => {
        writes.push(["payment", data]);
        return { count: 1 };
      }
    },
    customer: {
      findUnique: async () => ({
        name: "Receipt Test Customer",
        email: "billing@example.test"
      })
    },
    customerPortalAccount: {
      findUnique: async () => ({
        fullName: "Portal Customer",
        email: "registered@example.test"
      })
    },
    customerSubscription: {
      update: async ({ data }) => writes.push(["subscription", data]),
      updateMany: async () => ({ count: 0 })
    },
    customerSubscriptionInvoice: {
      create: async () => writes.push(["invoice"])
    },
    customerSubscriptionReceipt: {
      create: async ({ data }) => writes.push(["receipt", data])
    },
    auditLog: { create: async () => writes.push(["audit"]) }
  };

  const pending = await recordCapturedCustomerPayment(tx, payment, {
    id: "pay_test_2",
    order_id: "order_test_2",
    status: "authorized",
    currency: "INR",
    amount: 12500
  });
  assert.equal(pending.status, "PAYMENT_MISMATCH");
  assert.deepEqual(writes, []);

  const failedPayment = await recordCapturedCustomerPayment(
    tx,
    { ...payment, status: "FAILED" },
    {
      id: "pay_test_2",
      order_id: "order_test_2",
      status: "captured",
      currency: "INR",
      amount: 12500
    }
  );
  assert.equal(failedPayment.status, "PAYMENT_NOT_PAYABLE");
  assert.deepEqual(writes, []);

  const result = await recordCapturedCustomerPayment(tx, payment, {
    id: "pay_test_2",
    order_id: "order_test_2",
    status: "captured",
    currency: "INR",
    amount: 12500,
    created_at: Date.parse("2026-01-05T00:00:00.000Z") / 1000,
    method: "card"
  }, new Date("2026-01-10T00:00:00.000Z"));
  assert.equal(result.status, "ACTIVE");
  assert.ok(writes.some(([type, data]) =>
    type === "payment" &&
    data.status === "PAID" &&
    data.razorpayPaymentId === "pay_test_2" &&
    data.paymentMethod === "card" &&
    data.paidAt.toISOString() === "2026-01-05T00:00:00.000Z"
  ));
  assert.ok(writes.some(([type, data]) =>
    type === "receipt" &&
    data.transactionId === "pay_test_2" &&
    data.customerName === "Portal Customer" &&
    data.customerEmail === "registered@example.test" &&
    data.paymentMethod === "card"
  ));
  assert.ok(writes.some(([type, data]) => type === "subscription" && data.status === "ACTIVE"));

  const writeCount = writes.length;
  const duplicate = await recordCapturedCustomerPayment(
    tx,
    { ...payment, status: "PAID" },
    {
      id: "pay_test_2",
      order_id: "order_test_2",
      status: "captured",
      currency: "INR",
      amount: 12500
    }
  );
  assert.equal(duplicate.status, "ALREADY_PAID");
  assert.equal(writes.length, writeCount);
});
