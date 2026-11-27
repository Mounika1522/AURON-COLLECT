export const OFFICIAL_SUBSCRIPTION_PLANS = Object.freeze({
  STARTER: Object.freeze({
    code: "STARTER",
    name: "Starter",
    description:
      "Customer management, basic invoice tracking, manual receipts, basic ageing and dashboard.",
    monthlyPrice: "999.00",
    currency: "INR",
  }),
  GROWTH: Object.freeze({
    code: "GROWTH",
    name: "Growth",
    description:
      "Excel imports, partial allocation, task assignment, promises, reminder templates, statements and advanced ageing.",
    monthlyPrice: "2499.00",
    currency: "INR",
  }),
  BUSINESS: Object.freeze({
    code: "BUSINESS",
    name: "Business",
    description:
      "Advanced workflows, prioritisation, disputes, team performance, dashboards and advanced reporting.",
    monthlyPrice: "5999.00",
    currency: "INR",
  }),
  ENTERPRISE: Object.freeze({
    code: "ENTERPRISE",
    name: "Enterprise",
    description:
      "Custom limits, multi-entity support, advanced access, API, custom reports and integrations.",
    monthlyPrice: null,
    currency: "INR",
  }),
});

export const getOfficialSubscriptionPlan = (code) =>
  typeof code === "string"
    ? OFFICIAL_SUBSCRIPTION_PLANS[code.trim().toUpperCase()] || null
    : null;

export const getOfficialSubscriptionPlanCodes = () =>
  Object.keys(OFFICIAL_SUBSCRIPTION_PLANS);

export const projectSubscriptionPlanForCatalog = (plan) => {
  const officialPlan = getOfficialSubscriptionPlan(plan?.code);
  if (!officialPlan) return plan;
  return {
    ...plan,
    name: officialPlan.name,
    description: officialPlan.description,
    monthlyPrice: officialPlan.monthlyPrice,
    yearlyPrice: null,
    currency: officialPlan.currency,
    isBuiltIn: true,
  };
};
