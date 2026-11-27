import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import test from "node:test";
import { sendEmail } from "./email.service.js";
import {
  createStaffPasswordResetToken,
  hashStaffPasswordResetToken,
  requestStaffPasswordReset,
  resetStaffPassword,
  STAFF_PASSWORD_RESET_TTL_MS
} from "./staff-password-reset.service.js";

const resetToken = "A".repeat(43);
const newPassword = "Valid-Reset-Password-94!";
const baseTime = new Date("2026-11-27T06:00:00.000Z");
const emailEnvironment = {
  NODE_ENV: "development",
  ENABLE_DEV_EMAIL_DELIVERY: "true",
  SMTP_HOST: "smtp.example.invalid",
  SMTP_PORT: "587",
  SMTP_USER: "sender@example.invalid",
  SMTP_PASS: "test-only-smtp-placeholder",
  EMAIL_FROM: "AURON COLLECT <sender@example.invalid>",
  FRONTEND_URL: "https://portal.example.invalid"
};

const makeDatabase = async ({
  withUser = true,
  token = null,
  expiresAt = new Date(baseTime.getTime() + STAFF_PASSWORD_RESET_TTL_MS)
} = {}) => {
  const user = withUser
    ? {
        id: "staff-user-1",
        name: "Staff User",
        email: "staff@example.invalid",
        password: await bcrypt.hash("Original-Staff-Password-45!", 4),
        sessionVersion: 2
      }
    : null;
  const records = new Map();
  if (token) {
    records.set(token.userId, {
      id: "reset-row-1",
      userId: token.userId,
      tokenHash: token.tokenHash,
      expiresAt,
      createdAt: new Date(baseTime.getTime() - 2 * STAFF_PASSWORD_RESET_TTL_MS)
    });
  }

  const db = {
    user: {
      findFirst: async ({ where }) =>
        user?.email === where.email
          ? { id: user.id, name: user.name, email: user.email }
          : null,
      updateMany: async ({ where, data }) => {
        if (
          !user ||
          where.id !== user.id ||
          where.password !== user.password ||
          where.sessionVersion !== user.sessionVersion
        ) {
          return { count: 0 };
        }
        user.password = data.password;
        user.sessionVersion += data.sessionVersion.increment;
        return { count: 1 };
      }
    },
    staffPasswordResetToken: {
      findUnique: async ({ where }) => {
        if (where.userId) return records.get(where.userId) || null;
        return [...records.values()].find((record) =>
          record.tokenHash === where.tokenHash
        ) || null;
      },
      findFirst: async ({ where }) => {
        const record = [...records.values()].find((candidate) =>
          candidate.tokenHash === where.tokenHash &&
          candidate.expiresAt > where.expiresAt.gt
        );
        return record && user
          ? { ...record, user: { id: user.id, password: user.password, sessionVersion: user.sessionVersion } }
          : null;
      },
      upsert: async ({ where, create, update }) => {
        const existing = records.get(where.userId);
        const record = existing
          ? { ...existing, ...update }
          : { id: "reset-row-1", ...create };
        records.set(where.userId, record);
        return record;
      },
      deleteMany: async ({ where }) => {
        const record = records.get(where.userId) ||
          [...records.values()].find((candidate) => candidate.id === where.id);
        if (
          record &&
          (!where.id || record.id === where.id) &&
          (!where.userId || record.userId === where.userId) &&
          (!where.tokenHash || record.tokenHash === where.tokenHash) &&
          (!where.expiresAt || record.expiresAt > where.expiresAt.gt)
        ) {
          records.delete(record.userId);
          return { count: 1 };
        }
        return { count: 0 };
      }
    },
    $queryRaw: async () => [],
    $transaction: async (callback) => callback(db)
  };
  return { db, user, records };
};

test("staff reset issues a hashed 15-minute token and delivers a reset link via Nodemailer test transport", async () => {
  const { db, records } = await makeDatabase();
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix"
  });
  let generatedToken;
  let mimeMessage;
  const result = await requestStaffPasswordReset("  STAFF@EXAMPLE.INVALID ", {
    db,
    env: emailEnvironment,
    now: () => baseTime,
    tokenFactory: () => {
      generatedToken = createStaffPasswordResetToken();
      return generatedToken;
    },
    deliverEmail: async (message, options) => {
      mimeMessage = await sendEmail(message, {
        ...options,
        transporterFactory: () => transport
      });
      return { ...mimeMessage, accepted: [message.to] };
    },
    logger: { error: () => {} }
  });

  assert.deepEqual(result, { status: "ACCEPTED" });
  const record = records.get("staff-user-1");
  assert.equal(record.tokenHash, hashStaffPasswordResetToken(generatedToken));
  assert.notEqual(record.tokenHash, generatedToken);
  assert.equal(
    record.expiresAt.getTime() - baseTime.getTime(),
    STAFF_PASSWORD_RESET_TTL_MS
  );
  await transport.close();
  const rawMime = mimeMessage.message.toString("utf8");
  assert.ok(rawMime.includes("staff@example.invalid"));
  assert.ok(rawMime.includes("https://portal.example.invalid/"));
  assert.ok(rawMime.includes("staffReset"));
  assert.ok(rawMime.includes(generatedToken));
  assert.ok(rawMime.includes("15 minutes"));
});

