import assert from "node:assert/strict";
import test from "node:test";
import {
  atAsiaKolkataRenewalTime,
  buildRecurringPaymentRequest,
  buildTokenizedCheckoutOptions,
  getRenewalFailureState,
  isRenewalDue,
  MAX_RENEWAL_ATTEMPTS,
  RENEWAL_RETRY_DELAY_DAYS
} from "./subscription-auto-renewal.service.js";

test("tokenized checkout and recurring payment requests bind the expected customer and token", () => {
  assert.deepEqual(buildTokenizedCheckoutOptions({
    amount: 12500,
    currency: "INR",
    customerId: "cust_123",
    receipt: "payment_123",
    notes: { organisationId: "org_123" }
  }), {
    amount: 12500,
    currency: "INR",
    customer_id: "cust_123",
    method: "card",
    token: {
      max_amount: 12500,
      expire_at: 4102444799,
      frequency: "as_presented"
    },
    receipt: "payment_123",
    notes: { organisationId: "org_123" }
  });

  assert.deepEqual(buildRecurringPaymentRequest({
    amount: 12500,
    currency: "INR",
    orderId: "order_123",
    customerId: "cust_123",
    tokenId: "token_123",
    email: "customer@example.com",
    contact: "9876543210",
    description: "Subscription renewal",
    notes: { paymentId: "payment_123" }
  }), {
    amount: 12500,
    currency: "INR",
    order_id: "order_123",
    customer_id: "cust_123",
    token: "token_123",
    recurring: true,
    email: "customer@example.com",
    contact: "9876543210",
    description: "Subscription renewal",
    notes: { paymentId: "payment_123" }
  });
});

test("daily scheduler time is 2 AM in Asia/Kolkata, including UTC date boundaries", () => {
  const renewalTime = atAsiaKolkataRenewalTime(new Date("2026-07-14T20:00:00.000Z"));
  assert.equal(renewalTime.toISOString(), "2026-07-14T20:30:00.000Z");
  assert.equal(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(renewalTime),
    "02:00"
  );
});

test("renewal failures retry after three days and disable auto-renew on the third attempt", () => {
  const now = new Date("2026-07-14T02:45:00.000Z");
  for (const attempts of [1, 2]) {
    const state = getRenewalFailureState(attempts, now);
    assert.equal(state.nextRenewalDate.toISOString(), "2026-07-16T20:30:00.000Z");
    assert.equal(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).format(state.nextRenewalDate),
      "02:00"
    );
    assert.equal(state.lastRenewalStatus, "FAILED");
    assert.equal(state.renewalAttempts, attempts);
    assert.equal(RENEWAL_RETRY_DELAY_DAYS, 3);
  }

  assert.deepEqual(getRenewalFailureState(MAX_RENEWAL_ATTEMPTS, now), {
    autoRenew: false,
    autoRenewRequested: false,
    lastRenewalStatus: "PAST_DUE",
    nextRenewalDate: null,
    renewalAttempts: 3,
    subscriptionStatus: "PAST_DUE"
  });
  assert.throws(() => getRenewalFailureState(0, now), TypeError);
});

test("a renewal is due only for an active, enabled subscription with saved Razorpay credentials", () => {
  const dueDate = new Date("2026-07-14T20:30:00.000Z");
  const subscription = {
    autoRenew: true,
    status: "ACTIVE",
    nextRenewalDate: dueDate,
    razorpayCustomerId: "cust_123",
    razorpayTokenId: "token_123"
  };
  assert.equal(isRenewalDue(subscription, dueDate), true);
  assert.equal(isRenewalDue({ ...subscription, status: "PAST_DUE" }, dueDate), false);
  assert.equal(isRenewalDue({ ...subscription, razorpayTokenId: null }, dueDate), false);
  assert.equal(isRenewalDue({ ...subscription, nextRenewalDate: new Date(dueDate.getTime() + 1) }, dueDate), false);
});
