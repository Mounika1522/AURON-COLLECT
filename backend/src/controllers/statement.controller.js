
import prisma from "../config/prisma.js";
import { Prisma } from "@prisma/client";
import {
  loadBrandedOrganisationName,
  renderBrandedPdf
} from "../services/branded-pdf.service.js";
import {
  buildCreditAdjustmentDataWhere,
  buildCustomerDataWhere,
  buildInvoiceDataWhere,
  buildReceiptAllocationDataWhere,
} from "../services/dashboard-access.service.js";

// Decimal helpers for accurate financial calculations
const decimal = (value) => new Prisma.Decimal(value ?? 0);

const money = (value) => decimal(value).toNumber();

const maxZero = (value) => {
  return value.lessThan(0) ? decimal(0) : value;
};

const formatMoney = (value) => decimal(value).toFixed(2);
const formatCurrency = (value, currency) => {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(Number(value));
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${currency} ${formatMoney(value)}`;
  }
};

// Parse and validate dates
const parseDate = (value, endOfDay = false) => {
  if (!value || typeof value !== "string") return null;

  const dateText = value.trim();
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const date = new Date(Date.UTC(
      year,
      month - 1,
      day,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    ));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) return null;

    return date;
  }

  const date = new Date(dateText);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Build customer statement data
const buildStatement = async (req) => {
  const access = req.dashboardAccess;
  const { customerId } = req.params;
  const { fromDate, toDate } = req.query;

  if (!fromDate || !toDate) {
    const error = new Error("fromDate and toDate are required");
    error.statusCode = 400;
    throw error;
  }

  if (
    typeof fromDate !== "string" ||
    typeof toDate !== "string"
  ) {
    const error = new Error("Invalid date parameters");
    error.statusCode = 400;
    throw error;
  }

  const startDate = parseDate(fromDate);
  const endDate = parseDate(toDate, true);

  if (!startDate || !endDate || startDate > endDate) {
    const error = new Error("Please provide a valid date range");
    error.statusCode = 400;
    throw error;
  }

  // Verify customer belongs to organisation
  const customer = await prisma.customer.findFirst({
    where: buildCustomerDataWhere(access, { id: customerId })
  });

  if (!customer) {
    const error = new Error("Customer not found");
    error.statusCode = 404;
    throw error;
  }

  // Fetch invoices, posted allocations and approved adjustments
  const invoices = await prisma.invoice.findMany({
    where: buildInvoiceDataWhere(access, {
      customerId,
      invoiceDate: {
        lte: endDate
      },
      status: {
        notIn: ["DRAFT", "CANCELLED", "WRITTEN_OFF"]
      }
    }),
    include: {
      allocations: {
        where: buildReceiptAllocationDataWhere(access, {
          status: "POSTED",
          reversedAt: null,
          receipt: {
            status: "POSTED",
            receiptDate: {
              lte: endDate
            }
          }
        }),
        include: {
          receipt: true
        }
      },
      creditAdjustments: {
        where: buildCreditAdjustmentDataWhere(access, {
          status: "APPROVED",
          approvedAt: {
            lte: endDate
          }
        })
      }
    },
    orderBy: {
      invoiceDate: "asc"
    }
  });

  let openingBalance = decimal(0);
  let periodInvoices = decimal(0);
  let periodReceipts = decimal(0);
  let periodAdjustments = decimal(0);

  const transactions = [];
  const balancesByCurrency = new Map();
  const getCurrencyBalance = (currency) => {
    if (!balancesByCurrency.has(currency)) {
      balancesByCurrency.set(currency, {
        openingBalance: decimal(0),
        totalInvoices: decimal(0),
        totalReceipts: decimal(0),
        adjustments: decimal(0)
      });
    }
    return balancesByCurrency.get(currency);
  };

  const ageing = {
    notYetDue: decimal(0),
    days1To30: decimal(0),
    days31To60: decimal(0),
    days61To90: decimal(0),
    above90Days: decimal(0)
  };

  // Process each invoice
  for (const invoice of invoices) {
    const currency = String(invoice.currency || "INR").trim().toUpperCase();
    const currencyBalance = getCurrencyBalance(currency);
    const invoiceAmount = decimal(invoice.total);
    const allocations = invoice.allocations || [];
    const adjustments = invoice.creditAdjustments || [];

    // Allocations before selected period
    const allocatedBeforePeriod = allocations
      .filter((allocation) => {
        return allocation.receipt.receiptDate < startDate;
      })
      .reduce((sum, allocation) => {
        return sum.plus(allocation.amount);
      }, decimal(0));

    // Allocations during selected period
    const allocatedDuringPeriod = allocations
      .filter((allocation) => {
        const date = allocation.receipt.receiptDate;
        return date >= startDate && date <= endDate;
      })
      .reduce((sum, allocation) => {
        return sum.plus(allocation.amount);
      }, decimal(0));

    // Adjustments before selected period
    const adjustmentsBeforePeriod = adjustments
      .filter((adjustment) => {
        return adjustment.approvedAt &&
          adjustment.approvedAt < startDate;
      })
      .reduce((sum, adjustment) => {
        return sum.plus(adjustment.amount);
      }, decimal(0));

    // Adjustments during selected period
    const adjustmentsDuringPeriod = adjustments
      .filter((adjustment) => {
        const date = adjustment.approvedAt;
        return date && date >= startDate && date <= endDate;
      })
      .reduce((sum, adjustment) => {
        return sum.plus(adjustment.amount);
      }, decimal(0));

    const totalAllocated = allocatedBeforePeriod
      .plus(allocatedDuringPeriod);

    const totalAdjustments = adjustmentsBeforePeriod
      .plus(adjustmentsDuringPeriod);

    // Invoice outstanding as of selected end date
    const invoiceOutstanding = maxZero(
      invoiceAmount
        .minus(totalAllocated)
        .minus(totalAdjustments)
    );

    // Opening balance for invoices issued before period
    if (invoice.invoiceDate < startDate) {
      const invoiceOpeningBalance = maxZero(
        invoiceAmount
          .minus(allocatedBeforePeriod)
          .minus(adjustmentsBeforePeriod)
      );
      openingBalance = openingBalance.plus(invoiceOpeningBalance);
      currencyBalance.openingBalance = currencyBalance.openingBalance.plus(invoiceOpeningBalance);
    }

    // Invoice issued during selected period
    if (
      invoice.invoiceDate >= startDate &&
      invoice.invoiceDate <= endDate
    ) {
      periodInvoices = periodInvoices.plus(invoiceAmount);
      currencyBalance.totalInvoices = currencyBalance.totalInvoices.plus(invoiceAmount);

      transactions.push({
        date: invoice.invoiceDate,
        currency,
        type: "INVOICE",
        reference: invoice.invoiceNumber,
        description: "Invoice issued",
        debit: invoiceAmount,
        credit: decimal(0)
      });
    }

    // Receipts allocated during selected period
    for (const allocation of allocations) {
      const receiptDate = allocation.receipt.receiptDate;

      if (
        receiptDate >= startDate &&
        receiptDate <= endDate
      ) {
        const allocationAmount = decimal(allocation.amount);

        periodReceipts = periodReceipts.plus(allocationAmount);
        currencyBalance.totalReceipts = currencyBalance.totalReceipts.plus(allocationAmount);

        transactions.push({
          date: receiptDate,
          currency,
          type: "RECEIPT",
          reference: allocation.receipt.receiptNumber,
          description: `Payment allocated to ${invoice.invoiceNumber}`,
          debit: decimal(0),
          credit: allocationAmount
        });
      }
    }

    // Approved credit adjustments during selected period
    for (const adjustment of adjustments) {
      const approvalDate = adjustment.approvedAt;

      if (
        approvalDate &&
        approvalDate >= startDate &&
        approvalDate <= endDate
      ) {
        const adjustmentAmount = decimal(adjustment.amount);

        periodAdjustments = periodAdjustments.plus(
          adjustmentAmount
        );
        currencyBalance.adjustments = currencyBalance.adjustments.plus(adjustmentAmount);

        transactions.push({
          date: approvalDate,
          currency,
          type: "ADJUSTMENT",
          reference: adjustment.adjustmentNumber,
          description: `Approved credit adjustment for ${invoice.invoiceNumber}: ${adjustment.reason}`,
          debit: decimal(0),
          credit: adjustmentAmount
        });
      }
    }

    // Ageing calculation as of selected end date
    if (invoiceOutstanding.greaterThan(0)) {
      const overdueDays = Math.max(
        0,
        Math.floor(
          (endDate.getTime() - invoice.dueDate.getTime()) /
            86400000
        )
      );

      if (invoice.dueDate > endDate) {
        ageing.notYetDue = ageing.notYetDue.plus(
          invoiceOutstanding
        );
      } else if (overdueDays <= 30) {
        ageing.days1To30 = ageing.days1To30.plus(
          invoiceOutstanding
        );
      } else if (overdueDays <= 60) {
        ageing.days31To60 = ageing.days31To60.plus(
          invoiceOutstanding
        );
      } else if (overdueDays <= 90) {
        ageing.days61To90 = ageing.days61To90.plus(
          invoiceOutstanding
        );
      } else {
        ageing.above90Days = ageing.above90Days.plus(
          invoiceOutstanding
        );
      }
    }
  }

  // Closing outstanding = Opening + Invoices - Receipts - Adjustments
  const closingOutstanding = maxZero(
    openingBalance
      .plus(periodInvoices)
      .minus(periodReceipts)
      .minus(periodAdjustments)
  );

  // Sort transactions by date
  transactions.sort((a, b) => {
    const difference =
      new Date(a.date).getTime() -
      new Date(b.date).getTime();

    if (difference !== 0) return difference;

    const order = {
      INVOICE: 1,
      RECEIPT: 2,
      ADJUSTMENT: 3
    };

    if (order[a.type] !== order[b.type]) {
      return order[a.type] - order[b.type];
    }

    return a.reference.localeCompare(b.reference);
  });

  // Calculate running balance
  const runningBalancesByCurrency = new Map(
    [...balancesByCurrency].map(([currency, values]) => [
      currency,
      values.openingBalance
    ])
  );

  const statementTransactions = transactions.map((transaction) => {
    const currencyBalance = (runningBalancesByCurrency.get(transaction.currency) || decimal(0))
      .plus(transaction.debit)
      .minus(transaction.credit);
    runningBalancesByCurrency.set(transaction.currency, currencyBalance);

    return {
      date: transaction.date,
      currency: transaction.currency,
      type: transaction.type,
      reference: transaction.reference,
      description: transaction.description,
      debit: money(transaction.debit),
      credit: money(transaction.credit),
      balance: money(currencyBalance)
    };
  });

  return {
    customer: {
      id: customer.id,
      customerCode: customer.customerCode,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      billingAddress: customer.billingAddress
    },

    period: {
      fromDate: startDate,
      toDate: endDate
    },

    summary: {
      openingBalance: money(openingBalance),
      totalInvoices: money(periodInvoices),
      totalReceipts: money(periodReceipts),
      adjustments: money(periodAdjustments),
      closingOutstanding: money(closingOutstanding)
    },

    currencySummaries: Object.fromEntries(
      [...balancesByCurrency].map(([currency, values]) => [
        currency,
        {
          openingBalance: money(values.openingBalance),
          totalInvoices: money(values.totalInvoices),
          totalReceipts: money(values.totalReceipts),
          adjustments: money(values.adjustments),
          closingOutstanding: money(maxZero(
            values.openingBalance
              .plus(values.totalInvoices)
              .minus(values.totalReceipts)
              .minus(values.adjustments)
          ))
        }
      ])
    ),

    transactions: statementTransactions,

    ageing: Object.fromEntries(
      Object.entries(ageing).map(([key, value]) => [
        key,
        money(value)
      ])
    )
  };
};

// GET CUSTOMER STATEMENT
export const generateCustomerStatement = async (req, res) => {
  try {
    const statement = await buildStatement(req);

    return res.status(200).json({
      success: true,
      message: "Customer statement generated successfully",
      statement
    });
  } catch (error) {
    console.error("Customer statement error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to generate customer statement"
    });
  }
};

// DOWNLOAD CUSTOMER STATEMENT AS PDF
export const downloadCustomerStatementPdf = async (req, res) => {
  try {
    const statement = await buildStatement(req);
    const safeName = statement.customer.name
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase() || "customer";
    const currencySummaries = Object.entries(statement.currencySummaries);
    const period = `${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(statement.period.fromDate)} to ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(statement.period.toDate)}`;
    const organisationName = await loadBrandedOrganisationName(req.dashboardAccess.organisationId);
    const pdf = await renderBrandedPdf({
      organisationName,
      title: "Customer Statement",
      period,
      customer: {
        id: statement.customer.id,
        code: statement.customer.customerCode,
        name: statement.customer.name,
        email: statement.customer.email,
        phone: statement.customer.phone
      },
      summary: currencySummaries.length
        ? currencySummaries.flatMap(([currency, values]) => [
            { label: `${currency} opening balance`, value: formatCurrency(values.openingBalance, currency) },
            { label: `${currency} invoices`, value: formatCurrency(values.totalInvoices, currency) },
            { label: `${currency} receipts`, value: formatCurrency(values.totalReceipts, currency) },
            { label: `${currency} credit adjustments`, value: formatCurrency(values.adjustments, currency) },
            { label: `${currency} closing outstanding`, value: formatCurrency(values.closingOutstanding, currency) }
          ])
        : [{ label: "Closing outstanding", value: "No balance due" }],
      columns: [
        { key: "date", label: "Date", weight: 0.9 },
        { key: "reference", label: "Transaction ID", weight: 1.25 },
        { key: "description", label: "Description", weight: 2.8 },
        { key: "debit", label: "Debit", weight: 1, align: "right" },
        { key: "credit", label: "Credit", weight: 1, align: "right" },
        { key: "balance", label: "Balance", weight: 1.15, align: "right" }
      ],
      rows: statement.transactions.map((transaction) => ({
        date: new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(transaction.date),
        reference: transaction.reference,
        description: transaction.description,
        debit: formatCurrency(transaction.debit, transaction.currency),
        credit: formatCurrency(transaction.credit, transaction.currency),
        balance: formatCurrency(transaction.balance, transaction.currency)
      })),
      emptyMessage: "No transactions were recorded during this statement period."
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeName}_statement.pdf"`
    );
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(pdf);
  } catch (error) {
    console.error("Customer statement PDF error:", error);

    if (!res.headersSent) {
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to download customer statement"
      });
    }
  }
};
