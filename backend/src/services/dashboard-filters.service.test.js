import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPeriodCreditScope,
  buildInvoiceScope,
  DashboardFilterError,
  parseDashboardFilters,
  UNASSIGNED_EXECUTIVE_FILTER,
} from "./dashboard-filters.service.js";
import {
  DashboardAccessError,
  getDashboardDataAccess,
} from "./dashboard-access.service.js";
import {
  calculateDashboardMetrics,
  matchesDashboardInvoice,
} from "./dashboard-metrics.service.js";

const now = new Date("2026-11-21T11:00:00.000Z");
const rangeQuery = {
  from: "2026-11-01",
  to: "2026-11-21",
  executive: "Alex Morgan",
};

const makeInvoice = (overrides = {}) => ({
  id: "invoice-1",
  organisationId: "org-1",
  status: "ISSUED",
  invoiceDate: "2026-11-10T00:00:00.000Z",
  dueDate: "2026-11-01T00:00:00.000Z",
  assignedExecutive: "Alex Morgan",
  total: "100.00",
  currency: "INR",
  allocations: [],
  creditAdjustments: [],
  promises: [],
  ...overrides,
});

test("staff executive filters are fixed to the authenticated assignment", () => {
  const access = getDashboardDataAccess({
    userId: "user-1",
    organisationId: "org-1",
    role: "USER",
    name: "Alex Morgan",
  });
  const filters = parseDashboardFilters(
    { executive: "All" },
    now,
    access,
  );
  assert.equal(filters.executive, "Alex Morgan");
  assert.equal(filters.unassignedExecutive, false);

  assert.throws(
    () =>
      parseDashboardFilters(
        { executive: "Jordan Lee" },
        now,
        access,
      ),
    DashboardAccessError,
  );
  assert.throws(
    () =>
      parseDashboardFilters(
        { executive: UNASSIGNED_EXECUTIVE_FILTER },
        now,
        access,
      ),
    DashboardAccessError,
  );
});

test("parses combined date and executive filters into an organization-scoped invoice query", () => {
  const filters = parseDashboardFilters(rangeQuery, now);
  assert.deepEqual(buildInvoiceScope("org-1", filters), {
    organisationId: "org-1",
    customer: { organisationId: "org-1" },
    status: { notIn: ["DRAFT", "CANCELLED", "WRITTEN_OFF"] },
    invoiceDate: {
      gte: new Date("2026-11-01T00:00:00.000Z"),
      lt: new Date("2026-11-22T00:00:00.000Z"),
    },
    assignedExecutive: "Alex Morgan",
  });

  assert.equal(matchesDashboardInvoice(makeInvoice(), filters, "org-1"), true);
  assert.equal(
    matchesDashboardInvoice(
      makeInvoice({ assignedExecutive: "Jordan Lee" }),
      filters,
      "org-1",
    ),
    false,
  );
  assert.equal(
    matchesDashboardInvoice(
      makeInvoice({ invoiceDate: "2026-10-31T23:59:59.999Z" }),
      filters,
      "org-1",
    ),
    false,
  );
  assert.equal(
    matchesDashboardInvoice(makeInvoice({ organisationId: "org-2" }), filters, "org-1"),
    false,
  );
  assert.deepEqual(
    buildPeriodCreditScope("org-1", filters, {
      fromDate: filters.fromDate,
      toExclusive: filters.toExclusive,
    }),
    {
      organisationId: "org-1",
      status: "APPROVED",
      approvedAt: {
        gte: filters.fromDate,
        lt: filters.toExclusive,
      },
      invoice: {
        organisationId: "org-1",
        customer: { organisationId: "org-1" },
        status: { notIn: ["DRAFT", "CANCELLED", "WRITTEN_OFF"] },
        assignedExecutive: "Alex Morgan",
      },
    },
  );
});

