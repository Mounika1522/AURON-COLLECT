const IST_OFFSET_MINUTES = 5 * 60 + 30;
const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/i;

const isValidDateTimeParts = (year, month, day, hour, minute, second) => {
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
};

export const parseReminderScheduleTime = (value) => {
  if (typeof value !== "string") return null;

  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) return null;

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText = "0",
    fractionText = "",
    timezone = ""
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (!isValidDateTimeParts(year, month, day, hour, minute, second)) {
    return null;
  }

  const milliseconds = Number(fractionText.padEnd(3, "0") || 0);
  if (timezone && timezone.toUpperCase() !== "Z") {
    const offsetMatch = /^([+-])(\d{2}):(\d{2})$/.exec(timezone);
    if (!offsetMatch) return null;

    const offsetHours = Number(offsetMatch[2]);
    const offsetMinutes = Number(offsetMatch[3]);
    if (
      offsetHours > 14 ||
      offsetMinutes > 59 ||
      (offsetHours === 14 && offsetMinutes !== 0)
    ) {
      return null;
    }

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
  }

  const localWallTimeAsUtc = new Date(0);
  localWallTimeAsUtc.setUTCFullYear(year, month - 1, day);
  localWallTimeAsUtc.setUTCHours(hour, minute, second, milliseconds);

  return new Date(
    localWallTimeAsUtc.getTime() - IST_OFFSET_MINUTES * 60_000
  );
};

export const validateReminderScheduleTime = (value, now = new Date()) => {
  const scheduledFor = parseReminderScheduleTime(value);
  if (!scheduledFor) return { error: "INVALID_DATE" };

  if (scheduledFor.getTime() <= now.getTime()) {
    return { error: "PAST_DATE" };
  }

  return { scheduledFor };
};
