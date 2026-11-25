export const CUSTOMER_PLAN_PRICE_FIELDS = Object.freeze([
  "proposedMonthlyPrice",
  "proposedQuarterlyPrice",
  "proposedHalfYearlyPrice",
  "proposedYearlyPrice"
]);

export class CustomerPlanValidationError extends Error {}

const invalid = (message) => {
  throw new CustomerPlanValidationError(message);
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const normalizePrice = (value, field) => {
  if (value === null || value === "") return null;
  const raw = typeof value === "number" ? String(value) : value;
  if (
    typeof raw !== "string" ||
    !/^\d+(?:\.\d{1,2})?$/.test(raw) ||
    !Number.isFinite(Number(raw)) ||
    Number(raw) <= 0 ||
    Number(raw) > 999999999999.99
  ) {
    invalid(`${field} must be a positive amount with up to two decimals.`);
  }
  return Number(raw).toFixed(2);
};

const normalizeFeatures = (value) => {
  if (!Array.isArray(value) || value.length > 30) {
    invalid("Features must be a list of up to 30 items.");
  }
  const features = value.map((feature) => {
    if (typeof feature !== "string" || !feature.trim() || feature.trim().length > 160) {
      invalid("Each feature must contain 1 to 160 characters.");
    }
    return feature.trim();
  });
  return [...new Set(features)];
};

const normalizeUsageLimits = (value) => {
  if (!isPlainObject(value) || Object.keys(value).length > 50) {
    invalid("Usage limits must be an object with at most 50 entries.");
  }
  const limits = {};
  for (const [key, limit] of Object.entries(value)) {
    const normalizedKey = key.trim();
    if (
      !/^[A-Za-z][A-Za-z0-9 _-]{0,49}$/.test(normalizedKey) ||
      Object.hasOwn(limits, normalizedKey) ||
      !(limit === null || (Number.isSafeInteger(limit) && limit >= 0))
    ) {
      invalid("Usage limit names must be valid and values must be non-negative integers or null.");
    }
    limits[normalizedKey] = limit;
  }
  return limits;
};

const normalizeEligibleTypes = (value, allowedTypes) => {
  if (!Array.isArray(value) || value.length > 50) {
    invalid("Eligible customer types must be a list of up to 50 items.");
  }
  const types = [...new Set(value)];
  if (
    types.some((type) =>
      typeof type !== "string" || !type.trim() || !allowedTypes.has(type)
    )
  ) {
    invalid("Eligibility can only include customer types belonging to this organization.");
  }
  return types;
};

const normalizeOptionalText = (value, field, maxLength) => {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    invalid(`${field} must be no more than ${maxLength} characters.`);
  }
  return value.trim() || null;
};

export const normalizeCustomerPlanInput = (
  body,
  { current = null, customerTypes = [] } = {}
) => {
  if (!isPlainObject(body)) {
    invalid("A customer plan object is required.");
  }
  const data = {};
  const allowedTypes = new Set([
    ...customerTypes,
    ...(current?.eligibleCustomerTypes || [])
  ]);
  let pricingChanged = false;
  let taxChanged = false;

  if (Object.hasOwn(body, "code")) {
    if (
      typeof body.code !== "string" ||
      body.code.length > 60 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.code)
    ) {
      invalid("Plan code must use lowercase letters, numbers, and hyphens.");
    }
    if (current && body.code !== current.code) {
      invalid("Plan code cannot be changed after creation.");
    }
    data.code = body.code;
  }
  if (Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 100) {
      invalid("Plan name must contain 2 to 100 characters.");
    }
    data.name = body.name.trim();
  }
  if (Object.hasOwn(body, "description")) {
    data.description = normalizeOptionalText(body.description, "Description", 1000);
  }
  if (Object.hasOwn(body, "currency")) {
    if (typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency)) {
      invalid("Currency must be a three-letter uppercase code.");
    }
    data.currency = body.currency;
    pricingChanged ||= body.currency !== current?.currency;
  }
  for (const field of CUSTOMER_PLAN_PRICE_FIELDS) {
    if (!Object.hasOwn(body, field)) continue;
    data[field] = normalizePrice(body[field], field);
    pricingChanged ||= data[field] !== (current?.[field] == null
      ? null
      : Number(current[field]).toFixed(2));
  }
  if (Object.hasOwn(body, "proposedTaxTerms")) {
    data.proposedTaxTerms = normalizeOptionalText(body.proposedTaxTerms, "Tax terms", 2000);
    taxChanged ||= data.proposedTaxTerms !== (current?.proposedTaxTerms?.trim() || null);
  }
  if (Object.hasOwn(body, "features")) {
    data.features = normalizeFeatures(body.features);
  }
  if (Object.hasOwn(body, "usageLimits")) {
    data.usageLimits = normalizeUsageLimits(body.usageLimits);
  }
  if (Object.hasOwn(body, "eligibleCustomerTypes")) {
    data.eligibleCustomerTypes = normalizeEligibleTypes(
      body.eligibleCustomerTypes,
      allowedTypes
    );
  }
  if (Object.hasOwn(body, "isActive")) {
    if (typeof body.isActive !== "boolean") {
      invalid("Plan activation must be true or false.");
    }
    data.isActive = body.isActive;
  }
  if (!current && (!data.code || !data.name)) {
    invalid("Plan code and name are required.");
  }

  return { data, pricingChanged: !current || pricingChanged, taxChanged: !current || taxChanged };
};

export const hasApprovedCustomerPlanPrice = (plan) =>
  ["monthlyPrice", "quarterlyPrice", "halfYearlyPrice", "yearlyPrice"]
    .some((field) => Number(plan[field]) > 0);

export const canActivateCustomerPlan = (plan) =>
  plan.pricingStatus === "APPROVED" &&
  plan.pricingProposalStatus === "APPROVED" &&
  plan.taxTermsStatus === "APPROVED" &&
  plan.taxProposalStatus === "APPROVED" &&
  Boolean(plan.taxTerms?.trim()) &&
  hasApprovedCustomerPlanPrice(plan);
