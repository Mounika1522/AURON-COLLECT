import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminNotificationPermissionError,
  buildAdminNotificationResponse,
  getAdminNotificationAccess,
  isValidNotificationSourceKey,
  mapEmailDeliveryAttemptNotification,
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

test("admin notifications expose missing verified customer email attempts", () => {
  const attempt = {
    id: notificationId,
    purpose: "PAYMENT_RECEIPT",
    recipient: "",
    status: "SKIPPED",
    errorCode: "NO_VERIFIED_EMAIL",
    createdAt: new Date("2026-11-30T12:00:00.000Z"),
    customer: { name: "Customer One" },
    customerSubscriptionReceipt: { receiptNumber: "CS-REC-001" },
  };
  const notification = mapEmailDeliveryAttemptNotification(attempt, "org-1");
  const access = getAdminNotificationAccess({
    userId: "admin-1",
    organisationId: "org-1",
    role: "ADMIN",
  });
  const response = buildAdminNotificationResponse([notification], [], access);

  assert.equal(response.notifications.length, 1);
  assert.equal(response.notifications[0].title, "Customer email not verified");
  assert.match(response.notifications[0].message, /CS-REC-001/);
  assert.match(response.notifications[0].message, /No verified customer email/);
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

test("automated email history reports verified-recipient waiting state and retry timestamps", () => {
  const nextAttemptAt = new Date("2026-11-30T12:00:00.000Z");
  const history = mapAutomatedEmailReminders(
    [{
      id: "automated-pending",
      dedupeKey: "invoice:invoice-2:DUE_DATE",
      channel: "EMAIL",
      status: "PENDING",
      deliveryStatus: "WAITING_FOR_VERIFIED_EMAIL",
      attemptCount: 0,
      nextAttemptAt,
      customer: {
        name: "Customer Two",
        email: "unverified-crm@example.test",
        portalAccount: { timeZone: "America/New_York" }
      },
      invoice: { invoiceNumber: "INV-002" }
    }],
    []
  );

  assert.equal(history[0].recipient, "");
  assert.equal(history[0].deliveryStatus, "WAITING_FOR_VERIFIED_EMAIL");
  assert.equal(history[0].customerTimeZone, "America/New_York");
  assert.equal(history[0].nextAttemptAt, nextAttemptAt);
  assert.equal(history[0].attemptCount, 0);
  assert.equal(history[0].failureStatus, null);
});

test("automated email history exposes ambiguous delivery failures for admin review", () => {
  const history = mapAutomatedEmailReminders(
    [{
      id: "automated-unknown",
      dedupeKey: "invoice:invoice-3:OVERDUE_1_DAY",
      channel: "EMAIL",
      status: "FAILED",
      deliveryStatus: "DELIVERY_UNKNOWN",
      lastError: "DELIVERY_OUTCOME_UNKNOWN",
      customer: { name: "Customer Three" },
      invoice: { invoiceNumber: "INV-003" }
    }],
    [{
      purpose: "PAYMENT_REMINDER:invoice:invoice-3:OVERDUE_1_DAY",
      recipient: "verified@example.test",
      status: "DELIVERY_UNKNOWN",
      errorCode: "DELIVERY_OUTCOME_UNKNOWN",
      attemptCount: 1,
      attemptedAt: new Date("2026-11-30T11:00:00.000Z"),
      createdAt: new Date("2026-11-30T10:59:00.000Z")
    }]
  );

  assert.equal(history[0].deliveryStatus, "DELIVERY_UNKNOWN");
  assert.equal(history[0].failureStatus, "DELIVERY_OUTCOME_UNKNOWN");
  assert.equal(history[0].attemptCount, 1);
  assert.equal(history[0].lastAttemptAt.toISOString(), "2026-11-30T11:00:00.000Z");
});
