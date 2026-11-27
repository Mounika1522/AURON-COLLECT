import assert from "node:assert/strict";
import test from "node:test";
import {
  previewReminderEmail,
  sendReminderNow
} from "./reminder.controller.js";
import { processReminder } from "../services/reminder.scheduler.js";

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

const makeRequest = (role = "ADMIN") => ({
  user: { role, organisationId: "org-1" },
  params: { id: "reminder-1" }
});

const makeReminder = (status = "PENDING") => ({
  id: "reminder-1",
  organisationId: "org-1",
  channel: "EMAIL",
  status,
  deliveryStatus: status,
  invoiceId: "invoice-1"
});

test("manual email preview is restricted to pending reminders and ADMIN/OWNER", async () => {
  let lookupCount = 0;
  const db = {
    reminder: {
      findFirst: async ({ where }) => {
        lookupCount += 1;
        assert.deepEqual(where, {
          id: "reminder-1",
          organisationId: "org-1",
          channel: "EMAIL"
        });
        return makeReminder();
      }
    }
  };
  const buildPreview = async () => ({
    status: "READY",
    recipient: "verified@example.test",
    subject: "Reminder subject",
    message: "Reminder body"
  });

  for (const role of ["ADMIN", "OWNER"]) {
    const response = makeResponse();
    await previewReminderEmail(makeRequest(role), response, { db, buildPreview });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.preview, {
      recipient: "verified@example.test",
      subject: "Reminder subject",
      message: "Reminder body"
    });
  }

  const unauthorized = makeResponse();
  await previewReminderEmail(makeRequest("USER"), unauthorized, { db, buildPreview });
  assert.equal(unauthorized.statusCode, 403);
  assert.equal(lookupCount, 2);

  const processingDb = {
    reminder: { findFirst: async () => makeReminder("PROCESSING") }
  };
  const processing = makeResponse();
  await previewReminderEmail(makeRequest(), processing, {
    db: processingDb,
    buildPreview
  });
  assert.equal(processing.statusCode, 409);
});

test("manual send uses the shared processor and returns the refreshed reminder", async () => {
  let lookupCount = 0;
  let processCalls = 0;
  const sentReminder = { ...makeReminder("SENT"), sentAt: new Date() };
  const db = {
    reminder: {
      findFirst: async () => {
        lookupCount += 1;
        return lookupCount === 1 ? makeReminder() : sentReminder;
      }
    }
  };
  const process = async (reminder, options) => {
    processCalls += 1;
    assert.equal(reminder.id, "reminder-1");
    assert.equal(options.db, db);
    assert.equal(options.manualSend, true);
    return { status: "SENT" };
  };

  const response = makeResponse();
  await sendReminderNow(makeRequest("OWNER"), response, { db, process });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.reminder.status, "SENT");
  assert.equal(processCalls, 1);
});

