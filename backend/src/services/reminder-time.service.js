const DEFAULT_TIME_ZONE = "Asia/Kolkata";
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

export const isValidIanaTimeZone = (timeZone) => {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const getZonedParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map(({ type, value }) => [type, Number(value)])
  );
};

export const localDateTimeToUtc = (parts, timeZone = DEFAULT_TIME_ZONE) => {
  if (
    !isValidIanaTimeZone(timeZone) ||
    !isValidDateTimeParts(
      parts.year,
      parts.month,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second || 0
    )
  ) {
    return null;
  }

  const milliseconds = Number(parts.millisecond || 0);
  const targetWallTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0,
    milliseconds
  );
  let timestamp = targetWallTime;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const observed = getZonedParts(new Date(timestamp), timeZone);
    const observedWallTime = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
      milliseconds
    );
    const adjustment = targetWallTime - observedWallTime;
    if (adjustment === 0) return new Date(timestamp);
    timestamp += adjustment;
  }

  return null;
};

export const parseReminderScheduleTime = (
  value,
  timeZone = DEFAULT_TIME_ZONE
) => {
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

  return localDateTimeToUtc(
    { year, month, day, hour, minute, second, millisecond: milliseconds },
    timeZone
  );
};

export const validateReminderScheduleTime = (
  value,
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE
) => {
  const scheduledFor = parseReminderScheduleTime(value, timeZone);
  if (!scheduledFor) return { error: "INVALID_DATE" };

  if (scheduledFor.getTime() <= now.getTime()) {
    return { error: "PAST_DATE" };
  }

  return { scheduledFor };
};
