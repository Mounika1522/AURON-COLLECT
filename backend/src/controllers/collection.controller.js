
import prisma from "../config/prisma.js";
import { Prisma } from "@prisma/client";
import {
  buildInvoiceScope,
  DashboardFilterError,
  parseDashboardFilters,
} from "../services/dashboard-filters.service.js";
import {
  buildDisputeDataWhere,
  buildInvoiceDataWhere,
  buildPromiseDataWhere,
  buildReceiptDataWhere,
  DashboardAccessError,
  getDashboardDataAccess,
} from "../services/dashboard-access.service.js";

const getUTCDate = (value) => {
  const date = new Date(value);

  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
};

const getTodayUTC = () => getUTCDate(new Date());

// CUSTOMER RISK SCORING
const getRiskScore = (riskLevel) => {
  const riskScores = {
    LOW: 0,
    MEDIUM: 5,
    HIGH: 10,
    CRITICAL: 20
  };

  return riskScores[riskLevel] ?? 0;
};

// COLLECTION PRIORITY CALCULATION
const getPriority = ({
  outstanding,
  overdueDays,
  paymentHistoryScore,
  promiseFailureScore,
  disputeScore,
  workloadScore,
  riskScore
}) => {
  let amountScore = 0;
  let overdueScore = 0;

  if (outstanding <= 10000) amountScore = 5;
  else if (outstanding <= 50000) amountScore = 10;
  else if (outstanding <= 100000) amountScore = 15;
  else amountScore = 20;

  if (overdueDays <= 0) overdueScore = 0;
  else if (overdueDays <= 30) overdueScore = 10;
  else if (overdueDays <= 60) overdueScore = 20;
  else if (overdueDays <= 90) overdueScore = 30;
  else overdueScore = 40;

  const score =
    amountScore +
    overdueScore +
    paymentHistoryScore +
    promiseFailureScore +
    disputeScore +
    workloadScore +
    riskScore;

  let priority = "LOW";

  if (score >= 65) priority = "CRITICAL";
  else if (score >= 45) priority = "HIGH";
  else if (score >= 25) priority = "MEDIUM";

  return {
    score,
    priority,
    amountScore,
    overdueScore,
    paymentHistoryScore,
    promiseFailureScore,
    disputeScore,
    workloadScore,
    riskScore
  };
};

