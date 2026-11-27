import assert from "node:assert/strict";
import test from "node:test";
import prisma from "../config/prisma.js";
import { deleteReminder } from "./reminder.controller.js";

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

const makeRequest = (role = "OWNER") => ({
  user: { role, organisationId: "org-1" },
  params: { id: "reminder-1" },
});

test("reminder deletion is restricted to organization admins and owners", async () => {
  const originalDeleteMany = prisma.reminder.deleteMany;
  let deleteCalls = 0;
  prisma.reminder.deleteMany = async () => {
    deleteCalls += 1;
    return { count: 1 };
  };

  try {
    for (const role of ["USER", "SUPER_ADMIN"]) {
      const response = makeResponse();
      await deleteReminder(makeRequest(role), response);
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.success, false);
    }
    assert.equal(deleteCalls, 0);
  } finally {
    prisma.reminder.deleteMany = originalDeleteMany;
  }
});

test("deletion atomically targets only pending, cancelled, or failed email reminders in the user's organization", async () => {
  const originalDeleteMany = prisma.reminder.deleteMany;
  let capturedWhere;
  prisma.reminder.deleteMany = async ({ where }) => {
    capturedWhere = where;
    return { count: 1 };
  };

  try {
    for (const role of ["ADMIN", "OWNER"]) {
      const response = makeResponse();
      await deleteReminder(makeRequest(role), response);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.success, true);
    }

    assert.deepEqual(capturedWhere, {
      id: "reminder-1",
      organisationId: "org-1",
      channel: "EMAIL",
      status: { in: ["PENDING", "CANCELLED", "FAILED"] },
      deliveryStatus: { not: "SMTP_ACCEPTED" },
    });
  } finally {
    prisma.reminder.deleteMany = originalDeleteMany;
  }
});

test("sent reminders are retained and processing reminders are not deleted", async () => {
  const originalDeleteMany = prisma.reminder.deleteMany;
  const originalFindFirst = prisma.reminder.findFirst;

  try {
    for (const reminder of [
      { status: "SENT", deliveryStatus: "SMTP_ACCEPTED" },
      { status: "FAILED", deliveryStatus: "SMTP_ACCEPTED" },
      { status: "PROCESSING", deliveryStatus: "PROCESSING" },
    ]) {
      prisma.reminder.deleteMany = async () => ({ count: 0 });
      prisma.reminder.findFirst = async () => reminder;
      const response = makeResponse();
      await deleteReminder(makeRequest(), response);

      assert.equal(response.statusCode, 409);
      assert.equal(response.body.success, false);
      assert.match(
        response.body.message,
        reminder.status === "PROCESSING" ? /being processed/i : /audit history/i,
      );
    }
  } finally {
    prisma.reminder.deleteMany = originalDeleteMany;
    prisma.reminder.findFirst = originalFindFirst;
  }
});

test("a scheduler claim winning the delete race prevents deletion", async () => {
  const originalDeleteMany = prisma.reminder.deleteMany;
  const originalFindFirst = prisma.reminder.findFirst;
  let reminderStatus = "PENDING";

  prisma.reminder.deleteMany = async ({ where }) => {
    assert.deepEqual(where.status, { in: ["PENDING", "CANCELLED", "FAILED"] });
    reminderStatus = "PROCESSING";
    return { count: 0 };
  };
  prisma.reminder.findFirst = async () => ({
    status: reminderStatus,
    deliveryStatus: reminderStatus,
  });

  try {
    const response = makeResponse();
    await deleteReminder(makeRequest(), response);
    assert.equal(response.statusCode, 409);
    assert.match(response.body.message, /being processed/i);
  } finally {
    prisma.reminder.deleteMany = originalDeleteMany;
    prisma.reminder.findFirst = originalFindFirst;
  }
});
