import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessOrganizationBillingPortal,
  canViewOrganizationBillingPlans,
  canCheckoutOfficialPlan,
  getOfficialPlanChangeAction,
  getApprovedSubscriptionBillingCycles,
  getOfficialMonthlyPriceLabel,
  OFFICIAL_SAAS_PLANS
} from './subscription-plans.js';

test('organization plan portal is restricted to organization admins and owners', () => {
  assert.equal(canAccessOrganizationBillingPortal('ADMIN'), true);
  assert.equal(canAccessOrganizationBillingPortal('OWNER'), true);
  assert.equal(canAccessOrganizationBillingPortal('SUPER_ADMIN'), false);
  assert.equal(canAccessOrganizationBillingPortal('COLLECTOR'), false);
  assert.equal(canAccessOrganizationBillingPortal('CUSTOMER'), false);
  assert.equal(canAccessOrganizationBillingPortal(null), false);
  assert.equal(canViewOrganizationBillingPlans({ role: undefined }), false);
  assert.equal(
    canViewOrganizationBillingPlans({ role: undefined, customerPortalAccess: true }),
    true
  );
  assert.equal(
    canViewOrganizationBillingPlans({ role: 'CUSTOMER', readOnly: true }),
    true
  );
});

test("official plan actions distinguish subscription upgrades and downgrades", () => {
  assert.equal(getOfficialPlanChangeAction("STARTER", null), "Subscribe");
  assert.equal(getOfficialPlanChangeAction("GROWTH", "STARTER"), "Upgrade");
  assert.equal(getOfficialPlanChangeAction("STARTER", "BUSINESS"), "Downgrade");
  assert.equal(getOfficialPlanChangeAction("GROWTH", "GROWTH"), "Current Plan");
});

test("official monthly plan prices match the product pricing", () => {
  assert.deepEqual(
    OFFICIAL_SAAS_PLANS.map(({ code, monthlyPrice }) => [code, monthlyPrice]),
    [
      ['STARTER', 999],
      ['GROWTH', 2499],
      ['BUSINESS', 5999],
      ['ENTERPRISE', null]
    ]
  );
});

test("annual billing is offered only when an active plan has approved annual pricing and limits", () => {
  assert.deepEqual(getApprovedSubscriptionBillingCycles([]), [
    { value: 'MONTHLY', label: 'Monthly' }
  ]);
  assert.deepEqual(
    getApprovedSubscriptionBillingCycles([{
      code: 'STARTER',
      isActive: true,
      pricingStatus: 'APPROVED',
      limitsStatus: 'PENDING_APPROVAL',
      yearlyPrice: 12000
    }]),
    [{ value: 'MONTHLY', label: 'Monthly' }]
  );
  assert.deepEqual(
    getApprovedSubscriptionBillingCycles([{
      code: 'STARTER',
      isActive: true,
      pricingStatus: 'APPROVED',
      limitsStatus: 'APPROVED',
      yearlyPrice: 12000
    }]),
    [
      { value: 'MONTHLY', label: 'Monthly' },
      { value: 'YEARLY', label: 'Annual' }
    ]
  );
  assert.deepEqual(getApprovedSubscriptionBillingCycles([{
    code: 'CUSTOM',
    isActive: true,
    pricingStatus: 'APPROVED',
    limitsStatus: 'APPROVED',
    yearlyPrice: 12000
  }]), [{ value: 'MONTHLY', label: 'Monthly' }]);
  assert.deepEqual(getApprovedSubscriptionBillingCycles(null), [
    { value: 'MONTHLY', label: 'Monthly' }
  ]);
  assert.deepEqual(getApprovedSubscriptionBillingCycles(undefined), [
    { value: 'MONTHLY', label: 'Monthly' }
  ]);
  assert.deepEqual(getApprovedSubscriptionBillingCycles([null, {}]), [
    { value: 'MONTHLY', label: 'Monthly' }
  ]);
});

test('monthly price labels safely support custom-priced plans', () => {
  assert.equal(getOfficialMonthlyPriceLabel(OFFICIAL_SAAS_PLANS[0]), '₹999');
  assert.equal(getOfficialMonthlyPriceLabel(OFFICIAL_SAAS_PLANS[3]), null);
  assert.equal(getOfficialMonthlyPriceLabel(null), null);
  assert.equal(getOfficialMonthlyPriceLabel({ monthlyPrice: undefined }), null);
});

test("checkout requires the matching backend plan with approved price and limits", () => {
  const starter = OFFICIAL_SAAS_PLANS[0];
  const approvedPlan = {
    code: 'STARTER',
    isActive: true,
    pricingStatus: 'APPROVED',
    limitsStatus: 'APPROVED',
    monthlyPrice: "999.00",
    yearlyPrice: null
  };

  assert.equal(canCheckoutOfficialPlan(starter, approvedPlan, 'MONTHLY'), true);
  assert.equal(canCheckoutOfficialPlan(starter, approvedPlan, 'YEARLY'), false);
  assert.equal(canCheckoutOfficialPlan(starter, null, 'MONTHLY'), false);
  assert.equal(canCheckoutOfficialPlan(null, approvedPlan, 'MONTHLY'), false);
  assert.equal(canCheckoutOfficialPlan(starter, {
    ...approvedPlan,
    monthlyPrice: '1000.00'
  }, 'MONTHLY'), false);
  assert.equal(canCheckoutOfficialPlan(starter, {
    ...approvedPlan,
    limitsStatus: 'PENDING_APPROVAL'
  }, 'MONTHLY'), false);
  assert.equal(
    canCheckoutOfficialPlan(OFFICIAL_SAAS_PLANS[3], approvedPlan, 'MONTHLY'),
    false
  );
});

test('built-in monthly plans do not require manual approval but must match official terms', () => {
  const builtInPlan = {
    code: 'STARTER',
    isBuiltIn: true,
    isActive: false,
    pricingStatus: 'PENDING_APPROVAL',
    limitsStatus: 'PENDING_APPROVAL',
    monthlyPrice: '999.00',
    currency: 'INR'
  };

  assert.equal(
    canCheckoutOfficialPlan(OFFICIAL_SAAS_PLANS[0], builtInPlan, 'MONTHLY'),
    true
  );
  assert.equal(
    canCheckoutOfficialPlan(OFFICIAL_SAAS_PLANS[0], builtInPlan, 'YEARLY'),
    false
  );
  assert.equal(
    canCheckoutOfficialPlan(OFFICIAL_SAAS_PLANS[0], {
      ...builtInPlan,
      monthlyPrice: '1000.00'
    }, 'MONTHLY'),
    false
  );
});