// GET COLLECTION PRIORITY QUEUE
export const getCollectionQueue = async (req, res) => {
  try {
    const access =
      req.dashboardAccess || getDashboardDataAccess(req.user);
    const organisationId = access.organisationId;
    const filters = parseDashboardFilters(req.query, new Date(), access);
    const asOfExclusive = new Date(getTodayUTC() + 86400000);

    const invoices = await prisma.invoice.findMany({
      where: buildInvoiceDataWhere(
        access,
        buildInvoiceScope(organisationId, filters),
      ),
      include: {
        customer: {
          include: {
            receipts: {
              where: buildReceiptDataWhere(access, { status: "POSTED" }),
              select: {
                id: true,
                amount: true
              }
            },
            promises: {
              where: buildPromiseDataWhere(access),
              select: {
                status: true
              }
            },
            disputes: {
              where: buildDisputeDataWhere(access, { status: "OPEN" }),
              select: {
                id: true
              }
            }
          }
        },
        allocations: {
          where: {
            organisationId,
            status: "POSTED",
            reversedAt: null,
            receipt: {
              organisationId,
              status: "POSTED",
              receiptDate: {
                lt: asOfExclusive
              }
            }
          },
          select: {
            amount: true,
            receipt: {
              select: {
                currency: true,
              },
            },
          }
        },
        creditAdjustments: {
          where: {
            organisationId,
            status: "APPROVED",
            OR: [
              { approvedAt: null },
              { approvedAt: { lt: asOfExclusive } },
            ],
          },
          select: {
            amount: true
          }
        }
      }
    });

    const executiveNames = [
      ...new Set(
        invoices
          .map((invoice) => invoice.assignedExecutive)
          .filter(Boolean)
      )
    ];

    const executiveTasks = executiveNames.length
      ? await prisma.task.groupBy({
          by: ["assignedExecutive"],
          where: {
            organisationId,
            assignedExecutive: {
              in: executiveNames
            },
            status: {
              in: ["PENDING", "IN_PROGRESS"]
            }
          },
          _count: {
            id: true
          }
        })
      : [];

    const workloadMap = new Map(
      executiveTasks.map((item) => [
        item.assignedExecutive,
        item._count.id
      ])
    );

    const today = getTodayUTC();
    const queue = [];

    for (const invoice of invoices) {
      // Posted receipt allocations
      const paidAmount = invoice.allocations.reduce(
        (total, allocation) => {
          if (
            String(allocation.receipt.currency).toUpperCase() !==
            String(invoice.currency).toUpperCase()
          ) {
            return total;
          }
          return total.plus(allocation.amount);
        },
        new Prisma.Decimal(0)
      );

      // Approved credit adjustments
      const adjustmentAmount = invoice.creditAdjustments.reduce(
        (total, adjustment) =>
          total.plus(adjustment.amount),
        new Prisma.Decimal(0)
      );

      // Outstanding = Total - Payments - Approved Adjustments
      const outstanding = new Prisma.Decimal(invoice.total)
        .minus(paidAmount)
        .minus(adjustmentAmount);

      if (outstanding.lte(0)) continue;

      const overdueDays = Math.max(
        0,
        Math.floor(
          (today - getUTCDate(invoice.dueDate)) /
          86400000
        )
      );

      const customer = invoice.customer;

      // Payment history indicator
      const paymentHistoryScore =
        customer.receipts.length === 0 ? 5 : 0;

      // Broken promise score
      const promiseFailureCount = customer.promises.filter(
        (promise) => promise.status === "BROKEN"
      ).length;

      const promiseFailureScore = Math.min(
        promiseFailureCount * 10,
        20
      );

      // Open dispute score
      const disputeScore =
        customer.disputes.length > 0 ? 5 : 0;

      // Executive workload score
      const workloadCount = invoice.assignedExecutive
        ? workloadMap.get(invoice.assignedExecutive) || 0
        : 0;

      const workloadScore =
        workloadCount >= 10 ? 5 :
        workloadCount >= 5 ? 3 : 0;

      // Customer risk score
      const riskScore = getRiskScore(customer.riskLevel);

      const priorityData = getPriority({
        outstanding: Number(outstanding.toString()),
        overdueDays,
        paymentHistoryScore,
        promiseFailureScore,
        disputeScore,
        workloadScore,
        riskScore
      });

      queue.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        customerName: customer.name,
        currency: String(invoice.currency || "").toUpperCase(),
        customerEmail: customer.email,
        customerPhone: customer.phone,
        customerRiskLevel: customer.riskLevel,
        assignedExecutive: invoice.assignedExecutive,
        invoiceTotal: invoice.total.toString(),
        paidAmount: paidAmount.toString(),
        adjustmentAmount: adjustmentAmount.toString(),
        outstandingAmount: outstanding.toString(),
        dueDate: invoice.dueDate,
        overdueDays,
        priority: priorityData.priority,
        priorityScore: priorityData.score,
        scoringFactors: {
          amountScore: priorityData.amountScore,
          overdueScore: priorityData.overdueScore,
          paymentHistoryScore: priorityData.paymentHistoryScore,
          promiseFailureScore: priorityData.promiseFailureScore,
          disputeScore: priorityData.disputeScore,
          workloadScore: priorityData.workloadScore,
          riskScore: priorityData.riskScore
        }
      });
    }

    queue.sort((a, b) =>
      a.currency.localeCompare(b.currency) ||
      b.priorityScore - a.priorityScore ||
      Number(b.outstandingAmount) -
        Number(a.outstandingAmount)
    );

    return res.status(200).json({
      success: true,
      message: "Collection priority queue generated successfully",
      count: queue.length,
      appliedFilters: {
        from: filters.fromDate?.toISOString().slice(0, 10) ?? null,
        to: filters.toDate?.toISOString().slice(0, 10) ?? null,
        executive: filters.unassignedExecutive
          ? "__UNASSIGNED__"
          : filters.executive,
      },
      scoringNote:
        "Priority scoring uses outstanding amount, overdue days, payment history, broken promises, open disputes, executive workload and customer risk classification. Amount comparisons are grouped by currency because no conversion is applied.",
      pendingFactors: [],
      queue
    });

  } catch (error) {
    if (error instanceof DashboardAccessError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    if (error instanceof DashboardFilterError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    console.error("Collection queue error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to generate collection queue"
    });
  }
};