test("staff reset does not send a production link without a public HTTPS frontend URL", async () => {
  for (const [frontendUrl, expectedCode] of [
    ["", "FRONTEND_URL_REQUIRED"],
    ["http://localhost:5173", "FRONTEND_URL_INVALID"]
  ]) {
    const { db, records } = await makeDatabase();
    const loggedCodes = [];
    let deliveryCalls = 0;
    const result = await requestStaffPasswordReset("staff@example.invalid", {
      db,
      env: {
        ...emailEnvironment,
        NODE_ENV: "production",
        FRONTEND_URL: frontendUrl
      },
      now: () => baseTime,
      tokenFactory: () => resetToken,
      deliverEmail: async () => {
        deliveryCalls += 1;
        return { accepted: ["staff@example.invalid"] };
      },
      logger: {
        error: (_message, details) => loggedCodes.push(details.code)
      }
    });

    assert.deepEqual(result, { status: "ACCEPTED" });
    assert.equal(deliveryCalls, 0);
    assert.equal(records.size, 0);
    assert.deepEqual(loggedCodes, [expectedCode]);
  }
});

test("staff reset leaves unknown email responses generic and sends no email", async () => {
  const { db, records } = await makeDatabase({ withUser: false });
  let deliveryCalls = 0;
  const result = await requestStaffPasswordReset("missing@example.invalid", {
    db,
    env: emailEnvironment,
    deliverEmail: async () => {
      deliveryCalls += 1;
      return { accepted: ["missing@example.invalid"] };
    }
  });

  assert.deepEqual(result, { status: "ACCEPTED" });
  assert.equal(deliveryCalls, 0);
  assert.equal(records.size, 0);
});

test("staff reset accepts a valid token once and invalidates prior sessions", async () => {
  const { db, user, records } = await makeDatabase({
    token: {
      userId: "staff-user-1",
      tokenHash: hashStaffPasswordResetToken(resetToken)
    }
  });

  const result = await resetStaffPassword({
    token: resetToken,
    password: newPassword,
    confirmPassword: newPassword
  }, { db, now: () => baseTime });

  assert.deepEqual(result, { status: "RESET" });
  assert.equal(await bcrypt.compare(newPassword, user.password), true);
  assert.equal(user.sessionVersion, 3);
  assert.equal(records.size, 0);
});

test("staff reset rejects invalid and expired tokens without changing the password", async () => {
  const { db, user, records } = await makeDatabase({
    token: {
      userId: "staff-user-1",
      tokenHash: hashStaffPasswordResetToken(resetToken)
    },
    expiresAt: new Date(baseTime.getTime() - 1)
  });
  const originalPassword = user.password;

  const invalid = await resetStaffPassword({
    token: "B".repeat(43),
    password: newPassword,
    confirmPassword: newPassword
  }, { db, now: () => baseTime });
  const expired = await resetStaffPassword({
    token: resetToken,
    password: newPassword,
    confirmPassword: newPassword
  }, { db, now: () => baseTime });

  assert.deepEqual(invalid, { status: "INVALID" });
  assert.deepEqual(expired, { status: "INVALID" });
  assert.equal(user.password, originalPassword);
  assert.equal(records.size, 1);
});

test("staff reset rejects reuse and mismatched passwords", async () => {
  const { db, user } = await makeDatabase({
    token: {
      userId: "staff-user-1",
      tokenHash: hashStaffPasswordResetToken(resetToken)
    }
  });
  const first = await resetStaffPassword({
    token: resetToken,
    password: newPassword,
    confirmPassword: newPassword
  }, { db, now: () => baseTime });
  const second = await resetStaffPassword({
    token: resetToken,
    password: newPassword,
    confirmPassword: newPassword
  }, { db, now: () => baseTime });
  const mismatched = await resetStaffPassword({
    token: resetToken,
    password: newPassword,
    confirmPassword: "Different-Reset-Password-75!"
  }, { db, now: () => baseTime });

  assert.deepEqual(first, { status: "RESET" });
  assert.deepEqual(second, { status: "INVALID" });
  assert.deepEqual(mismatched, { status: "INVALID" });
  assert.equal(user.sessionVersion, 3);
});
