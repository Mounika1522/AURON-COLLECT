import assert from "node:assert/strict";
import test from "node:test";
import {
  sendTrackedCustomerEmail,
  sendTrackedReminderEmail
} from "./customer-email-delivery.service.js";

const productionSmtp = {
  NODE_ENV: "production",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_USER: "test-user",
  SMTP_PASS: "test-password",
  EMAIL_FROM: "billing@example.test"
};

const makeAttemptStore = () => {
  const attempts = new Map();
  let nextId = 0;
  const applyUpdate = (attempt, data) => {
    for (const [key, value] of Object.entries(data)) {
      if (key === "attemptCount" && value?.increment) {
        attempt.attemptCount += value.increment;
      } else {
        attempt[key] = value;
      }
    }
    return attempt;
  };
  return {
    attempts,
    db: {
      emailDeliveryAttempt: {
        findUnique: async ({ where }) => attempts.get(where.reminderId) || null,
        create: async ({ data }) => {
          if (attempts.has(data.reminderId)) {
            const error = new Error("Unique reminder attempt");
            error.code = "P2002";
            throw error;
          }
          const attempt = {
            id: `attempt-${++nextId}`,
            attemptCount: 0,
            createdAt: new Date("2026-11-30T00:00:00.000Z"),
            ...data
          };
          attempts.set(data.reminderId, attempt);
          return attempt;
        },
        updateMany: async ({ where, data }) => {
          const attempt = [...attempts.values()].find(
            (item) => item.id === where.id && item.status === where.status
          );
          if (!attempt) return { count: 0 };
          applyUpdate(attempt, data);
          return { count: 1 };
        },
        update: async ({ where, data }) => {
          const attempt = [...attempts.values()].find(
            (item) => item.id === where.id
          );
          assert.ok(attempt);
          return applyUpdate(attempt, data);
        }
      }
    }
  };
};

const makeCustomerAttemptStore = () => {
  const attempts = [];
  let nextId = 0;
  return {
    attempts,
    db: {
      emailDeliveryAttempt: {
        findFirst: async ({ where }) => attempts.find((attempt) =>
          attempt.customerSubscriptionReceiptId === where.customerSubscriptionReceiptId &&
          attempt.purpose === where.purpose
        ) || null,
        create: async ({ data }) => {
          const attempt = { id: `customer-attempt-${++nextId}`, ...data };
          attempts.push(attempt);
          return attempt;
        },
        updateMany: async ({ where, data }) => {
          const attempt = attempts.find((item) =>
            item.id === where.id &&
            item.status === where.status &&
            item.errorCode === where.errorCode
          );
          if (!attempt) return { count: 0 };
          Object.assign(attempt, data);
          return { count: 1 };
        },
        update: async ({ where, data }) => {
          const attempt = attempts.find((item) => item.id === where.id);
          assert.ok(attempt);
          Object.assign(attempt, data);
          return attempt;
        }
      }
    }
  };
};

const reminderEmail = {
  accountId: "account-1",
  customerId: "customer-1",
  invoiceId: "invoice-1",
  reminderId: "reminder-1",
  purpose: "PAYMENT_REMINDER:dedupe-1",
  to: "verified@example.test",
  subject: "Payment reminder",
  text: "Payment reference INV-001"
};

test("development registration OTP uses its purpose-specific email opt-in", async () => {
  const { db, attempts } = makeCustomerAttemptStore();
  const developmentSmtp = {
    ...productionSmtp,
    NODE_ENV: "development",
    ENABLE_DEV_CUSTOMER_VERIFICATION_EMAIL: "true"
  };
  const message = {
    accountId: "account-otp",
    customerId: "customer-otp",
    purpose: "EMAIL_VERIFICATION",
    to: "customer-entered@example.test",
    subject: "Verify your email",
    text: "Verification code: 012345"
  };
  let delivered;
  const result = await sendTrackedCustomerEmail(message, {
    db,
    env: developmentSmtp,
    allowDevelopmentCustomerVerification: true,
    deliver: async (email, options) => {
      delivered = { email, options };
      return { accepted: [email.to], messageId: "otp-message-1" };
    }
  });

  assert.equal(result.status, "SMTP_ACCEPTED");
  assert.equal(delivered.email.to, "customer-entered@example.test");
  assert.equal(delivered.email.text.includes("012345"), true);
  assert.equal(delivered.options.allowDevelopmentCustomerVerification, true);
  assert.equal(attempts[0].status, "SMTP_ACCEPTED");
  assert.equal(attempts[0].recipient, "customer-entered@example.test");
  assert.equal(JSON.stringify(result).includes("012345"), false);
});

