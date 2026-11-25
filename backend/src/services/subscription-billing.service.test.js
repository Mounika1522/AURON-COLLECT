import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  addBillingPeriod,
  amountInPaise,
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
