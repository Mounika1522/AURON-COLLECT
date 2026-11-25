import test from "node:test";
import assert from "node:assert/strict";

import {
  parseReminderScheduleTime,
  validateReminderScheduleTime
} from "./reminder-time.service.js";

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
