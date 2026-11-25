import { Prisma } from "@prisma/client";
import { getDashboardPeriod } from "./dashboard-filters.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXCLUDED_INVOICE_STATUSES = new Set([
  "DRAFT",
  "CANCELLED",
  "WRITTEN_OFF",
]);

const decimal = (value) => new Prisma.Decimal(value ?? 0);
const zero = () => new Prisma.Decimal(0);

const currencyCode = (value) =>
  String(value || "").trim().toUpperCase() || "UNKNOWN";

const moneyString = (value) => decimal(value).toDecimalPlaces(2).toFixed(2);

const utcDayStart = (value) => {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const getCurrencyMetrics = (metricsByCurrency, currency) => {
  const code = currencyCode(currency);

  if (!metricsByCurrency.has(code)) {
    metricsByCurrency.set(code, {
      currency: code,
      totalInvoiceAmount: zero(),
      approvedCreditAdjustments: zero(),
      netInvoiceAmount: zero(),
      allocatedCollections: zero(),
      totalOutstanding: zero(),
      dsoOutstanding: zero(),
      overdueAmount: zero(),
      totalCollections: zero(),
      collectionsInRange: zero(),
      netSalesInRange: zero(),
      dsoReliable: true,
      expectedPromiseAmount: zero(),
      promisesDueInRange: 0,
      brokenPromises: 0,
    });
  }

  return metricsByCurrency.get(code);
};

export const isValidPostedAllocation = (allocation, organisationId) =>
  allocation.status === "POSTED" &&
  !allocation.reversedAt &&
  allocation.receipt?.status === "POSTED" &&
  (!organisationId ||
    (allocation.organisationId === organisationId &&
      allocation.receipt.organisationId === organisationId));

const getValidAllocations = (invoice, beforeExclusive, organisationId) =>
  (invoice.allocations || []).filter((allocation) => {
    if (!isValidPostedAllocation(allocation, organisationId)) return false;
    if (
      organisationId &&
      currencyCode(allocation.receipt.currency) !== currencyCode(invoice.currency)
    ) return false;
    if (!allocation.receipt?.receiptDate) return false;
    return new Date(allocation.receipt.receiptDate) < beforeExclusive;
  });

const getApprovedAdjustments = (invoice, asOfExclusive) =>
  (invoice.creditAdjustments || []).filter(
    (adjustment) =>
      adjustment.status === "APPROVED" &&
      (!adjustment.approvedAt ||
        new Date(adjustment.approvedAt) < asOfExclusive),
  );

const sumAmounts = (records) =>
  records.reduce((sum, record) => sum.plus(record.amount), zero());

export const calculateInvoiceBalance = (
  invoice,
  asOfExclusive,
  organisationId,
) => {
  const allocations = getValidAllocations(
    invoice,
    asOfExclusive,
    organisationId,
  );
  const adjustments = getApprovedAdjustments(invoice, asOfExclusive);
  const paidAmount = sumAmounts(allocations);
  const adjustmentAmount = sumAmounts(adjustments);
  const netInvoiceAmount = decimal(invoice.total).minus(adjustmentAmount);
  const outstanding = netInvoiceAmount.minus(paidAmount);

  return {
    paidAmount,
    adjustmentAmount,
    netInvoiceAmount: netInvoiceAmount.gt(0) ? netInvoiceAmount : zero(),
    outstanding: outstanding.gt(0) ? outstanding : zero(),
    allocations,
    adjustments,
  };
};

const getPromiseProgress = (
  promise,
  invoice,
  invoiceBalance,
  todayStart,
  asOfExclusive,
  organisationId,
  periodStart,
  periodEndExclusive,
) => {
  const promisedAmount = decimal(promise.promisedAmount);
  const paidSincePromise = sumAmounts(
    getValidAllocations(invoice, asOfExclusive, organisationId).filter(
      (allocation) =>
        new Date(allocation.receipt.receiptDate) >= new Date(promise.createdAt),
    ),
  );
  const promiseStatus = String(promise.status || "").toUpperCase();
  const settled =
    paidSincePromise.gte(promisedAmount) || invoiceBalance.outstanding.isZero();
  const cancelled = promiseStatus === "CANCELLED";
  const fulfilled = promiseStatus === "KEPT";
  const overdueWithoutPayment =
    utcDayStart(promise.promisedDate) < todayStart &&
    paidSincePromise.isZero();
  const broken =
    !settled &&
    !cancelled &&
    !fulfilled &&
    (promiseStatus === "BROKEN" || overdueWithoutPayment);
  const expected =
    !settled &&
    !cancelled &&
    !fulfilled &&
    promiseStatus !== "BROKEN" &&
    !paidSincePromise.isZero();
  const open =
    !settled &&
    !cancelled &&
    !fulfilled &&
    promiseStatus !== "BROKEN" &&
    !expected &&
    !overdueWithoutPayment;
  const remainingPromise = promisedAmount.minus(paidSincePromise);
  const expectedAmount = Prisma.Decimal.min(
    remainingPromise.gt(0) ? remainingPromise : zero(),
    invoiceBalance.outstanding,
  );

  return {
    settled,
    broken,
    expected: expected || open,
    expectedAmount,
    inPeriod:
      new Date(promise.promisedDate) >= periodStart &&
      new Date(promise.promisedDate) < periodEndExclusive,
    active:
      !settled &&
      !cancelled &&
      !fulfilled &&
      promiseStatus !== "BROKEN" &&
      !broken,
  };
};

const toCurrencySummary = (metrics, dsoPeriodDays) => {
  const collectionRate = metrics.netInvoiceAmount.gt(0)
    ? Number(
        metrics.allocatedCollections
          .dividedBy(metrics.netInvoiceAmount)
          .times(100)
          .toDecimalPlaces(2)
          .toString(),
      )
    : null;
  const dsoDays =
    metrics.dsoReliable && metrics.netSalesInRange.gt(0)
      ? Number(
          metrics.dsoOutstanding
            .dividedBy(metrics.netSalesInRange)
            .times(dsoPeriodDays)
            .toDecimalPlaces(1)
            .toString(),
        )
      : null;

  return {
    currency: metrics.currency,
    totalInvoiceAmount: moneyString(metrics.totalInvoiceAmount),
    approvedCreditAdjustments: moneyString(
      metrics.approvedCreditAdjustments,
    ),
    netInvoiceAmount: moneyString(metrics.netInvoiceAmount),
    allocatedCollections: moneyString(metrics.allocatedCollections),
    totalOutstanding: moneyString(metrics.totalOutstanding),
    overdueAmount: moneyString(metrics.overdueAmount),
    totalCollections: moneyString(metrics.totalCollections),
    collectionsInRange: moneyString(metrics.collectionsInRange),
    netSalesInRange: moneyString(metrics.netSalesInRange),
    collectionRate,
    dsoDays,
    expectedPromiseAmount: moneyString(metrics.expectedPromiseAmount),
    promisesDueInRange: metrics.promisesDueInRange,
    brokenPromises: metrics.brokenPromises,
  };
};

export const matchesDashboardInvoice = (
  invoice,
  filters = {},
  organisationId,
) => {
  if (!matchesDashboardInvoiceOwner(invoice, filters, organisationId)) return false;
  if (filters.fromDate) {
    const invoiceDate = new Date(invoice.invoiceDate);
    if (
      Number.isNaN(invoiceDate.getTime()) ||
      invoiceDate < filters.fromDate ||
      invoiceDate >= filters.toExclusive
    ) return false;
  }
  return true;
};

const matchesDashboardInvoiceOwner = (
  invoice,
  filters = {},
  organisationId,
) => {
  if (organisationId && invoice.organisationId !== organisationId) return false;
  if (EXCLUDED_INVOICE_STATUSES.has(invoice.status)) return false;

  if (
    filters.unassignedExecutive &&
    invoice.assignedExecutive !== null &&
    invoice.assignedExecutive !== undefined &&
    invoice.assignedExecutive !== ""
  ) return false;
  if (
    filters.executive &&
    invoice.assignedExecutive !== filters.executive
  ) return false;

  return true;
};

const getBucketStart = (value, granularity) => {
  const date = utcDayStart(value);
  if (granularity === "month") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }
  if (granularity === "week") {
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    return new Date(date.getTime() - daysSinceMonday * DAY_MS);
  }
  return date;
};

