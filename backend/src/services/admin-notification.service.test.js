import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminNotificationPermissionError,
  buildAdminNotificationResponse,
  getAdminNotificationAccess,
  isValidNotificationSourceKey,
  mapAutomatedEmailReminders,
} from "./admin-notification.service.js";

const notificationId = "550e8400-e29b-41d4-a716-446655440000";
const otherNotificationId = "550e8400-e29b-41d4-a716-446655440001";

test("notification access is organization-wide for admins and assignment-scoped for users", () => {
  assert.deepEqual(
    getAdminNotificationAccess({
      userId: "user-1",
      organisationId: "org-1",
      role: "ADMIN",
      name: "Admin",
    }),
    {
      userId: "user-1",
      organisationId: "org-1",
      role: "ADMIN",
      assignedExecutive: null,
      canViewOrganisation: true,
    },
  );
  assert.deepEqual(
    getAdminNotificationAccess({
      userId: "user-2",
      organisationId: "org-1",
      role: "USER",
      name: " Alex Morgan ",
    }),
    {
      userId: "user-2",
      organisationId: "org-1",
      role: "USER",
      assignedExecutive: "Alex Morgan",
      canViewOrganisation: false,
    },
  );
  assert.equal(
    getAdminNotificationAccess({
      userId: "owner-1",
      organisationId: "org-1",
      role: "OWNER",
    }).canViewOrganisation,
    true,
  );

  for (const user of [
    { userId: "user-1", organisationId: "org-1", role: "CUSTOMER" },
    { userId: "user-1", organisationId: "org-1", role: "USER" },
    { userId: "user-1", role: "ADMIN" },
  ]) {
    assert.throws(() => getAdminNotificationAccess(user), AdminNotificationPermissionError);
  }
});

test("notification response keeps organization, assignment, and per-user read state isolated", () => {
  const access = getAdminNotificationAccess({
    userId: "user-1",
    organisationId: "org-1",
    role: "USER",
    name: "Alex Morgan",
  });
  const events = [
    {
      sourceKey: `OVERDUE_INVOICE:${notificationId}`,
      organisationId: "org-1",
      assignedExecutive: "Alex Morgan",
      title: "Assigned invoice",
      createdAt: new Date("2026-11-20T00:00:00.000Z"),
    },
    {
      sourceKey: `OVERDUE_INVOICE:${otherNotificationId}`,
      organisationId: "org-1",
      assignedExecutive: "Jordan Lee",
      title: "Other executive invoice",
      createdAt: new Date("2026-11-21T00:00:00.000Z"),
    },
    {
      sourceKey: `UPCOMING_DUE:${otherNotificationId}`,
      organisationId: "org-2",
      assignedExecutive: "Alex Morgan",
      title: "Other organization invoice",
      createdAt: new Date("2026-11-22T00:00:00.000Z"),
    },
  ];
  const response = buildAdminNotificationResponse(
    events,
    [{ sourceKey: events[0].sourceKey, readAt: new Date("2026-11-21T00:00:00.000Z") }],
    access,
  );

  assert.equal(response.unreadCount, 0);
  assert.equal(response.notifications.length, 1);
  assert.equal(response.notifications[0].id, events[0].sourceKey);
  assert.equal(response.notifications[0].unread, false);

  const adminResponse = buildAdminNotificationResponse(
    events,
    [],
    getAdminNotificationAccess({
      userId: "admin-1",
      organisationId: "org-1",
      role: "ADMIN",
    }),
  );
  assert.deepEqual(
    adminResponse.notifications.map((notification) => notification.title),
    ["Other executive invoice", "Assigned invoice"],
  );
  assert.equal(adminResponse.unreadCount, 2);
});

test("notification read endpoint identifiers accept only typed UUID source keys", () => {
  assert.equal(isValidNotificationSourceKey(`PAYMENT_RECEIVED:${notificationId}`), true);
  assert.equal(isValidNotificationSourceKey(`PAYMENT_RECEIVED:${notificationId}/read`), false);
  assert.equal(isValidNotificationSourceKey(`UNKNOWN:${notificationId}`), false);
  assert.equal(isValidNotificationSourceKey(`FAILED_EMAIL:${"x".repeat(200)}`), false);
});

test("automated email history uses email attempts and excludes manual or non-email reminders", () => {
  const reminders = [
    {
      id: "automated-1",
      dedupeKey: "due-email:invoice-1:2026-11-21",
      channel: "EMAIL",
      subject: "Due invoice",
      scheduledFor: new Date("2026-11-21T00:00:00.000Z"),
      deliveryStatus: "PENDING",
      customer: { name: "Customer One", email: "one@example.test" },
      invoice: { invoiceNumber: "INV-001" },
    },
    {
      id: "manual-1",
      dedupeKey: "manual:invoice-2:2026-11-21",
      channel: "EMAIL",
      customer: { name: "Customer Two", email: "two@example.test" },
    },
    {
      id: "sms-1",
      dedupeKey: "due-sms:invoice-3:2026-11-21",
      channel: "SMS",
      customer: { name: "Customer Three", email: "three@example.test" },
    },
  ];
  const attempts = [
    {
      purpose: "PAYMENT_REMINDER:due-email:invoice-1:2026-11-21",
      recipient: "one@example.test",
      status: "FAILED",
      errorCode: "TEMPORARY_FAILURE",
      createdAt: new Date("2026-11-21T01:00:00.000Z"),
    },
    {
      purpose: "PAYMENT_REMINDER:due-email:invoice-1:2026-11-21",
      recipient: "one@example.test",
      status: "SMTP_ACCEPTED",
      createdAt: new Date("2026-11-21T02:00:00.000Z"),
      acceptedAt: new Date("2026-11-21T02:00:00.000Z"),
    },
  ];
  const history = mapAutomatedEmailReminders(reminders, attempts);

  assert.equal(history.length, 1);
  assert.equal(history[0].id, "automated-1");
  assert.equal(history[0].recipient, "one@example.test");
  assert.equal(history[0].deliveryStatus, "SMTP_ACCEPTED");
  assert.equal(history[0].failureStatus, null);
});

test("automated email history exposes failure details from the latest failed attempt", () => {
  const history = mapAutomatedEmailReminders(
    [{
      id: "automated-failed",
      dedupeKey: "retry-email:invoice-1",
      channel: "EMAIL",
      status: "FAILED",
      deliveryStatus: "FAILED",
      lastError: "SMTP rejected recipient",
      customer: { name: "Customer One", email: "one@example.test" },
      invoice: { invoiceNumber: "INV-001" },
    }],
    [{
      purpose: "PAYMENT_REMINDER:retry-email:invoice-1",
      recipient: "one@example.test",
      status: "FAILED",
      errorCode: "SMTP_REJECTED",
      errorMessage: "Recipient rejected",
      createdAt: new Date("2026-11-21T02:00:00.000Z"),
    }],
  );

  assert.equal(history[0].deliveryStatus, "FAILED");
  assert.equal(history[0].failureStatus, "SMTP_REJECTED");
});
