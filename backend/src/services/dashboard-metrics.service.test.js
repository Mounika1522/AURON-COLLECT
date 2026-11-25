import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAgeingSummary,
  calculateDashboardMetrics,
} from "./dashboard-metrics.service.js";

const now = new Date("2026-11-21T11:00:00.000Z");

const invoice = (overrides = {}) => ({
  id: "invoice-1",
  organisationId: "org-1",
  invoiceNumber: "INV-1",
  invoiceDate: "2026-11-01T00:00:00.000Z",
  dueDate: "2026-11-01T00:00:00.000Z",
  total: "100.00",
  currency: "INR",
  status: "ISSUED",
  allocations: [],
  creditAdjustments: [],
  promises: [],
  ...overrides,
});

const allocation = ({
  amount,
  status = "POSTED",
  receiptStatus = "POSTED",
  receiptDate = "2026-11-10T00:00:00.000Z",
  reversedAt = null,
  organisationId = "org-1",
  receiptOrganisationId = "org-1",
  receiptCurrency = "INR",
}) => ({
  amount,
  status,
  reversedAt,
  organisationId,
  receipt: {
    status: receiptStatus,
    receiptDate,
    organisationId: receiptOrganisationId,
    currency: receiptCurrency,
  },
});

test("calculates collection rate and outstanding from net billings and valid posted allocations", () => {
  const metrics = calculateDashboardMetrics({
    now,
    invoices: [
      invoice({
        allocations: [
          allocation({ amount: "30.00" }),
          allocation({ amount: "20.00", reversedAt: "2026-11-15T00:00:00.000Z" }),
          allocation({ amount: "10.00", status: "REVERSED" }),
          allocation({ amount: "5.00", receiptStatus: "FAILED" }),
        ],
        creditAdjustments: [
          { amount: "20.00", status: "APPROVED", approvedAt: "2026-11-12T00:00:00.000Z" },
          { amount: "10.00", status: "PENDING", approvedAt: null },
        ],
      }),
      invoice({ id: "invoice-cancelled", status: "CANCELLED" }),
    ],
    receipts: [],
  });

  assert.equal(metrics.currencies.length, 1);
  assert.equal(metrics.currencies[0].netInvoiceAmount, "80.00");
  assert.equal(metrics.currencies[0].allocatedCollections, "30.00");
  assert.equal(metrics.currencies[0].totalOutstanding, "50.00");
  assert.equal(metrics.currencies[0].collectionRate, 37.5);
  assert.equal(metrics.currencies[0].overdueAmount, "50.00");
});

test("keeps invoice, receipt and collection metrics separate by currency", () => {
  const metrics = calculateDashboardMetrics({
    now,
    invoices: [
      invoice({
        total: "100.00",
        currency: "INR",
        allocations: [allocation({ amount: "10.00" })],
      }),
      invoice({
        id: "invoice-usd",
        total: "25.00",
        currency: "USD",
        allocations: [
          allocation({ amount: "15.00", receiptCurrency: "USD" }),
        ],
      }),
    ],
  });

  assert.deepEqual(
    metrics.currencies.map(({ currency, totalOutstanding, collectionsInRange }) => ({
      currency,
      totalOutstanding,
      collectionsInRange,
    })),
    [
      { currency: "INR", totalOutstanding: "90.00", collectionsInRange: "10.00" },
      { currency: "USD", totalOutstanding: "10.00", collectionsInRange: "15.00" },
    ],
  );
  assert.equal(metrics.legacy.totalOutstanding, null);
});

test("ignores invoice, allocation and receipt records outside the authenticated organisation", () => {
  const metrics = calculateDashboardMetrics({
    now,
    organisationId: "org-1",
    invoices: [
      invoice({
        allocations: [
          allocation({
            amount: "20.00",
            organisationId: "org-2",
            receiptOrganisationId: "org-2",
          }),
          allocation({
            amount: "15.00",
            receiptCurrency: "USD",
          }),
        ],
      }),
      invoice({ id: "foreign-invoice", organisationId: "org-2", total: "900.00" }),
    ],
  });

  assert.equal(metrics.totalInvoices, 1);
  assert.equal(metrics.currencies[0].allocatedCollections, "0.00");
  assert.equal(metrics.currencies[0].totalCollections, "0.00");
  assert.equal(metrics.currencies[0].totalOutstanding, "100.00");
});

