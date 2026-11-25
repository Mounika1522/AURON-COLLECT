import test from "node:test";
import assert from "node:assert/strict";

import {
  formatReminderDateTimeIst,
  getIstDateTimeLocalValue
} from "./reminder-time.js";

test("creates datetime-local defaults using the IST wall clock", () => {
  const value = getIstDateTimeLocalValue(
    new Date("2026-11-21T11:39:00.000Z")
  );

  assert.equal(value, "2026-11-21T17:10");
});

test("formats stored UTC timestamps as IST", () => {
  assert.equal(
    formatReminderDateTimeIst("2026-11-21T11:30:00.000Z"),
    "21/11/2026, 17:00"
  );
});

test("uses IST date when formatting across a UTC day boundary", () => {
  assert.equal(
    formatReminderDateTimeIst("2026-11-21T20:00:00.000Z"),
    "22/11/2026, 01:30"
  );
});
