import assert from "node:assert/strict";
import test from "node:test";
import {
  processReminder,
  reconcileStaleProcessingReminders,
  runReminderSchedulerTick
} from "./reminder.scheduler.js";
import { parseReminderScheduleTime } from "./reminder-time.service.js";

const now = new Date("2026-11-30T01:00:00.000Z");
const reminder = {
  id: "reminder-1",
  organisationId: "org-1",
  customerId: "customer-1",
  invoiceId: "invoice-1",
  attemptCount: 0,
  scheduledFor: new Date("2026-11-30T00:00:00.000Z")
};
const balance = {
  outstanding: 125,
  invoice: {
    id: "invoice-1",
    invoiceNumber: "INV-001",
    status: "ISSUED",
    dueDate: new Date("2026-11-30T00:00:00.000Z"),
    currency: "INR"
  }
};

const makeDatabase = () => {
  const updates = [];
  return {
    updates,
    reminder: {
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => updates.push(data)
    }
  };
};

test("successful reminder delivery records accepted time and sent status", async () => {
  const db = makeDatabase();
  const result = await processReminder(reminder, {
    db,
    getOutstanding: async () => balance,
    notify: async (value) => {
      assert.equal(value.outstanding, 125);
      assert.equal(value.invoice.invoiceNumber, "INV-001");
      return {
        emailStatus: "SMTP_ACCEPTED",
        acceptedAt: new Date("2026-11-30T01:00:05.000Z")
      };
    },
    now: () => now
  });

  assert.equal(result.status, "SENT");
  assert.equal(db.updates.at(-1).status, "SENT");
  assert.equal(db.updates.at(-1).deliveryStatus, "SMTP_ACCEPTED");
  assert.equal(db.updates.at(-1).sentAt.toISOString(), "2026-11-30T01:00:05.000Z");
});

test("explicit temporary rejection schedules a bounded retry", async () => {
  const db = makeDatabase();
  const result = await processReminder(reminder, {
    db,
    getOutstanding: async () => balance,
    notify: async () => ({
      emailStatus: "RETRY_SCHEDULED",
      retryable: true,
      errorCode: "SMTP_451"
    }),
    now: () => now
  });

  assert.equal(result.status, "PENDING");
  assert.equal(result.nextAttemptAt.toISOString(), "2026-11-30T01:01:00.000Z");
  assert.equal(db.updates.at(-1).deliveryStatus, "RETRY_SCHEDULED");
});

test("unknown delivery outcomes fail closed without an automatic retry", async () => {
  const db = makeDatabase();
  const result = await processReminder(reminder, {
    db,
    getOutstanding: async () => balance,
    notify: async () => ({
      emailStatus: "DELIVERY_UNKNOWN",
      errorCode: "DELIVERY_OUTCOME_UNKNOWN"
    }),
    now: () => now
  });

  assert.equal(result.status, "FAILED");
  assert.equal(db.updates.at(-1).status, "FAILED");
  assert.equal(db.updates.at(-1).deliveryStatus, "DELIVERY_UNKNOWN");
  assert.equal(db.updates.at(-1).nextAttemptAt, null);
});

test("disabled email delivery is recorded as FAILED/DISABLED, not as scheduler cancellation", async () => {
  const db = makeDatabase();
  const result = await processReminder(reminder, {
    db,
    getOutstanding: async () => balance,
    notify: async () => ({
      emailStatus: "DISABLED",
      errorCode: "DELIVERY_DISABLED",
      errorMessage: "Email delivery is disabled for this runtime."
    })
  });

  assert.equal(result.status, "FAILED");
  assert.equal(result.errorCode, "DELIVERY_DISABLED");
  assert.equal(db.updates.at(-1).status, "FAILED");
  assert.equal(db.updates.at(-1).deliveryStatus, "DISABLED");
  assert.equal(db.updates.at(-1).lastError, "DELIVERY_DISABLED");
});

