import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSubscriptionCapacity,
  SubscriptionLimitError
} from "./subscription-limits.service.js";

const makeDatabase = (limitsStatus, limit, used) => ({
  subscription: {
    updateMany: async () => ({ count: 0 }),
    findFirst: async () => ({
      plan: {
        limitsStatus,
        limitsProposalStatus: "PENDING_APPROVAL",
        maxCustomers: limit
      }
    })
  },
  customer: {
    count: async () => used
  }
});

test("unapproved plan limits do not enforce unapproved caps", async () => {
  let counted = false;
  const db = makeDatabase("PENDING_APPROVAL", 1, 1);
  db.customer.count = async () => {
    counted = true;
    return 1;
  };

  await assert.doesNotReject(() =>
    assertSubscriptionCapacity(db, "org-1", "customers")
  );
  assert.equal(counted, false);
});

test("approved customer caps reject over-limit creates and allow remaining capacity", async () => {
  await assert.rejects(
    () => assertSubscriptionCapacity(
      makeDatabase("APPROVED", 2, 2),
      "org-1",
      "customers"
    ),
    (error) =>
      error instanceof SubscriptionLimitError &&
      error.code === "SUBSCRIPTION_LIMIT_REACHED" &&
      error.limit === 2
  );

  await assert.doesNotReject(() =>
    assertSubscriptionCapacity(makeDatabase("APPROVED", 3, 2), "org-1", "customers")
  );
});
