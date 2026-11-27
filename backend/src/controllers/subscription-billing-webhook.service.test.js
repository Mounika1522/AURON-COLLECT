import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createRazorpayWebhookHandler } from "./subscription-billing.controller.js";

test("duplicate Razorpay webhook IDs do not process or send a second receipt", async () => {
  const env = {
    RAZORPAY_MODE: "test",
    RAZORPAY_KEY_ID: "rzp_test_fixture",
    RAZORPAY_KEY_SECRET: "test-only-signing-secret",
    RAZORPAY_WEBHOOK_SECRET: "test-only-webhook-secret"
  };
  const events = new Map();
  const payment = {
    id: "billing-payment-1",
    organisationId: "org-1",
    planId: "plan-1",
    status: "CREATED",
    billingCycle: "MONTHLY",
    amount: "999.00",
    currency: "INR",
    razorpayOrderId: "order_test_1",
    razorpayPaymentId: null,
    effectiveAt: new Date("2026-11-27T06:00:00.000Z"),
    periodEndsAt: new Date("2026-12-27T06:00:00.000Z"),
    createdBy: null
  };
  const receiptsAttempted = new Set();
  let receiptAttempts = 0;
  let receiptDeliveries = 0;
  const db = {
    $transaction: async (callback) => callback({
      $queryRaw: async () => [],
      billingPayment: {
        findFirst: async () => payment,
        findUnique: async () => payment,
        update: async ({ data }) => {
          Object.assign(payment, data);
          return {
            ...payment,
            plan: { code: "STARTER", name: "Starter" },
            subscription: { id: "subscription-1" }
          };
        },
      },
      subscription: {
        create: async () => ({ id: "subscription-1" })
      },
      billingInvoice: {
        create: async ({ data }) => ({ id: "invoice-1", ...data })
      },
      auditLog: {
        create: async () => ({ id: "audit-1" })
      },
      razorpayWebhookEvent: {
        create: async ({ data }) => {
          if (events.has(data.providerEventId)) {
            const error = new Error("Duplicate provider event");
            error.code = "P2002";
            throw error;
          }
          const event = { id: "event-1", ...data };
          events.set(data.providerEventId, event);
          return event;
        },
        update: async ({ where, data }) => {
          const event = [...events.values()].find(({ id }) => id === where.id);
          Object.assign(event, data);
          return event;
        }
      }
    }),
    razorpayWebhookEvent: {
      findUnique: async ({ where }) => events.get(where.providerEventId) || null
    }
  };
  const handler = createRazorpayWebhookHandler({
    db,
    env,
    sendReceipt: async (paymentId) => {
      receiptAttempts += 1;
      if (!receiptsAttempted.has(paymentId)) {
        receiptsAttempted.add(paymentId);
        receiptDeliveries += 1;
      }
    }
  });
  const eventId = "evt-test-duplicate-1";
  const body = Buffer.from(JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_test_1",
          order_id: "order_test_1",
          status: "captured",
          currency: "INR",
          amount: 99900,
          created_at: 1795768800
        }
      }
    }
  }));
  const signature = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest("hex");
  const invoke = async () => {
    const response = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(value) {
        this.body = value;
        return this;
      }
    };
    await handler({
      body,
      get: (name) => ({
        "X-Razorpay-Signature": signature,
        "X-Razorpay-Event-Id": eventId
      }[name])
    }, response);
    return response;
  };

  const first = await invoke();
  const duplicate = await invoke();
  assert.deepEqual(first.body, {
    success: true,
    duplicate: false,
    status: "PAID"
  });
  assert.deepEqual(duplicate.body, { success: true, duplicate: true });
  assert.equal(events.size, 1);
  assert.equal(payment.status, "PAID");
  assert.equal(receiptAttempts, 2);
  assert.equal(receiptDeliveries, 1);
});
