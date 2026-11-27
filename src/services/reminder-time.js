const getIstDateTimeParts = (date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map(({ type, value }) => [type, value])
  );
};

export const getIstDateTimeLocalValue = (now = new Date()) => {
  const parts = getIstDateTimeParts(new Date(now.getTime() + 60_000));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

export const formatReminderDateTimeIst = (value) => {
  return formatReminderDateTime(value, "Asia/Kolkata");
};

export const formatReminderDateTime = (
  value,
  timeZone = "Asia/Kolkata"
) => {
  if (value === null || value === undefined || value === "") return "-";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
};