test("manual send reports the actual delivery error and preserves retry state", async () => {
  let lookupCount = 0;
  const pendingReminder = makeReminder();
  const db = {
    reminder: {
      findFirst: async () => {
        lookupCount += 1;
        return pendingReminder;
      }
    }
  };
  const response = makeResponse();

  await sendReminderNow(makeRequest(), response, {
    db,
    process: async () => ({
      status: "PENDING",
      deliveryStatus: "RETRY_SCHEDULED",
      errorCode: "SMTP_451",
      errorMessage: "Temporary SMTP relay rejection",
      nextAttemptAt: new Date()
    })
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.message, "Temporary SMTP relay rejection");
  assert.equal(response.body.retryable, true);
  assert.equal(response.body.reminder.status, "PENDING");
});

test("manual send rejects ineligible and already-claimed reminders without processing", async () => {
  let processCalls = 0;
  const ineligibleReminders = [
    makeReminder("CANCELLED"),
    makeReminder("SENT"),
    makeReminder("PROCESSING"),
    {
      ...makeReminder(),
      emailDeliveryAttempt: {
        status: "SMTP_ACCEPTED",
        errorCode: null,
        acceptedAt: new Date(),
        providerMessageId: "accepted-message"
      }
    }
  ];
  for (const ineligibleReminder of ineligibleReminders) {
    const response = makeResponse();
    await sendReminderNow(makeRequest(), response, {
      db: {
        reminder: {
          findFirst: async () => ineligibleReminder
        }
      },
      process: async () => {
        processCalls += 1;
        return { status: "SENT" };
      }
    });
    assert.equal(response.statusCode, 409);
  }
  assert.equal(processCalls, 0);

  const notClaimed = makeResponse();
  await sendReminderNow(makeRequest(), notClaimed, {
    db: { reminder: { findFirst: async () => makeReminder() } },
    process: async () => ({ status: "NOT_CLAIMED" })
  });
  assert.equal(notClaimed.statusCode, 409);
});

test("manual send remains available for pending reminders while background scheduling is disabled", async () => {
  const previousDisabledSetting = process.env.DISABLE_BACKGROUND_SCHEDULERS;
  process.env.DISABLE_BACKGROUND_SCHEDULERS = "true";
  const reminder = makeReminder();
  reminder.attemptCount = 0;
  const db = {
    reminder: {
      findFirst: async () => ({ ...reminder }),
      updateMany: async ({ where, data }) => {
        const statusMatches = where.status
          ? reminder.status === where.status
          : where.OR?.some((condition) =>
              Object.entries(condition).every(([key, value]) => reminder[key] === value)
            );
        if (reminder.id !== where.id || !statusMatches) {
          return { count: 0 };
        }
        reminder.status = data.status;
        reminder.deliveryStatus = data.deliveryStatus;
        reminder.attemptCount += data.attemptCount.increment;
        return { count: 1 };
      },
      update: async ({ data }) => Object.assign(reminder, data)
    }
  };
  const processWithFakeDelivery = (value, { db: processorDb, manualSend }) => processReminder(value, {
    db: processorDb,
    manualSend,
    getOutstanding: async () => ({
      outstanding: 100,
      invoice: {
        id: "invoice-1",
        invoiceNumber: "INV-001",
        status: "ISSUED",
        dueDate: new Date("2026-11-30T00:00:00.000Z"),
        currency: "INR"
      }
    }),
    notify: async (_value, options) => {
      assert.equal(options.manualSend, true);
      return {
        emailStatus: "SMTP_ACCEPTED",
        acceptedAt: new Date("2026-11-30T01:00:00.000Z")
      };
    }
  });

  try {
    const response = makeResponse();
    await sendReminderNow(makeRequest(), response, {
      db,
      process: processWithFakeDelivery
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.reminder.status, "SENT");
    assert.equal(reminder.deliveryStatus, "SMTP_ACCEPTED");
  } finally {
    if (previousDisabledSetting === undefined) {
      delete process.env.DISABLE_BACKGROUND_SCHEDULERS;
    } else {
      process.env.DISABLE_BACKGROUND_SCHEDULERS = previousDisabledSetting;
    }
  }
});

test("manual send atomically retries FAILED/DISABLED without resetting it to pending", async () => {
  const transitions = [];
  let claimWhere;
  const disabledReminder = {
    ...makeReminder("FAILED"),
    deliveryStatus: "DISABLED",
    lastError: "DELIVERY_DISABLED",
    sentAt: null,
    attemptCount: 1,
    emailDeliveryAttempt: {
      status: "DISABLED",
      errorCode: "DELIVERY_DISABLED",
      acceptedAt: null,
      providerMessageId: null
    }
  };
  const db = {
    reminder: {
      findFirst: async () => ({ ...disabledReminder }),
      updateMany: async ({ where, data }) => {
        claimWhere = where;
        const matches = where.OR.some((condition) =>
          Object.entries(condition).every(([key, value]) => disabledReminder[key] === value)
        );
        if (!matches) return { count: 0 };
        disabledReminder.status = data.status;
        disabledReminder.deliveryStatus = data.deliveryStatus;
        disabledReminder.attemptCount += data.attemptCount.increment;
        transitions.push(data.status);
        return { count: 1 };
      },
      update: async ({ data }) => {
        Object.assign(disabledReminder, data);
        transitions.push(data.status);
        return disabledReminder;
      }
    }
  };
  const response = makeResponse();

  await sendReminderNow(makeRequest(), response, {
    db,
    process: (value, { db: processorDb, manualSend }) => processReminder(value, {
      db: processorDb,
      manualSend,
      getOutstanding: async () => ({
        outstanding: 100,
        invoice: {
          id: "invoice-1",
          invoiceNumber: "INV-001",
          status: "ISSUED",
          dueDate: new Date("2026-11-30T00:00:00.000Z"),
          currency: "INR"
        }
      }),
      notify: async (_value, options) => {
        assert.equal(options.manualSend, true);
        return {
          emailStatus: "SMTP_ACCEPTED",
          acceptedAt: new Date("2026-11-30T01:00:00.000Z")
        };
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.reminder.status, "SENT");
  assert.equal(disabledReminder.deliveryStatus, "SMTP_ACCEPTED");
  assert.equal(claimWhere.status, undefined);
  assert.equal(claimWhere.OR[1].status, "FAILED");
  assert.equal(claimWhere.OR[1].deliveryStatus, "DISABLED");
  assert.deepEqual(transitions, ["PROCESSING", "SENT"]);
});

test("manual send is restricted to organization admins and owners", async () => {
  let lookupCount = 0;
  const response = makeResponse();
  await sendReminderNow(makeRequest("USER"), response, {
    db: {
      reminder: {
        findFirst: async () => {
          lookupCount += 1;
          return makeReminder();
        }
      }
    },
    process: async () => {
      throw new Error("Must not process an unauthorized request");
    }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(lookupCount, 0);
});