test("development registration OTP stays disabled without the explicit opt-in", async () => {
  const { db, attempts } = makeCustomerAttemptStore();
  let sendCount = 0;
  const result = await sendTrackedCustomerEmail({
    accountId: "account-otp",
    customerId: "customer-otp",
    purpose: "EMAIL_VERIFICATION",
    to: "customer-entered@example.test",
    subject: "Verify your email",
    text: "Verification code: 012345"
  }, {
    db,
    env: { ...productionSmtp, NODE_ENV: "development" },
    deliver: async () => {
      sendCount += 1;
      return { accepted: ["customer-entered@example.test"] };
    }
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(result.errorCode, "NOTIFICATION_DELIVERY_DISABLED");
  assert.equal(sendCount, 0);
  assert.equal(attempts[0].status, "DISABLED");
  assert.equal(attempts[0].errorCode, "NOTIFICATION_DELIVERY_DISABLED");
});

test("OTP SMTP failures are tracked without logging recipient or code", async () => {
  const { db, attempts } = makeCustomerAttemptStore();
  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logs.push(args);
  let result;
  try {
    result = await sendTrackedCustomerEmail({
      accountId: "account-otp",
      customerId: "customer-otp",
      purpose: "EMAIL_VERIFICATION",
      to: "customer-entered@example.test",
      subject: "Verify your email",
      text: "Verification code: 012345"
    }, {
      db,
      env: productionSmtp,
      deliver: async () => {
        const error = new Error("535 SMTP authentication failed");
        error.code = "EAUTH";
        throw error;
      }
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(result.status, "FAILED");
  assert.equal(result.errorCode, "EAUTH");
  assert.equal(attempts[0].status, "FAILED");
  assert.equal(attempts[0].errorCode, "EAUTH");
  assert.equal(attempts[0].errorMessage, "SMTP submission failed");
  const logText = JSON.stringify(logs);
  assert.equal(logText.includes("customer-entered@example.test"), false);
  assert.equal(logText.includes("012345"), false);
  assert.equal(logText.includes("535 SMTP authentication failed"), false);
});

test("customer verification opt-in does not enable development password-reset email", async () => {
  const { db, attempts } = makeCustomerAttemptStore();
  let sendCount = 0;
  const result = await sendTrackedCustomerEmail({
    accountId: "account-otp",
    customerId: "customer-otp",
    purpose: "PASSWORD_RESET",
    to: "customer-entered@example.test",
    subject: "Reset password",
    text: "Reset link"
  }, {
    db,
    env: {
      ...productionSmtp,
      NODE_ENV: "development",
      ENABLE_DEV_CUSTOMER_VERIFICATION_EMAIL: "true"
    },
    deliver: async () => {
      sendCount += 1;
      return { accepted: ["customer-entered@example.test"] };
    }
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(sendCount, 0);
  assert.equal(attempts[0].errorCode, "NOTIFICATION_DELIVERY_DISABLED");
});

test("reminder delivery stores one idempotent attempt and never resends an accepted email", async () => {
  const { db, attempts } = makeAttemptStore();
  let sendCount = 0;
  const deliver = async ({ to }) => {
    sendCount += 1;
    return { accepted: [to], messageId: "provider-message-1" };
  };
  const options = {
    db,
    deliver,
    env: productionSmtp,
    now: () => new Date("2026-11-30T01:00:00.000Z")
  };

  const first = await sendTrackedReminderEmail(reminderEmail, options);
  const duplicate = await sendTrackedReminderEmail(reminderEmail, options);

  assert.equal(first.status, "SMTP_ACCEPTED");
  assert.equal(duplicate.status, "SMTP_ACCEPTED");
  assert.equal(duplicate.alreadyAccepted, true);
  assert.equal(sendCount, 1);
  assert.equal(attempts.size, 1);
  assert.equal(attempts.get("reminder-1").attemptCount, 1);
  assert.equal(attempts.get("reminder-1").recipient, "verified@example.test");
  assert.equal(
    attempts.get("reminder-1").acceptedAt.toISOString(),
    "2026-11-30T01:00:00.000Z"
  );
});

test("development runtime records DELIVERY_DISABLED without invoking SMTP", async () => {
  const { db, attempts } = makeAttemptStore();
  let sendCount = 0;
  const result = await sendTrackedReminderEmail(reminderEmail, {
    db,
    env: { ...productionSmtp, NODE_ENV: "development" },
    deliver: async () => {
      sendCount += 1;
      return { accepted: ["verified@example.test"] };
    }
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(result.errorCode, "DELIVERY_DISABLED");
  assert.equal(sendCount, 0);
  assert.equal(attempts.get("reminder-1").status, "DISABLED");
  assert.equal(attempts.get("reminder-1").errorMessage, "Email delivery is disabled for this runtime.");
});

test("development opt-in allows only manual retry of a prior DELIVERY_DISABLED attempt", async () => {
  const { db, attempts } = makeAttemptStore();
  const developmentSmtp = {
    ...productionSmtp,
    NODE_ENV: "development",
    ENABLE_DEV_EMAIL_DELIVERY: "true"
  };
  let sendCount = 0;
  const statusesAtTransport = [];
  const manualRecipient = "updated-verified@example.test";
  const deliver = async ({ to }) => {
    sendCount += 1;
    statusesAtTransport.push(attempts.get("reminder-1")?.status);
    return { accepted: [to], messageId: "dev-message-1" };
  };

  const automatic = await sendTrackedReminderEmail(reminderEmail, {
    db,
    env: developmentSmtp,
    deliver
  });
  assert.equal(automatic.status, "DISABLED");
  assert.equal(sendCount, 0);

  const manual = await sendTrackedReminderEmail({
    ...reminderEmail,
    to: manualRecipient
  }, {
    db,
    env: developmentSmtp,
    deliver,
    manualSend: true,
    now: () => new Date("2026-11-30T01:00:00.000Z")
  });

  assert.equal(manual.status, "SMTP_ACCEPTED");
  assert.equal(sendCount, 1);
  assert.deepEqual(statusesAtTransport, ["SENDING"]);
  assert.equal(attempts.size, 1);
  assert.equal(attempts.get("reminder-1").attemptCount, 1);
  assert.equal(attempts.get("reminder-1").recipient, manualRecipient);
  assert.equal(attempts.get("reminder-1").providerMessageId, "dev-message-1");
});

test("development manual sends remain disabled without the explicit opt-in", async () => {
  const { db, attempts } = makeAttemptStore();
  let sendCount = 0;
  const result = await sendTrackedReminderEmail(reminderEmail, {
    db,
    env: { ...productionSmtp, NODE_ENV: "development" },
    deliver: async () => {
      sendCount += 1;
      return { accepted: ["verified@example.test"] };
    },
    manualSend: true
  });

  assert.equal(result.status, "DISABLED");
  assert.equal(result.errorCode, "DELIVERY_DISABLED");
  assert.equal(sendCount, 0);
  assert.equal(attempts.get("reminder-1").status, "DISABLED");
});

test("development scheduler opt-in enables only reminder sends without manual authorization", async () => {
  const { db, attempts } = makeAttemptStore();
  const env = {
    ...productionSmtp,
    NODE_ENV: "development",
    ENABLE_DEV_REMINDER_SCHEDULER: "true"
  };
  let sendCount = 0;
  const result = await sendTrackedReminderEmail(reminderEmail, {
    db,
    env,
    schedulerSend: true,
    deliver: async ({ to }) => {
      sendCount += 1;
      return { accepted: [to], messageId: "scheduled-dev-message" };
    }
  });

  assert.equal(result.status, "SMTP_ACCEPTED");
  assert.equal(sendCount, 1);
  assert.equal(attempts.get("reminder-1").status, "SMTP_ACCEPTED");
  assert.equal(attempts.get("reminder-1").providerMessageId, "scheduled-dev-message");
});

test("only explicit transient SMTP rejection is retried and the same record is reused", async () => {
  const { db, attempts } = makeAttemptStore();
  let sendCount = 0;
  const options = {
    db,
    env: productionSmtp,
    now: () => new Date("2026-11-30T01:00:00.000Z"),
    deliver: async ({ to }) => {
      sendCount += 1;
      if (sendCount === 1) {
        const error = new Error("Temporary SMTP rejection");
        error.code = "EENVELOPE";
        error.responseCode = 451;
        throw error;
      }
      return { accepted: [to], messageId: "provider-message-2" };
    }
  };

  const first = await sendTrackedReminderEmail(reminderEmail, options);
  const retried = await sendTrackedReminderEmail(reminderEmail, options);

  assert.equal(first.status, "RETRY_SCHEDULED");
  assert.equal(first.retryable, true);
  assert.equal(first.errorMessage, "Temporary SMTP rejection");
  assert.equal(retried.status, "SMTP_ACCEPTED");
  assert.equal(sendCount, 2);
  assert.equal(attempts.size, 1);
  assert.equal(attempts.get("reminder-1").attemptCount, 2);
});

test("ambiguous SMTP outcomes are recorded and never automatically resent", async () => {
  const { db, attempts } = makeAttemptStore();
  let sendCount = 0;
  const options = {
    db,
    env: productionSmtp,
    deliver: async () => {
      sendCount += 1;
      const error = new Error("Timeout after DATA");
      error.code = "ETIMEDOUT";
      error.command = "DATA";
      throw error;
    }
  };

  const first = await sendTrackedReminderEmail(reminderEmail, options);
  const duplicate = await sendTrackedReminderEmail(reminderEmail, options);

  assert.equal(first.status, "DELIVERY_UNKNOWN");
  assert.equal(duplicate.status, "DELIVERY_UNKNOWN");
  assert.equal(sendCount, 1);
  assert.equal(attempts.get("reminder-1").attemptCount, 1);
});

test("reminders without a verified recipient remain pending without touching SMTP", async () => {
  const { db, attempts } = makeAttemptStore();
  let sendCount = 0;
  const result = await sendTrackedReminderEmail({
    ...reminderEmail,
    to: ""
  }, {
    db,
    env: productionSmtp,
    deliver: async () => {
      sendCount += 1;
      return { accepted: [] };
    }
  });

  assert.equal(result.status, "WAITING_FOR_VERIFIED_EMAIL");
  assert.equal(sendCount, 0);
  assert.equal(attempts.size, 0);
});

test("customer email without a verified recipient is recorded and never sent", async () => {
  const { db, attempts } = makeCustomerAttemptStore();
  let sendCount = 0;
  const result = await sendTrackedCustomerEmail({
    customerId: "customer-1",
    purpose: "PAYMENT_RECEIVED",
    to: "",
    subject: "Payment received",
    text: "Payment received"
  }, {
    db,
    deliver: async () => {
      sendCount += 1;
      return { accepted: [] };
    },
    env: productionSmtp
  });

  assert.equal(result.status, "SKIPPED");
  assert.equal(sendCount, 0);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].recipient, "");
  assert.equal(attempts[0].status, "SKIPPED");
  assert.equal(attempts[0].errorCode, "NO_VERIFIED_EMAIL");
});

test("subscription receipt delivery resumes its pending attempt after email verification", async () => {
  const { db, attempts } = makeCustomerAttemptStore();
  let sendCount = 0;
  const baseEmail = {
    customerId: "customer-1",
    customerSubscriptionReceiptId: "subscription-receipt-1",
    purpose: "PAYMENT_RECEIPT",
    subject: "Payment receipt",
    text: "Payment receipt"
  };
  const skipped = await sendTrackedCustomerEmail({
    ...baseEmail,
    to: ""
  }, {
    db,
    env: productionSmtp,
    deliver: async () => {
      sendCount += 1;
      return { accepted: [] };
    }
  });
  const delivered = await sendTrackedCustomerEmail({
    ...baseEmail,
    accountId: "account-1",
    to: "verified@example.test"
  }, {
    db,
    env: productionSmtp,
    deliver: async ({ to }) => {
      sendCount += 1;
      return { accepted: [to], messageId: "message-1" };
    }
  });
  const duplicate = await sendTrackedCustomerEmail({
    ...baseEmail,
    accountId: "account-1",
    to: "verified@example.test"
  }, {
    db,
    env: productionSmtp,
    deliver: async ({ to }) => {
      sendCount += 1;
      return { accepted: [to] };
    }
  });

  assert.equal(skipped.status, "SKIPPED");
  assert.equal(delivered.status, "SMTP_ACCEPTED");
  assert.equal(duplicate.status, "ALREADY_ATTEMPTED");
  assert.equal(sendCount, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].recipient, "verified@example.test");
  assert.equal(attempts[0].status, "SMTP_ACCEPTED");
});
