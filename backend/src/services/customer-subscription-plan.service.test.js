import assert from "node:assert/strict";
import test from "node:test";
import {
  canActivateCustomerPlan,
  CustomerPlanValidationError,
  normalizeCustomerPlanInput
} from "./customer-subscription-plan.service.js";

test("customer plan inputs preserve tenant-specific eligible types and normalize descriptive terms", () => {
  const result = normalizeCustomerPlanInput({
    code: "custom-annual",
    name: "Custom Annual",
    currency: "INR",
    proposedYearlyPrice: "1200",
    proposedTaxTerms: " GST as applicable ",
    features: [" Account support ", "Account support"],
    usageLimits: { seats: 5, projects: null },
    eligibleCustomerTypes: ["BUSINESS"]
  }, { customerTypes: ["BUSINESS", "INDIVIDUAL"] });

  assert.equal(result.pricingChanged, true);
  assert.equal(result.taxChanged, true);
  assert.equal(result.data.proposedYearlyPrice, "1200.00");
  assert.equal(result.data.proposedTaxTerms, "GST as applicable");
  assert.deepEqual(result.data.features, ["Account support"]);
  assert.deepEqual(result.data.usageLimits, { seats: 5, projects: null });
  assert.deepEqual(result.data.eligibleCustomerTypes, ["BUSINESS"]);
});

test("customer plan input rejects a customer type outside the organization", () => {
  assert.throws(() => normalizeCustomerPlanInput({
    code: "foreign-eligibility",
    name: "Foreign Eligibility",
    eligibleCustomerTypes: ["OTHER_ORG_TYPE"]
  }, { customerTypes: ["BUSINESS"] }), CustomerPlanValidationError);
});

test("customer plan input rejects malformed activation and duplicate normalized limits", () => {
  assert.throws(() => normalizeCustomerPlanInput({
    code: "bad-activation",
    name: "Bad Activation",
    isActive: "true"
  }), CustomerPlanValidationError);
  assert.throws(() => normalizeCustomerPlanInput({
    code: "duplicate-limits",
    name: "Duplicate Limits",
    usageLimits: { seats: 5, "seats ": 10 }
  }), CustomerPlanValidationError);
});

test("a customer plan is activatable only after separate pricing and tax approvals", () => {
  const plan = {
    pricingStatus: "APPROVED",
    pricingProposalStatus: "APPROVED",
    monthlyPrice: null,
    quarterlyPrice: 300,
    halfYearlyPrice: null,
    yearlyPrice: null,
    taxTermsStatus: "APPROVED",
    taxProposalStatus: "APPROVED",
    taxTerms: "GST included"
  };
  assert.equal(canActivateCustomerPlan(plan), true);
  assert.equal(canActivateCustomerPlan({ ...plan, taxProposalStatus: "PENDING_APPROVAL" }), false);
  assert.equal(canActivateCustomerPlan({ ...plan, quarterlyPrice: null }), false);
});