const addBucket = (value, granularity) => {
  if (granularity === "month") {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
  }
  return new Date(value.getTime() + (granularity === "week" ? 7 : 1) * DAY_MS);
};

const formatBucketLabel = (date, granularity) => {
  if (granularity === "day") return date.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    ...(granularity === "month" ? { year: "numeric" } : {}),
    day: granularity === "week" ? "2-digit" : undefined,
    timeZone: "UTC",
  }).format(date);
};

export const calculateDashboardMetrics = ({
  invoices,
  periodCredits = [],
  filters = {},
  now,
  organisationId,
}) => {
  const currentTime = new Date(now);
  const todayStart = utcDayStart(currentTime);
  const asOfExclusive = new Date(todayStart.getTime() + DAY_MS);
  const period = getDashboardPeriod(filters, currentTime);
  const chartGranularity =
    period.rangeDays <= 31 ? "day" : period.rangeDays <= 120 ? "week" : "month";
  const firstBucket = getBucketStart(period.fromDate, chartGranularity);
  const buckets = [];
  for (
    let bucketStart = firstBucket;
    bucketStart < period.toExclusive;
    bucketStart = addBucket(bucketStart, chartGranularity)
  ) {
    buckets.push({
      key: bucketStart.toISOString().slice(0, 10),
      label: formatBucketLabel(bucketStart, chartGranularity),
      date: bucketStart,
    });
  }
  const metricsByCurrency = new Map();
  const trendByCurrency = new Map();
  let totalInvoices = 0;
  let overdueInvoices = 0;
  let paidInvoices = 0;
  let partiallyPaidInvoices = 0;
  let promisesDueInRange = 0;
  let brokenPromises = 0;

  for (const invoice of invoices) {
    if (!matchesDashboardInvoiceOwner(invoice, filters, organisationId)) continue;
    const metrics = getCurrencyMetrics(metricsByCurrency, invoice.currency);
    const balance = calculateInvoiceBalance(
      invoice,
      asOfExclusive,
      organisationId,
    );
    metrics.dsoOutstanding =
      metrics.dsoOutstanding.plus(balance.outstanding);
  }

  for (const invoice of invoices) {
    if (!matchesDashboardInvoice(invoice, filters, organisationId)) continue;

    const metrics = getCurrencyMetrics(metricsByCurrency, invoice.currency);
    if (!trendByCurrency.has(metrics.currency)) {
      trendByCurrency.set(
        metrics.currency,
        new Map(
          buckets.map((bucket) => [
            bucket.key,
            { billed: zero(), collected: zero() },
          ]),
        ),
      );
    }
    const balance = calculateInvoiceBalance(
      invoice,
      asOfExclusive,
      organisationId,
    );
    const invoiceTotal = decimal(invoice.total);
    const dueDate = utcDayStart(invoice.dueDate);
    const isOverdue = balance.outstanding.gt(0) && dueDate < todayStart;

    totalInvoices += 1;
    metrics.totalInvoiceAmount = metrics.totalInvoiceAmount.plus(invoiceTotal);
    metrics.approvedCreditAdjustments =
      metrics.approvedCreditAdjustments.plus(balance.adjustmentAmount);
    metrics.netInvoiceAmount = metrics.netInvoiceAmount.plus(
      balance.netInvoiceAmount,
    );
    metrics.allocatedCollections =
      metrics.allocatedCollections.plus(balance.paidAmount);
    metrics.totalOutstanding =
      metrics.totalOutstanding.plus(balance.outstanding);
    metrics.totalCollections =
      metrics.totalCollections.plus(balance.paidAmount);

    if (isOverdue) {
      overdueInvoices += 1;
      metrics.overdueAmount =
        metrics.overdueAmount.plus(balance.outstanding);
    }

    if (invoiceTotal.gt(0) && balance.outstanding.isZero()) {
      paidInvoices += 1;
    } else if (
      (balance.paidAmount.gt(0) || balance.adjustmentAmount.gt(0)) &&
      balance.outstanding.gt(0)
    ) {
      partiallyPaidInvoices += 1;
    }

    const invoiceDate = new Date(invoice.invoiceDate);
    if (
      invoiceDate >= period.fromDate &&
      invoiceDate < period.toExclusive
    ) {
      metrics.netSalesInRange = metrics.netSalesInRange.plus(invoiceTotal);
      const bucketKey = getBucketStart(invoiceDate, chartGranularity)
        .toISOString()
        .slice(0, 10);
      const bucket = trendByCurrency.get(metrics.currency)?.get(bucketKey);
      if (bucket) bucket.billed = bucket.billed.plus(invoiceTotal);
    }

    if (
      invoiceDate >= period.fromDate &&
      invoiceDate < period.toExclusive &&
      balance.adjustments.some((adjustment) => !adjustment.approvedAt)
    ) {
      metrics.dsoReliable = false;
    }

    for (const promise of invoice.promises || []) {
      if (promise.organisationId && promise.organisationId !== invoice.organisationId) {
        continue;
      }

      const progress = getPromiseProgress(
        promise,
        invoice,
        balance,
        todayStart,
        asOfExclusive,
        organisationId,
        period.fromDate,
        period.toExclusive,
      );

      if (progress.inPeriod && progress.active) {
        promisesDueInRange += 1;
        metrics.promisesDueInRange += 1;
      }
      if (progress.broken && progress.inPeriod) {
        brokenPromises += 1;
        metrics.brokenPromises += 1;
      }
      if (progress.expected && progress.inPeriod) {
        metrics.expectedPromiseAmount =
          metrics.expectedPromiseAmount.plus(progress.expectedAmount);
      }
    }
  }

  const collectionPeriodStart = filters.fromDate
    ? period.fromDate
    : new Date(Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth(), 1));
  for (const invoice of invoices) {
    if (!matchesDashboardInvoiceOwner(invoice, filters, organisationId)) continue;
    for (const allocation of getValidAllocations(
      invoice,
      asOfExclusive,
      organisationId,
    )) {
      const receiptDate = new Date(allocation.receipt.receiptDate);
      if (
        receiptDate >= collectionPeriodStart &&
        receiptDate < asOfExclusive
      ) {
        const metrics = getCurrencyMetrics(metricsByCurrency, invoice.currency);
        metrics.collectionsInRange =
          metrics.collectionsInRange.plus(allocation.amount);
      }
      if (
        receiptDate >= period.fromDate &&
        receiptDate < period.toExclusive
      ) {
        const metrics = getCurrencyMetrics(metricsByCurrency, invoice.currency);
        if (!trendByCurrency.has(metrics.currency)) {
          trendByCurrency.set(
            metrics.currency,
            new Map(
              buckets.map((bucket) => [
                bucket.key,
                { billed: zero(), collected: zero() },
              ]),
            ),
          );
        }
        const bucketKey = getBucketStart(receiptDate, chartGranularity)
          .toISOString()
          .slice(0, 10);
        const bucket = trendByCurrency.get(metrics.currency)?.get(bucketKey);
        if (bucket) bucket.collected = bucket.collected.plus(allocation.amount);
      }
    }
  }

  for (const credit of periodCredits) {
    const creditInvoice = credit.invoice;
    if (
      organisationId &&
      (credit.organisationId !== organisationId ||
        creditInvoice?.organisationId !== organisationId)
    ) continue;
    if (filters.unassignedExecutive && creditInvoice?.assignedExecutive) continue;
    if (
      filters.executive &&
      creditInvoice?.assignedExecutive !== filters.executive
    ) continue;

    const approvedAt = new Date(credit.approvedAt);
    if (
      credit.status !== "APPROVED" ||
      Number.isNaN(approvedAt.getTime()) ||
      approvedAt < period.fromDate ||
      approvedAt >= period.toExclusive ||
      approvedAt >= asOfExclusive
    ) continue;

    const metrics = getCurrencyMetrics(
      metricsByCurrency,
      creditInvoice?.currency,
    );
    metrics.netSalesInRange = metrics.netSalesInRange.minus(
      decimal(credit.amount),
    );
    if (!trendByCurrency.has(metrics.currency)) {
      trendByCurrency.set(
        metrics.currency,
        new Map(
          buckets.map((bucket) => [
            bucket.key,
            { billed: zero(), collected: zero() },
          ]),
        ),
      );
    }
    const bucketKey = getBucketStart(approvedAt, chartGranularity)
      .toISOString()
      .slice(0, 10);
    const bucket = trendByCurrency.get(metrics.currency)?.get(bucketKey);
    if (bucket) bucket.billed = bucket.billed.minus(credit.amount);
  }

  const currencies = [...metricsByCurrency.values()]
    .map((metrics) => toCurrencySummary(metrics, period.rangeDays))
    .sort((left, right) => left.currency.localeCompare(right.currency));
  const trend = [...trendByCurrency.entries()]
    .map(([currency, currencyBuckets]) => ({
      currency,
      buckets: buckets.map((bucket) => {
        const values = currencyBuckets.get(bucket.key);
        return {
          key: bucket.key,
          label: bucket.label,
          billed: moneyString(values.billed),
          collected: moneyString(values.collected),
        };
      }),
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
  const singleCurrency = currencies.length === 1 ? currencies[0] : null;
  const legacyAmount = (field) =>
    singleCurrency ? Number(singleCurrency[field]) : null;

  return {
    totalInvoices,
    overdueInvoices,
    paidInvoices,
    partiallyPaidInvoices,
    promisesDueInRange,
    brokenPromises,
    currencies,
    trend,
    period: {
      from: period.fromDate.toISOString().slice(0, 10),
      to: new Date(period.toExclusive.getTime() - DAY_MS)
        .toISOString()
        .slice(0, 10),
      days: period.rangeDays,
      granularity: chartGranularity,
    },
    legacy: {
      totalInvoiceAmount: legacyAmount("totalInvoiceAmount"),
      totalOutstanding: legacyAmount("totalOutstanding"),
      overdueAmount: legacyAmount("overdueAmount"),
      totalCollections: legacyAmount("totalCollections"),
      collectionsInRange: legacyAmount("collectionsInRange"),
    },
    dsoMethod:
      "Selected-range ending-balance DSO = current eligible tax-inclusive receivables / (eligible tax-inclusive invoice totals issued in the selected UTC date range less credit adjustments approved in that range) × selected calendar days.",
    dsoPeriodDays: period.rangeDays,
  };
};

export const calculateAgeingSummary = ({
  invoices,
  now,
  organisationId,
  filters = {},
}) => {
  const todayStart = utcDayStart(now);
  const asOfExclusive = new Date(todayStart.getTime() + DAY_MS);
  const currencies = new Map();
  const invoiceDetails = [];
  const bucketDefinitions = [
    ["current", "Not Yet Due"],
    ["days1to30", "1-30 Days"],
    ["days31to60", "31-60 Days"],
    ["days61to90", "61-90 Days"],
    ["days90plus", ">90 Days"],
  ];

  for (const invoice of invoices) {
    if (!matchesDashboardInvoice(invoice, filters, organisationId)) continue;

    const balance = calculateInvoiceBalance(
      invoice,
      asOfExclusive,
      organisationId,
    );
    if (balance.outstanding.lte(0)) continue;

    const currency = currencyCode(invoice.currency);
    if (!currencies.has(currency)) {
      currencies.set(
        currency,
        Object.fromEntries(
          bucketDefinitions.map(([key]) => [
            key,
            { count: 0, amount: zero() },
          ]),
        ),
      );
    }

    const dueDate = utcDayStart(invoice.dueDate);
    const overdueDays = Math.floor(
      (todayStart.getTime() - dueDate.getTime()) / DAY_MS,
    );
    const category =
      overdueDays <= 0
        ? "current"
        : overdueDays <= 30
          ? "days1to30"
          : overdueDays <= 60
            ? "days31to60"
            : overdueDays <= 90
              ? "days61to90"
              : "days90plus";
    const bucket = currencies.get(currency)[category];
    bucket.count += 1;
    bucket.amount = bucket.amount.plus(balance.outstanding);

    invoiceDetails.push({
      id: invoice.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customer?.name || "",
      currency,
      invoiceTotal: moneyString(invoice.total),
      paidAmount: moneyString(balance.paidAmount),
      adjustmentAmount: moneyString(balance.adjustmentAmount),
      outstandingAmount: moneyString(balance.outstanding),
      dueDate: invoice.dueDate,
      overdueDays: Math.max(0, overdueDays),
      ageingCategory: category,
    });
  }

  const currencySummaries = [...currencies.entries()]
    .map(([currency, buckets]) => {
      const summary = Object.fromEntries(
        Object.entries(buckets).map(([key, value]) => [
          key,
          { count: value.count, amount: moneyString(value.amount) },
        ]),
      );
      const totalOutstanding = Object.values(buckets).reduce(
        (sum, bucket) => sum.plus(bucket.amount),
        zero(),
      );

      return {
        currency,
        totalInvoices: Object.values(buckets).reduce(
          (sum, bucket) => sum + bucket.count,
          0,
        ),
        totalOutstanding: moneyString(totalOutstanding),
        summary,
      };
    })
    .sort((left, right) => left.currency.localeCompare(right.currency));

  return { currencySummaries, invoices: invoiceDetails };
};
