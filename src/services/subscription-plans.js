export const OFFICIAL_SAAS_PLANS = Object.freeze([
  {
    code: 'STARTER',
    name: 'STARTER',
    monthlyPrice: 999,
    description:
      'Customer management, basic invoice tracking, manual receipts, basic ageing and dashboard.',
    features: [
      'Customer management',
      'Basic invoice tracking',
      'Manual receipts',
      'Basic ageing',
      'Dashboard'
    ]
  },
  {
    code: 'GROWTH',
    name: 'GROWTH',
    monthlyPrice: 2499,
    description:
      'Excel imports, partial allocation, task assignment, promises, reminder templates, statements and advanced ageing.',
    features: [
      'Excel imports',
      'Partial allocation',
      'Task assignment',
      'Payment promises',
      'Reminder templates',
      'Statements',
      'Advanced ageing'
    ]
  },
  {
    code: 'BUSINESS',
    name: 'BUSINESS',
    monthlyPrice: 5999,
    description:
      'Advanced workflows, prioritisation, disputes, team performance, dashboards and advanced reporting.',
    features: [
      'Advanced workflows',
      'Prioritisation',
      'Disputes',
      'Team performance',
      'Dashboards',
      'Advanced reporting'
    ]
  },
  {
    code: 'ENTERPRISE',
    name: 'ENTERPRISE',
    monthlyPrice: null,
    description:
      'Custom limits, multi-entity support, advanced access, API, custom reports and integrations.',
    features: [
      'Custom limits',
      'Multi-entity support',
      'Advanced access',
      'API',
      'Custom reports',
      'Integrations'
    ]
  }
]);

export const canAccessOrganizationBillingPortal = (role) =>
  role === 'ADMIN' || role === 'OWNER';

export const canViewOrganizationBillingPlans = ({
  role,
  customerPortalAccess = false,
  readOnly = false,
}) =>
  customerPortalAccess ||
  readOnly ||
  canAccessOrganizationBillingPortal(role);

const OFFICIAL_PLAN_RANK = Object.freeze({
  STARTER: 0,
  GROWTH: 1,
  BUSINESS: 2,
  ENTERPRISE: 3
});

export const getOfficialPlanChangeAction = (targetPlanCode, currentPlanCode) => {
  if (!currentPlanCode) return 'Subscribe';
  if (targetPlanCode === currentPlanCode) return 'Current Plan';
  return OFFICIAL_PLAN_RANK[targetPlanCode] > OFFICIAL_PLAN_RANK[currentPlanCode]
    ? 'Upgrade'
    : 'Downgrade';
};

const isApprovedActivePlan = (plan) =>
  Boolean(
    plan?.isActive &&
    plan.pricingStatus === 'APPROVED' &&
    plan.limitsStatus === 'APPROVED'
  );

export const getApprovedSubscriptionBillingCycles = (plans) => [
  { value: 'MONTHLY', label: 'Monthly' },
  ...((Array.isArray(plans) ? plans : []).some(
    (plan) =>
      OFFICIAL_SAAS_PLANS.some((officialPlan) => officialPlan.code === plan?.code) &&
      isApprovedActivePlan(plan) &&
      Number(plan.yearlyPrice) > 0
  )
    ? [{ value: 'YEARLY', label: 'Annual' }]
    : [])
];

export const canCheckoutOfficialPlan = (
  officialPlan,
  backendPlan,
  billingCycle
) => {
  if (
    !officialPlan ||
    officialPlan?.code === 'ENTERPRISE' ||
    !backendPlan ||
    backendPlan.code !== officialPlan?.code
  ) {
    return false;
  }

  if (backendPlan.isBuiltIn === true) {
    return (
      billingCycle === 'MONTHLY' &&
      backendPlan.currency === 'INR' &&
      Number(backendPlan.monthlyPrice) === officialPlan.monthlyPrice
    );
  }

  if (!isApprovedActivePlan(backendPlan)) return false;

  const price =
    billingCycle === 'YEARLY'
      ? Number(backendPlan.yearlyPrice)
      : billingCycle === 'MONTHLY'
        ? Number(backendPlan.monthlyPrice)
        : NaN;
  if (!Number.isFinite(price) || price <= 0) return false;

  return billingCycle !== 'MONTHLY' || price === officialPlan.monthlyPrice;
};

export const getOfficialMonthlyPriceLabel = (plan) => {
  const price = plan?.monthlyPrice;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  return `₹${price.toLocaleString('en-IN')}`;
};