test("uses selected-range net sales for DSO and returns N/A when history is insufficient", () => {
  const metrics = calculateDashboardMetrics({
    now,
    invoices: [
      invoice({
        total: "200.00",
        allocations: [allocation({ amount: "50.00" })],
        creditAdjustments: [
          { amount: "20.00", status: "APPROVED", approvedAt: "2026-11-12T00:00:00.000Z" },
        ],
      }),
      invoice({
        id: "invoice-old",
        invoiceDate: "2026-08-01T00:00:00.000Z",
        total: "500.00",
      }),
    ],
    periodCredits: [
      {
        amount: "20.00",
        status: "APPROVED",
        approvedAt: "2026-11-12T00:00:00.000Z",
        organisationId: "org-1",
        invoice: {
          organisationId: "org-1",
          assignedExecutive: null,
          currency: "INR",
        },
      },
    ],
  });

  assert.equal(metrics.currencies[0].netSalesInRange, "180.00");
  assert.equal(metrics.currencies[0].dsoDays, 315);

  const noHistory = calculateDashboardMetrics({
    now,
    invoices: [
      invoice({
        invoiceDate: "2026-08-01T00:00:00.000Z",
        creditAdjustments: [
          { amount: "10.00", status: "APPROVED", approvedAt: null },
        ],
      }),
    ],
  });
  assert.equal(noHistory.currencies[0].dsoDays, null);
});

test("returns N/A for collection rate and DSO when approved credits leave no positive billing base", () => {
  const metrics = calculateDashboardMetrics({
    now,
    invoices: [
      invoice({
        creditAdjustments: [
          { amount: "120.00", status: "APPROVED", approvedAt: "2026-11-12T00:00:00.000Z" },
        ],
      }),
    ],
    periodCredits: [
      {
        amount: "120.00",
        status: "APPROVED",
        approvedAt: "2026-11-12T00:00:00.000Z",
        organisationId: "org-1",
        invoice: {
          organisationId: "org-1",
          assignedExecutive: null,
          currency: "INR",
        },
      },
    ],
  });

  assert.equal(metrics.currencies[0].netInvoiceAmount, "0.00");
  assert.equal(metrics.currencies[0].totalOutstanding, "0.00");
  assert.equal(metrics.currencies[0].collectionRate, null);
  assert.equal(metrics.currencies[0].dsoDays, null);
});

test("PTP expected amounts exclude reversed allocations and are capped by approved-credit-adjusted balance", () => {
  const metrics = calculateDashboardMetrics({
    now,
    invoices: [
      invoice({
        total: "100.00",
        allocations: [
          allocation({
            amount: "20.00",
            receiptDate: "2026-11-20T00:00:00.000Z",
          }),
          allocation({
            amount: "30.00",
            reversedAt: "2026-11-20T00:00:00.000Z",
          }),
        ],
        creditAdjustments: [
          { amount: "60.00", status: "APPROVED", approvedAt: "2026-11-19T00:00:00.000Z" },
        ],
        promises: [
          {
            organisationId: "org-1",
            promisedAmount: "70.00",
            promisedDate: "2026-11-20T00:00:00.000Z",
            createdAt: "2026-11-19T00:00:00.000Z",
            status: "PROMISED",
          },
        ],
      }),
    ],
  });

  assert.equal(metrics.currencies[0].allocatedCollections, "20.00");
  assert.equal(metrics.currencies[0].totalOutstanding, "20.00");
  assert.equal(metrics.currencies[0].expectedPromiseAmount, "20.00");
});

test("ageing buckets are currency-scoped and exclude invalid allocations", () => {
  const result = calculateAgeingSummary({
    now,
    invoices: [
      invoice({
        total: "100.00",
        allocations: [
          allocation({ amount: "100.00", reversedAt: "2026-11-20T00:00:00.000Z" }),
        ],
      }),
      invoice({
        id: "invoice-usd",
        total: "50.00",
        currency: "USD",
        allocations: [allocation({ amount: "10.00" })],
      }),
    ],
  });

  assert.equal(result.currencySummaries.length, 2);
  assert.deepEqual(
    result.currencySummaries.map(({ currency, totalOutstanding }) => ({
      currency,
      totalOutstanding,
    })),
    [
      { currency: "INR", totalOutstanding: "100.00" },
      { currency: "USD", totalOutstanding: "40.00" },
    ],
  );
  assert.equal(result.currencySummaries[1].summary.days1to30.amount, "40.00");
  assert.equal(result.invoices[0].currency, "INR");
});
