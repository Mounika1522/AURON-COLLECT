import test from "node:test";
import assert from "node:assert/strict";

import {
  isValidIanaTimeZone,
  localDateTimeToUtc,
  parseReminderScheduleTime,
  validateReminderScheduleTime
} from "./reminder-time.service.js";
import { syncInvoiceReminders } from "./reminder.service.js";

test("parses datetime-local values as Asia/Kolkata and stores the UTC instant", () => {
  const scheduledFor = parseReminderScheduleTime("2026-11-21T17:10");

  assert.equal(scheduledFor.toISOString(), "2026-11-21T11:40:00.000Z");
});

test("preserves explicit UTC offsets for existing ISO timestamp callers", () => {
  const scheduledFor = parseReminderScheduleTime(
    "2026-11-21T17:10:00+05:30"
  );

  assert.equal(scheduledFor.toISOString(), "2026-11-21T11:40:00.000Z");
});

test("rejects malformed and impossible calendar dates", () => {
  assert.equal(parseReminderScheduleTime("not-a-date"), null);
  assert.equal(parseReminderScheduleTime("2026-02-30T10:00"), null);
  assert.equal(parseReminderScheduleTime("2026-11-21"), null);
});

test("rejects past and current scheduling instants", () => {
  const now = new Date("2026-11-21T11:40:00.000Z");

  assert.deepEqual(
    validateReminderScheduleTime("2026-11-21T17:09", now),
    { error: "PAST_DATE" }
  );
  assert.deepEqual(
    validateReminderScheduleTime("2026-11-21T17:10", now),
    { error: "PAST_DATE" }
  );
});

test("accepts future IST local times", () => {
  const result = validateReminderScheduleTime(
    "2026-11-21T17:11",
    new Date("2026-11-21T11:40:00.000Z")
  );

  assert.equal(result.scheduledFor.toISOString(), "2026-11-21T11:41:00.000Z");
});

test("parses local schedule times using the selected IANA time zone and DST rules", () => {
  assert.equal(
    parseReminderScheduleTime("2026-03-08T09:00", "America/New_York").toISOString(),
    "2026-03-08T13:00:00.000Z"
  );
  assert.equal(
    parseReminderScheduleTime("2026-01-10T09:00", "America/New_York").toISOString(),
    "2026-01-10T14:00:00.000Z"
  );
  assert.equal(isValidIanaTimeZone("America/New_York"), true);
  assert.equal(isValidIanaTimeZone("not/a-time-zone"), false);
  assert.equal(localDateTimeToUtc({
    year: 2026,
    month: 3,
    day: 8,
    hour: 9,
    minute: 0
  }, "not/a-time-zone"), null);
});

test("automatic reminder schedules use the customer portal time zone", async () => {
  const invoice = {
    id: "invoice-1",
    invoiceNumber: "INV-001",
    customerId: "customer-1",
    organisationId: "org-1",
    dueDate: new Date("2030-01-20T00:00:00.000Z"),
    status: "ISSUED",
    total: 125,
    currency: "INR"
  };
  const created = [];
  const db = {
    reminder: {
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null,
      createMany: async ({ data }) => created.push(...data)
    },
    customer: {
      findFirst: async () => ({ id: invoice.customerId, name: "Test Customer" })
    },
    customerPortalAccount: {
      findUnique: async () => ({ timeZone: "America/New_York" })
    },
    invoice: {
      findFirst: async () => invoice
    },
    receiptAllocation: {
      aggregate: async () => ({ _sum: { amount: 0 } })
    },
    creditAdjustment: {
      aggregate: async () => ({ _sum: { amount: 0 } })
    },
    reminderTemplate: {
      findFirst: async () => null
    }
  };

  await syncInvoiceReminders(db, invoice);

  assert.deepEqual(
    created.map(({ scheduledFor }) => scheduledFor.toISOString()),
    [
      "2030-01-17T14:00:00.000Z",
      "2030-01-20T14:00:00.000Z",
      "2030-01-21T14:00:00.000Z"
    ]
  );
});
