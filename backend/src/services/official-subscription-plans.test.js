import assert from "node:assert/strict";
import test from "node:test";
import {
  getOfficialSubscriptionPlan,
  getOfficialSubscriptionPlanCodes,
  projectSubscriptionPlanForCatalog
} from "./official-subscription-plans.js";

test("official plan codes, names and monthly prices are fixed in the backend catalog", () => {
  assert.deepEqual(getOfficialSubscriptionPlanCodes(), [
    "STARTER",
    "GROWTH",
    "BUSINESS",
    "ENTERPRISE"
  ]);
  assert.equal(getOfficialSubscriptionPlan("starter").monthlyPrice, "999.00");
  assert.equal(getOfficialSubscriptionPlan("GROWTH").monthlyPrice, "2499.00");
  assert.equal(getOfficialSubscriptionPlan("BUSINESS").monthlyPrice, "5999.00");
  assert.equal(getOfficialSubscriptionPlan("ENTERPRISE").monthlyPrice, null);
});

test("catalog projection fixes official monthly prices without changing approval or limit records", () => {
  const pendingStarter = {
    id: "starter-plan",
    code: "STARTER",
    name: "Old name",
    isActive: false,
    pricingStatus: "PENDING_APPROVAL",
    limitsStatus: "PENDING_APPROVAL",
    proposedMonthlyPrice: "999.00",
    monthlyPrice: null,
    yearlyPrice: null,
    maxUsers: null,
    currency: "INR"
  };
  const projected = projectSubscriptionPlanForCatalog(pendingStarter);

  assert.equal(projected.isBuiltIn, true);
  assert.equal(projected.monthlyPrice, "999.00");
  assert.equal(projected.yearlyPrice, null);
  assert.equal(projected.name, "Starter");
  assert.equal(projected.pricingStatus, "PENDING_APPROVAL");
  assert.equal(projected.limitsStatus, "PENDING_APPROVAL");
  assert.equal(projected.maxUsers, null);
  assert.equal(pendingStarter.monthlyPrice, null);
});

