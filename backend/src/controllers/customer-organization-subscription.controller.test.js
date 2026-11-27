import assert from "node:assert/strict";
import test from "node:test";
import {
  createCustomerOrganizationSubscriptionOrder
} from "./customer-organization-subscription.controller.js";

test("pending order conflicts identify the blocking and requested plans", async () => {
  const response = {
    statusCode: null,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  const pendingOrderError = Object.assign(
    new Error(
      "A Starter monthly checkout is still pending. Resolve it before starting a Business monthly checkout."
    ),
    {
      code: "BILLING_ORDER_PENDING",
      details: {
        pendingPlanCode: "STARTER",
        requestedPlanCode: "BUSINESS"
      }
    }
  );

  await createCustomerOrganizationSubscriptionOrder({
    customer: { organisationId: "org-1", customerId: "customer-1" },
    body: { planCode: "BUSINESS", billingCycle: "MONTHLY" },
    get: () => "business-upgrade-idempotency-key"
  }, response, async () => {
    throw pendingOrderError;
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, {
    success: false,
    code: "BILLING_ORDER_PENDING",
    message: pendingOrderError.message,
    details: {
      pendingPlanCode: "STARTER",
      requestedPlanCode: "BUSINESS"
    }
  });
});
