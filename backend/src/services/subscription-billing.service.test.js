import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  addBillingPeriod,
  amountInPaise,
  createBillingOrderRecord,
  isPlanPurchasableForCycle,
  recordCapturedPayment
} from "./subscription-billing.service.js";

test("billing periods clamp end-of-month dates without overflowing", () => {
  assert.equal(
    addBillingPeriod(new Date("2025-01-31T12:30:00.000Z"), "MONTHLY").toISOString(),
    "2025-02-28T12:30:00.000Z"
  );
  assert.equal(
    addBillingPeriod(new Date("2024-02-29T12:30:00.000Z"), "YEARLY").toISOString(),
    "2025-02-28T12:30:00.000Z"
  );
  assert.equal(amountInPaise(new Prisma.Decimal("2499.00")), 249900);
});

test("only fully approved plans with a configured cycle price are purchasable", () => {
  const pendingPlan = {
    isActive: false,
    pricingStatus: "PENDING_APPROVAL",
    limitsStatus: "PENDING_APPROVAL",
    monthlyPrice: null,
    yearlyPrice: null,
    currency: "INR"
  };
  assert.equal(isPlanPurchasableForCycle(pendingPlan, "MONTHLY"), false);
  assert.equal(isPlanPurchasableForCycle({
    ...pendingPlan,
    isActive: true,
    pricingStatus: "APPROVED",
    limitsStatus: "APPROVED",
    pricingProposalStatus: "PENDING_APPROVAL",
    limitsProposalStatus: "PENDING_APPROVAL",
    monthlyPrice: new Prisma.Decimal("999.00")
  }, "MONTHLY"), true);
  assert.equal(isPlanPurchasableForCycle({
    ...pendingPlan,
    isActive: true,
    pricingStatus: "APPROVED",
    limitsStatus: "APPROVED",
    monthlyPrice: new Prisma.Decimal("999.00")
  }, "YEARLY"), false);
});

test("built-in monthly plan orders use fixed official pricing without admin approval", async () => {
  const pendingStarter = {
    id: "starter-plan",
    code: "STARTER",
    name: "Starter",
    isActive: false,
    pricingStatus: "PENDING_APPROVAL",
    limitsStatus: "PENDING_APPROVAL",
    monthlyPrice: null,
    proposedMonthlyPrice: new Prisma.Decimal("1500.00"),
    currency: "USD"
  };
  let createdPayment;
  const tx = {
    $queryRaw: async () => [],
    billingPayment: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }) => {
        createdPayment = data;
        return { id: "billing-payment-1", ...data, plan: pendingStarter };
      }
    },
    subscription: {
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null
    },
    subscriptionPlan: {
      findUnique: async () => pendingStarter
    }
  };
  const db = {
    $transaction: async (callback) => callback(tx)
  };

  assert.equal(isPlanPurchasableForCycle(pendingStarter, "MONTHLY"), true);
  assert.equal(isPlanPurchasableForCycle(pendingStarter, "YEARLY"), false);
  const result = await createBillingOrderRecord(
    "org-1",
    "user-1",
    "STARTER",
    "MONTHLY",
    "subscription-order-001",
    db,
    { customerId: "customer-1" }
  );

  assert.equal(result.record.id, "billing-payment-1");
  assert.equal(createdPayment.amount.toFixed(2), "999.00");
  assert.equal(createdPayment.currency, "INR");
  assert.equal(createdPayment.planId, "starter-plan");
  assert.equal(createdPayment.customerId, "customer-1");
});

test("an active Growth subscription can schedule a Business upgrade at renewal", async () => {
  const now = new Date();
  const growthEndsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const businessPlan = {
    id: "business-plan",
    code: "BUSINESS",
    name: "Business",
    currency: "INR"
  };
  const growthSubscription = {
    plan: { code: "GROWTH", name: "Growth" },
    status: "ACTIVE",
    startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    endsAt: growthEndsAt
  };
  let createdPayment;
  const tx = {
    $queryRaw: async () => [],
    billingPayment: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }) => {
        createdPayment = data;
        return { id: "business-payment-1", ...data, plan: businessPlan };
      }
    },
    subscription: {
      updateMany: async () => ({ count: 0 }),
      findFirst: async ({ where }) =>
        where.status === "ACTIVE" ? growthSubscription : null
    },
    subscriptionPlan: {
      findUnique: async () => businessPlan
    }
  };

  const result = await createBillingOrderRecord(
    "org-1",
    "user-1",
    "BUSINESS",
    "MONTHLY",
    "business-upgrade-order-001",
    { $transaction: async (callback) => callback(tx) }
  );

  assert.equal(result.record.id, "business-payment-1");
  assert.equal(createdPayment.amount.toFixed(2), "5999.00");
  assert.equal(createdPayment.effectiveAt.getTime(), growthEndsAt.getTime());
});

