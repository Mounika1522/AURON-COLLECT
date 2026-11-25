import { getCurrentSubscriptionForOrganisation } from "./subscription-billing.service.js";

const limitConfig = {
  users: {
    field: "maxUsers",
    model: "user"
  },
  customers: {
    field: "maxCustomers",
    model: "customer"
  },
  invoices: {
    field: "maxInvoicesPerMonth",
    model: "invoice"
  }
};

export class SubscriptionLimitError extends Error {
  constructor(resource, limit) {
    super(`The approved subscription limit for ${resource} has been reached.`);
    this.name = "SubscriptionLimitError";
    this.code = "SUBSCRIPTION_LIMIT_REACHED";
    this.resource = resource;
    this.limit = limit;
  }
}

export const assertSubscriptionCapacity = async (
  tx,
  organisationId,
  resource,
  additionalCount = 1,
  now = new Date()
) => {
  const config = limitConfig[resource];
  if (!config || !Number.isInteger(additionalCount) || additionalCount < 0) {
    throw new Error("Invalid subscription capacity check");
  }
  if (additionalCount === 0) return;

  const subscription = await getCurrentSubscriptionForOrganisation(
    tx,
    organisationId,
    now
  );

  if (
    !subscription ||
    subscription.plan.limitsStatus !== "APPROVED"
  ) {
    return;
  }

  const limit = subscription.plan[config.field];
  if (limit === null) return;

  const where = { organisationId };
  if (resource === "invoices") {
    where.createdAt = {
      gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    };
  }

  const used = await tx[config.model].count({ where });
  if (used + additionalCount > limit) {
    throw new SubscriptionLimitError(resource, limit);
  }
};