test("supports filtering invoices with no assigned executive", () => {
  const filters = parseDashboardFilters({
    from: "2026-11-01",
    to: "2026-11-21",
    executive: UNASSIGNED_EXECUTIVE_FILTER,
  }, now);

  assert.deepEqual(buildInvoiceScope("org-1", filters).OR, [
    { assignedExecutive: null },
    { assignedExecutive: "" },
  ]);
  assert.equal(
    matchesDashboardInvoice(
      makeInvoice({ assignedExecutive: null }),
      filters,
      "org-1",
    ),
    true,
  );
  assert.equal(matchesDashboardInvoice(makeInvoice(), filters, "org-1"), false);
});

test("rejects incomplete, malformed, impossible, reversed, and future date ranges", () => {
  const invalidQueries = [
    { from: "2026-11-01" },
    { from: "2026/11/01", to: "2026-11-21" },
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-11-22", to: "2026-11-21" },
    { from: "2026-11-01", to: "2026-11-22" },
  ];

  for (const query of invalidQueries) {
    assert.throws(
      () => parseDashboardFilters(query, now),
      DashboardFilterError,
    );
  }
});

test("returns empty filtered summaries without falling back to unfiltered records", () => {
  const filters = parseDashboardFilters(rangeQuery, now);
  const metrics = calculateDashboardMetrics({
    invoices: [
      makeInvoice({
        invoiceDate: "2026-10-01T00:00:00.000Z",
        assignedExecutive: "Alex Morgan",
      }),
      makeInvoice({
        id: "other-executive",
        assignedExecutive: "Jordan Lee",
      }),
    ],
    periodCredits: [],
    filters,
    now,
    organisationId: "org-1",
  });

  assert.equal(metrics.totalInvoices, 0);
  assert.equal(metrics.currencies[0].totalInvoiceAmount, "0.00");
  assert.equal(metrics.currencies[0].collectionsInRange, "0.00");
  assert.deepEqual(metrics.trend, []);
});

test("keeps invoice cohort calculations and receipt-date collections consistent by executive and currency", () => {
  const filters = parseDashboardFilters(rangeQuery, now);
  const allocation = (amount, receiptDate) => ({
    amount,
    status: "POSTED",
    reversedAt: null,
    organisationId: "org-1",
    receipt: {
      status: "POSTED",
      receiptDate,
      organisationId: "org-1",
      currency: "INR",
    },
  });
  const metrics = calculateDashboardMetrics({
    invoices: [
      makeInvoice({
        allocations: [allocation("10.00", "2026-11-20T00:00:00.000Z")],
      }),
      makeInvoice({
        id: "older-invoice",
        invoiceDate: "2026-10-10T00:00:00.000Z",
        allocations: [allocation("20.00", "2026-11-20T00:00:00.000Z")],
      }),
      makeInvoice({
        id: "other-executive",
        assignedExecutive: "Jordan Lee",
        allocations: [allocation("50.00", "2026-11-20T00:00:00.000Z")],
      }),
    ],
    periodCredits: [
      {
        amount: "20.00",
        status: "APPROVED",
        approvedAt: "2026-11-20T00:00:00.000Z",
        organisationId: "org-2",
        invoice: {
          organisationId: "org-2",
          assignedExecutive: "Alex Morgan",
          currency: "INR",
        },
      },
      {
        amount: "30.00",
        status: "APPROVED",
        approvedAt: "2026-11-20T00:00:00.000Z",
        organisationId: "org-1",
        invoice: {
          organisationId: "org-1",
          assignedExecutive: "Jordan Lee",
          currency: "INR",
        },
      },
    ],
    filters,
    now,
    organisationId: "org-1",
  });

  assert.equal(metrics.totalInvoices, 1);
  assert.equal(metrics.currencies[0].netInvoiceAmount, "100.00");
  assert.equal(metrics.currencies[0].netSalesInRange, "100.00");
  assert.equal(metrics.currencies[0].allocatedCollections, "10.00");
  assert.equal(metrics.currencies[0].collectionsInRange, "30.00");
  assert.equal(metrics.trend[0].currency, "INR");
  assert.equal(
    metrics.trend[0].buckets.find((bucket) => bucket.key === "2026-11-20")
      .collected,
    "30.00",
  );
});