test("manual and scheduled processing cannot both send after another worker claims a reminder", async () => {
  const db = makeDatabase();
  db.reminder.updateMany = async () => ({ count: 0 });
  let deliveryCalls = 0;

  const result = await processReminder(reminder, {
    db,
    notify: async () => {
      deliveryCalls += 1;
      return { emailStatus: "SMTP_ACCEPTED" };
    }
  });

  assert.deepEqual(result, { status: "NOT_CLAIMED" });
  assert.equal(deliveryCalls, 0);
  assert.equal(db.updates.length, 0);
});

test("development scheduler sends at the customer's local scheduled instant and excludes startup backlog", async () => {
  const scheduledFor = parseReminderScheduleTime(
    "2026-11-27T11:03",
    "Asia/Kolkata"
  );
  const schedulerStartedAt = new Date("2026-11-27T05:31:00.000Z");
  const overdue = {
    ...reminder,
    id: "overdue-reminder",
    scheduledFor: new Date("2026-11-27T05:30:00.000Z")
  };
  const due = { ...reminder, scheduledFor };
  const processed = [];
  const updates = [];
  const db = {
    reminder: {
      findMany: async ({ where }) => {
        if (where.status === "PROCESSING") return [];
        return [overdue, due].filter((item) =>
          item.scheduledFor > where.scheduledFor.gt &&
          item.scheduledFor <= where.scheduledFor.lte
        );
      },
      updateMany: async ({ where }) => {
        processed.push(where.id);
        return { count: 1 };
      },
      update: async ({ data }) => updates.push(data)
    }
  };
  const options = {
    db,
    schedulerStartedAt,
    developmentScheduler: true,
    getOutstanding: async () => balance,
    notify: async (_value, notifyOptions) => {
      assert.equal(notifyOptions.schedulerSend, true);
      return { emailStatus: "SMTP_ACCEPTED" };
    }
  };

  assert.equal(scheduledFor.toISOString(), "2026-11-27T05:33:00.000Z");
  assert.equal(await runReminderSchedulerTick({
    ...options,
    now: new Date("2026-11-27T05:32:59.999Z")
  }), 0);
  assert.equal(processed.length, 0);

  assert.equal(await runReminderSchedulerTick({
    ...options,
    now: new Date("2026-11-27T05:33:00.000Z")
  }), 1);
  assert.deepEqual(processed, ["reminder-1"]);
  assert.equal(updates.at(-1).status, "SENT");
  assert.equal(updates.at(-1).deliveryStatus, "SMTP_ACCEPTED");
});

test("stale pre-start reminder claims are restored without moving them into the automatic send window", async () => {
  const updates = [];
  const scheduledFor = new Date("2026-11-27T05:30:00.000Z");
  const protectScheduledBefore = new Date("2026-11-27T05:31:00.000Z");
  const db = {
    reminder: {
      findMany: async () => [{
        id: "pre-start-processing",
        scheduledFor,
        emailDeliveryAttempt: {
          status: "PENDING",
          attemptCount: 0
        }
      }],
      update: async ({ data }) => updates.push(data)
    }
  };

  assert.equal(await reconcileStaleProcessingReminders(
    db,
    new Date("2026-11-27T05:50:00.000Z"),
    { protectScheduledBefore }
  ), 1);
  assert.deepEqual(updates[0], {
    status: "PENDING",
    deliveryStatus: "PENDING",
    lastError: null
  });
  assert.equal(updates[0].scheduledFor, undefined);
});

test("stale SMTP submissions are marked unknown rather than resent", async () => {
  const updates = [];
  const db = {
    reminder: {
      findMany: async () => [{
        id: "stale-reminder",
        emailDeliveryAttempt: {
          id: "attempt-1",
          status: "SENDING",
          attemptCount: 1,
          acceptedAt: null
        }
      }],
      update: async ({ data }) => updates.push(["reminder", data])
    },
    emailDeliveryAttempt: {
      update: async ({ data }) => updates.push(["attempt", data])
    }
  };

  assert.equal(await reconcileStaleProcessingReminders(db, now), 1);
  assert.equal(updates[0][0], "attempt");
  assert.equal(updates[0][1].status, "DELIVERY_UNKNOWN");
  assert.equal(updates[1][1].status, "FAILED");
  assert.equal(updates[1][1].deliveryStatus, "DELIVERY_UNKNOWN");
});
