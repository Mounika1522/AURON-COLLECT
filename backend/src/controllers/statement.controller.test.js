import assert from "node:assert/strict";
import test from "node:test";
import prisma from "../config/prisma.js";
import { generateCustomerStatement } from "./statement.controller.js";

const customer = {
  id: "customer-1",
  customerCode: "C-001",
  name: "Multi Currency Customer",
  email: "customer@example.test",
  phone: null,
  billingAddress: null,
};

const makeAllocation = (amount, receiptDate, receiptNumber) => ({
  amount,
  receipt: {
    receiptDate: new Date(receiptDate),
    receiptNumber,
  },
});

const makeAdjustment = (amount, approvedAt, adjustmentNumber) => ({
  amount,
  approvedAt: new Date(approvedAt),
  adjustmentNumber,
  reason: "Test adjustment",
});

const makeInvoice = ({
  invoiceNumber,
  currency,
  invoiceDate,
  dueDate,
  total,
  allocations = [],
  creditAdjustments = [],
}) => ({
  id: invoiceNumber,
  invoiceNumber,
  currency,
  invoiceDate: new Date(invoiceDate),
  dueDate: new Date(dueDate),
  total,
  allocations,
  creditAdjustments,
});

const generateStatement = async (invoices) => {
  const originalCustomerFindFirst = prisma.customer.findFirst;
  const originalInvoiceFindMany = prisma.invoice.findMany;
  prisma.customer.findFirst = async () => customer;
  prisma.invoice.findMany = async () => invoices;

  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  try {
    await generateCustomerStatement(
      {
        dashboardAccess: { organisationId: "org-1" },
        params: { customerId: customer.id },
        query: { fromDate: "2026-02-01", toDate: "2026-02-28" },
      },
      response,
    );
    assert.equal(response.statusCode, 200);
    return response.body.statement;
  } finally {
    prisma.customer.findFirst = originalCustomerFindFirst;
    prisma.invoice.findMany = originalInvoiceFindMany;
  }
};

test("customer statement keeps balances and ageing separate by currency", async () => {
  const statement = await generateStatement([
    makeInvoice({
      invoiceNumber: "INR-OPEN",
      currency: "INR",
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      total: "100.00",
      allocations: [
        makeAllocation("20.00", "2026-01-20", "INR-PREVIOUS"),
        makeAllocation("10.00", "2026-02-02", "INR-CURRENT"),
      ],
      creditAdjustments: [
        makeAdjustment("5.00", "2026-01-25", "INR-CREDIT-PREVIOUS"),
        makeAdjustment("2.00", "2026-02-03", "INR-CREDIT-CURRENT"),
      ],
    }),
    makeInvoice({
      invoiceNumber: "INR-CURRENT",
      currency: "INR",
      invoiceDate: "2026-02-01",
      dueDate: "2026-03-01",
      total: "50.00",
    }),
    makeInvoice({
      invoiceNumber: "USD-OPEN",
      currency: "USD",
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-31",
      total: "200.00",
      allocations: [
        makeAllocation("30.00", "2026-01-20", "USD-PREVIOUS"),
        makeAllocation("20.00", "2026-02-02", "USD-CURRENT"),
      ],
      creditAdjustments: [
        makeAdjustment("10.00", "2026-01-25", "USD-CREDIT-PREVIOUS"),
        makeAdjustment("5.00", "2026-02-03", "USD-CREDIT-CURRENT"),
      ],
    }),
    makeInvoice({
      invoiceNumber: "USD-CURRENT",
      currency: "USD",
      invoiceDate: "2026-02-01",
      dueDate: "2026-03-01",
      total: "60.00",
    }),
  ]);

  assert.deepEqual(statement.summary, {
    currency: null,
    openingBalance: null,
    totalInvoices: null,
    totalReceipts: null,
    adjustments: null,
    closingOutstanding: null,
  });
  assert.deepEqual(statement.currencySummaries.INR, {
    openingBalance: 75,
    totalInvoices: 50,
    totalReceipts: 10,
    adjustments: 2,
    closingOutstanding: 113,
    ageing: {
      notYetDue: 50,
      days1To30: 63,
      days31To60: 0,
      days61To90: 0,
      above90Days: 0,
    },
  });
  assert.deepEqual(statement.currencySummaries.USD, {
    openingBalance: 160,
    totalInvoices: 60,
    totalReceipts: 20,
    adjustments: 5,
    closingOutstanding: 195,
    ageing: {
      notYetDue: 60,
      days1To30: 135,
      days31To60: 0,
      days61To90: 0,
      above90Days: 0,
    },
  });
  assert.deepEqual(statement.ageing, {
    notYetDue: null,
    days1To30: null,
    days31To60: null,
    days61To90: null,
    above90Days: null,
  });

  const balancesByCurrency = statement.transactions.reduce(
    (balances, transaction) => {
      if (!balances[transaction.currency]) {
        balances[transaction.currency] = [];
      }
      balances[transaction.currency].push(transaction);
      return balances;
    },
    {},
  );
  assert.deepEqual(
    balancesByCurrency.INR.map(({ balance }) => balance),
    [125, 115, 113],
  );
  assert.deepEqual(
    balancesByCurrency.USD.map(({ balance }) => balance),
    [220, 200, 195],
  );
});

test("single-currency statement preserves its scalar summary", async () => {
  const statement = await generateStatement([
    makeInvoice({
      invoiceNumber: "INR-OPEN",
      currency: "INR",
      invoiceDate: "2026-01-01",
      dueDate: "2026-03-01",
      total: "100.00",
    }),
  ]);

  assert.deepEqual(statement.summary, {
    currency: "INR",
    openingBalance: 100,
    totalInvoices: 0,
    totalReceipts: 0,
    adjustments: 0,
    closingOutstanding: 100,
  });
  assert.equal(statement.ageing.notYetDue, 100);
});