test("an identical pending order is reused instead of creating a duplicate", async () => {
  const pendingOrder = {
    id: "business-payment-1",
    status: "CREATED",
    planId: "business-plan",
    billingCycle: "MONTHLY",
    customerId: "customer-1",
    razorpayOrderId: "order_test_business",
    plan: { id: "business-plan", code: "BUSINESS", name: "Business" }
  };
  let createCalls = 0;
  const tx = {
    $queryRaw: async () => [],
    billingPayment: {
      findUnique: async () => null,
      findFirst: async () => pendingOrder,
      create: async () => {
        createCalls += 1;
        throw new Error("A duplicate order must not be created");
      }
    },
    subscriptionPlan: {
      findUnique: async () => pendingOrder.plan
    }
  };

  const result = await createBillingOrderRecord(
    "org-1",
    null,
    "BUSINESS",
    "MONTHLY",
    "business-upgrade-order-002",
    { $transaction: async (callback) => callback(tx) },
    { customerId: "customer-1" }
  );

  assert.equal(result.existing.id, pendingOrder.id);
  assert.equal(createCalls, 0);
});

test("a pending different-plan order blocks a duplicate checkout with a specific conflict", async () => {
  const pendingOrder = {
    id: "starter-payment-1",
    status: "CREATED",
    planId: "starter-plan",
    billingCycle: "MONTHLY",
    customerId: "customer-1",
    razorpayOrderId: "order_test_starter",
    plan: { id: "starter-plan", code: "STARTER", name: "Starter" }
  };
  let createCalls = 0;
  const tx = {
    $queryRaw: async () => [],
    billingPayment: {
      findUnique: async () => null,
      findFirst: async () => pendingOrder,
      create: async () => {
        createCalls += 1;
        throw new Error("A second pending order must not be created");
      }
    },
    subscriptionPlan: {
      findUnique: async () => ({ id: "business-plan", code: "BUSINESS", name: "Business" })
    }
  };

  await assert.rejects(
    createBillingOrderRecord(
      "org-1",
      null,
      "BUSINESS",
      "MONTHLY",
      "business-upgrade-order-003",
      { $transaction: async (callback) => callback(tx) },
      { customerId: "customer-1" }
    ),
    (error) => {
      assert.equal(error.code, "BILLING_ORDER_PENDING");
      assert.equal(
        error.message,
        "A Starter monthly checkout is still pending. Resolve it before starting a Business monthly checkout."
      );
      assert.deepEqual(error.details, {
        pendingPlanCode: "STARTER",
        requestedPlanCode: "BUSINESS"
      });
      return true;
    }
  );
  assert.equal(createCalls, 0);
});

test("only an exactly matching captured order can create a subscription and invoice", async () => {
  const currentPayment = {
    id: "billing-payment-1",
    status: "CREATED",
    organisationId: "org-1",
    planId: "plan-1",
    billingCycle: "MONTHLY",
    amount: new Prisma.Decimal("100.00"),
    currency: "INR",
    razorpayOrderId: "order_test_1",
    razorpayPaymentId: null,
    effectiveAt: new Date("2025-01-01T00:00:00.000Z"),
    periodEndsAt: new Date("2025-02-01T00:00:00.000Z"),
    createdBy: "user-1"
  };
  const created = [];
  const tx = {
    $queryRaw: async () => [],
    billingPayment: {
      findUnique: async () => currentPayment,
      update: async ({ data }) => ({
        ...currentPayment,
        ...data,
        plan: { code: "STARTER", name: "Starter" },
        subscription: { id: "subscription-1" }
      })
    },
    subscription: {
      create: async ({ data }) => {
        created.push("subscription");
        return { id: "subscription-1", ...data };
      }
    },
    billingInvoice: {
      create: async ({ data }) => {
        created.push("invoice");
        return { id: "invoice-1", ...data };
      }
    },
    auditLog: {
      create: async () => {
        created.push("audit");
      }
    }
  };

  const mismatch = await recordCapturedPayment(tx, currentPayment, {
    id: "pay_test_1",
    order_id: "order_test_1",
    status: "authorized",
    currency: "INR",
    amount: 10000
  });
  assert.equal(mismatch.status, "PAYMENT_MISMATCH");
  assert.deepEqual(created, []);

  const success = await recordCapturedPayment(tx, currentPayment, {
    id: "pay_test_1",
    order_id: "order_test_1",
    status: "captured",
    currency: "INR",
    amount: 10000
  }, new Date("2025-01-15T00:00:00.000Z"));
  assert.equal(success.status, "PAID");
  assert.deepEqual(created, ["subscription", "invoice", "audit"]);
});
