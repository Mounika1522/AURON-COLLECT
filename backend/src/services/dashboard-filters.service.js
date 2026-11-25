import { DashboardAccessError } from "./dashboard-access.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EXCLUDED_INVOICE_STATUSES = ["DRAFT", "CANCELLED", "WRITTEN_OFF"];

export const UNASSIGNED_EXECUTIVE_FILTER = "__UNASSIGNED__";

const parseISODate = (value) => {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? parsed : null;
};

export class DashboardFilterError extends Error {
  constructor(message) {
    super(message);
    this.name = "DashboardFilterError";
    this.statusCode = 400;
  }
}

export const parseDashboardFilters = (
  query = {},
  now = new Date(),
  access = null,
) => {
  const hasFrom = query.from !== undefined;
  const hasTo = query.to !== undefined;
  if (hasFrom !== hasTo) {
    throw new DashboardFilterError("Both from and to dates are required.");
  }

  let fromDate = null;
  let toDate = null;
  let toExclusive = null;
  let rangeDays = null;

  if (hasFrom) {
    fromDate = parseISODate(query.from);
    toDate = parseISODate(query.to);
    if (!fromDate || !toDate) {
      throw new DashboardFilterError(
        "Dates must be valid calendar dates in YYYY-MM-DD format.",
      );
    }
    if (fromDate > toDate) {
      throw new DashboardFilterError("The from date must not be after the to date.");
    }
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    if (toDate > today) {
      throw new DashboardFilterError("The to date must not be in the future.");
    }

    toExclusive = new Date(toDate.getTime() + DAY_MS);
    rangeDays = Math.floor((toExclusive - fromDate) / DAY_MS);
  }

  let executive = null;
  let unassignedExecutive = false;
  if (query.executive !== undefined && query.executive !== "") {
    if (typeof query.executive !== "string" || query.executive.length > 120) {
      throw new DashboardFilterError("Invalid executive filter.");
    }
    if (query.executive !== "All") {
      unassignedExecutive =
        query.executive === UNASSIGNED_EXECUTIVE_FILTER;
      executive = unassignedExecutive ? null : query.executive.trim();
      if (!unassignedExecutive && !executive) {
        throw new DashboardFilterError("Invalid executive filter.");
      }
    }
  }

  if (access?.assignedExecutive) {
    if (
      query.executive !== undefined &&
      query.executive !== "" &&
      query.executive !== "All" &&
      query.executive !== access.assignedExecutive
    ) {
      throw new DashboardAccessError();
    }
    executive = access.assignedExecutive;
    unassignedExecutive = false;
  }

  return {
    fromDate,
    toDate,
    toExclusive,
    rangeDays,
    executive,
    unassignedExecutive,
  };
};

export const buildInvoiceOwnerScope = (organisationId, filters) => {
  const where = {
    organisationId,
    customer: { organisationId },
    status: {
      notIn: EXCLUDED_INVOICE_STATUSES,
    },
  };

  if (filters.unassignedExecutive) {
    where.OR = [{ assignedExecutive: null }, { assignedExecutive: "" }];
  } else if (filters.executive) {
    where.assignedExecutive = filters.executive;
  }

  return where;
};

export const buildInvoiceScope = (organisationId, filters) => {
  const where = buildInvoiceOwnerScope(organisationId, filters);
  if (filters.fromDate) {
    where.invoiceDate = {
      gte: filters.fromDate,
      lt: filters.toExclusive,
    };
  }
  return where;
};

export const getDashboardPeriod = (filters, now = new Date()) => {
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const toExclusive = filters.toExclusive || new Date(todayStart.getTime() + DAY_MS);
  const fromDate =
    filters.fromDate ||
    new Date(toExclusive.getTime() - 90 * DAY_MS);
  const rangeDays = filters.rangeDays || 90;

  return { fromDate, toExclusive, rangeDays };
};

export const buildPeriodCreditScope = (
  organisationId,
  filters,
  period,
) => {
  const invoiceFilter = {
    organisationId,
    customer: { organisationId },
    status: {
      notIn: EXCLUDED_INVOICE_STATUSES,
    },
  };

  if (filters.unassignedExecutive) {
    invoiceFilter.OR = [
      { assignedExecutive: null },
      { assignedExecutive: "" },
    ];
  } else if (filters.executive) {
    invoiceFilter.assignedExecutive = filters.executive;
  }

  return {
    organisationId,
    status: "APPROVED",
    approvedAt: {
      gte: period.fromDate,
      lt: period.toExclusive,
    },
    invoice: invoiceFilter,
  };
};
