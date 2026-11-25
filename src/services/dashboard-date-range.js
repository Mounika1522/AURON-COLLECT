const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const utcDate = (year, month, day) =>
  new Date(Date.UTC(year, month, day));

const toDateString = (date) => date.toISOString().slice(0, 10);

const parseDate = (value) => {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || toDateString(date) !== value) return null;
  return date;
};

export const resolveDashboardDateRange = (
  preset,
  customFrom,
  customTo,
  now = new Date(),
) => {
  const today = utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let from;
  let to = today;
  let label;

  switch (preset) {
    case 'Today':
      from = today;
      label = 'Today';
      break;
    case 'This Week': {
      const daysSinceMonday = (today.getUTCDay() + 6) % 7;
      from = new Date(today.getTime() - daysSinceMonday * DAY_MS);
      label = 'This Week';
      break;
    }
    case 'This Month':
      from = utcDate(today.getUTCFullYear(), today.getUTCMonth(), 1);
      label = 'This Month';
      break;
    case 'Last Month':
      from = utcDate(today.getUTCFullYear(), today.getUTCMonth() - 1, 1);
      to = utcDate(today.getUTCFullYear(), today.getUTCMonth(), 0);
      label = 'Last Month';
      break;
    case 'This Quarter': {
      const quarterStartMonth = Math.floor(today.getUTCMonth() / 3) * 3;
      from = utcDate(today.getUTCFullYear(), quarterStartMonth, 1);
      label = 'This Quarter';
      break;
    }
    case 'Custom Range': {
      from = parseDate(customFrom);
      to = parseDate(customTo);
      label = 'Custom Range';
      if (!from || !to) {
        return { from: null, to: null, label, error: 'Enter valid start and end dates.' };
      }
      if (from > to) {
        return { from: null, to: null, label, error: 'The start date must not be after the end date.' };
      }
      if (to > today) {
        return { from: null, to: null, label, error: 'The end date cannot be in the future.' };
      }
      break;
    }
    default:
      return { from: null, to: null, label: '', error: 'Select a valid date range.' };
  }

  return {
    from: toDateString(from),
    to: toDateString(to),
    label,
    error: null,
  };
};
