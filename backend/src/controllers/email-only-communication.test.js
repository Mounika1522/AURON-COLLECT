import assert from "node:assert/strict";
import test from "node:test";
import { createCommunication } from "./communication.controller.js";
import {
  createReminder,
  createReminderTemplate,
  updateReminderStatus,
} from "./reminder.controller.js";

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
  },
});

test("communication creation rejects SMS and WhatsApp without sending or storing messages", async () => {
  for (const channel of ["SMS", "WHATSAPP"]) {
    const response = makeResponse();
    await createCommunication(
      {
        user: { organisationId: "org-1", userId: "user-1" },
        body: { customerId: "customer-1", channel, message: "test message" },
      },
      response,
    );
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.success, false);
  }
});

test("reminder and template creation reject non-email delivery channels", async () => {
  for (const channel of ["SMS", "WHATSAPP"]) {
    const reminderResponse = makeResponse();
    await createReminder(
      {
        user: { organisationId: "org-1", userId: "user-1" },
        body: {
          customerId: "customer-1",
          scheduledFor: "2026-11-21T00:00:00.000Z",
          channel,
          message: "test reminder",
          dedupeKey: `test-${channel}`,
        },
      },
      reminderResponse,
    );
    assert.equal(reminderResponse.statusCode, 400);
    assert.match(reminderResponse.body.message, /email reminders/i);

    const templateResponse = makeResponse();
    await createReminderTemplate(
      {
        user: { organisationId: "org-1" },
        body: {
          name: `Test ${channel}`,
          triggerStage: "ON_DUE_DATE",
          channel,
          body: "test template",
        },
      },
      templateResponse,
    );
    assert.equal(templateResponse.statusCode, 400);
    assert.match(templateResponse.body.message, /email reminders/i);
  }
});

test("reminder status endpoint cannot fabricate email delivery success", async () => {
  const response = makeResponse();
  await updateReminderStatus(
    {
      user: { organisationId: "org-1", userId: "user-1" },
      params: { id: "reminder-1" },
      body: { status: "SENT" },
    },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /cancelled manually/i);
});
