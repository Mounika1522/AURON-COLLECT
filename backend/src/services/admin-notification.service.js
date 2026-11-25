const ALLOWED_NOTIFICATION_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "SUPER_ADMIN",
  "USER",
]);
const NOTIFICATION_SOURCE_PATTERN =
  /^(OVERDUE_INVOICE|UPCOMING_DUE|PAYMENT_RECEIVED|BROKEN_PROMISE|ASSIGNED_TASK|IMPORTANT_DISPUTE|FAILED_EMAIL):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AdminNotificationPermissionError extends Error {
  constructor() {
    super("You do not have permission to view these notifications.");
    this.name = "AdminNotificationPermissionError";
    this.statusCode = 403;
  }
}

export const getAdminNotificationAccess = (user) => {
  const role = String(user?.role || "").toUpperCase();
  if (
    !ALLOWED_NOTIFICATION_ROLES.has(role) ||
    !user?.organisationId ||
    !user?.userId ||
    (role === "USER" && !String(user.name || "").trim())
  ) {
    throw new AdminNotificationPermissionError();
  }

  return {
    role,
    organisationId: user.organisationId,
    userId: user.userId,
    assignedExecutive: role === "USER" ? String(user.name).trim() : null,
    canViewOrganisation: role !== "USER",
  };
};

export const isValidNotificationSourceKey = (sourceKey) =>
  typeof sourceKey === "string" &&
  sourceKey.length <= 160 &&
  NOTIFICATION_SOURCE_PATTERN.test(sourceKey);

const isVisibleToUser = (event, access) => {
  if (event.organisationId !== access.organisationId) return false;
  if (access.canViewOrganisation) return true;

  return (
    event.assignedExecutive === access.assignedExecutive ||
    event.assignedExecutives?.includes(access.assignedExecutive)
  );
};

export const buildAdminNotificationResponse = (
  events,
  readStates,
  access,
  limit = 100,
) => {
  const readAtBySourceKey = new Map(
    readStates.map((state) => [state.sourceKey, state.readAt]),
  );
  const notifications = events
    .filter((event) => isVisibleToUser(event, access))
    .map((event) => {
      const readAt = readAtBySourceKey.get(event.sourceKey) || null;
      return {
        id: event.sourceKey,
        type: event.type,
        title: event.title,
        message: event.message,
        createdAt: event.createdAt,
        readAt,
        unread: !readAt,
      };
    })
    .sort((left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );

  return {
    unreadCount: notifications.filter((notification) => notification.unread).length,
    notifications: notifications.slice(0, limit),
  };
};

export const mapAutomatedEmailReminders = (reminders, attempts) => {
  const latestAttemptByPurpose = new Map();
  for (const attempt of attempts) {
    const previous = latestAttemptByPurpose.get(attempt.purpose);
    if (
      !previous ||
      new Date(attempt.createdAt) > new Date(previous.createdAt)
    ) {
      latestAttemptByPurpose.set(attempt.purpose, attempt);
    }
  }

  return reminders
    .filter(
      (reminder) =>
        String(reminder.channel || "").toUpperCase() === "EMAIL" &&
        !String(reminder.dedupeKey || "").startsWith("manual:"),
    )
    .map((reminder) => {
      const attempt = latestAttemptByPurpose.get(
        `PAYMENT_REMINDER:${reminder.dedupeKey}`,
      );
      const failed =
        attempt?.status === "FAILED" || reminder.status === "FAILED";

      return {
        id: reminder.id,
        customerName: reminder.customer?.name || "",
        recipient: attempt?.recipient || reminder.customer?.email || "",
        invoiceNumber: reminder.invoice?.invoiceNumber || "",
        subject: reminder.subject || "",
        scheduledFor: reminder.scheduledFor,
        sentAt:
          attempt?.acceptedAt ||
          attempt?.attemptedAt ||
          reminder.sentAt ||
          null,
        deliveryStatus: attempt?.status || reminder.deliveryStatus || "PENDING",
        failureStatus: failed
          ? attempt?.errorCode ||
            attempt?.errorMessage ||
            reminder.lastError ||
            "Email delivery failed"
          : null,
      };
    });
};
