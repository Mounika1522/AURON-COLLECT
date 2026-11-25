import prisma from "../config/prisma.js";
import { calculateDashboardMetrics } from "../services/dashboard-metrics.service.js";
import {
  buildInvoiceOwnerScope,
  buildPeriodCreditScope,
  DashboardFilterError,
  getDashboardPeriod,
  parseDashboardFilters,
} from "../services/dashboard-filters.service.js";
import {
  buildCreditAdjustmentDataWhere,
  buildCustomerDataWhere,
  buildInvoiceDataWhere,
  DashboardAccessError,
  getDashboardDataAccess,
} from "../services/dashboard-access.service.js";

export const getDashboardSummary = async (req, res) => {
  try {
    const access =
      req.dashboardAccess || getDashboardDataAccess(req.user);
    const organisationId = access.organisationId;
    const now = new Date();
    const filters = parseDashboardFilters(req.query, now, access);
    const period = getDashboardPeriod(filters, now);

    const [invoices, periodCredits, totalCustomers] = await Promise.all([
      prisma.invoice.findMany({
        where: buildInvoiceDataWhere(
          access,
          buildInvoiceOwnerScope(organisationId, filters),
        ),
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          dueDate: true,
          assignedExecutive: true,
          total: true,
          currency: true,
          status: true,
          organisationId: true,
          allocations: {
            where: { organisationId },
            select: {
              amount: true,
              status: true,
              reversedAt: true,
              organisationId: true,
              receipt: {
                select: {
                  status: true,
                  receiptDate: true,
                  organisationId: true,
                  currency: true,
                },
              },
            },
          },
          creditAdjustments: {
            where: { organisationId },
            select: {
              amount: true,
              status: true,
              approvedAt: true,
            },
          },
          promises: {
            where: { organisationId },
            select: {
              promisedAmount: true,
              promisedDate: true,
              createdAt: true,
              status: true,
              organisationId: true,
            },
          },
        },
      }),
      prisma.creditAdjustment.findMany({
        where: buildCreditAdjustmentDataWhere(
          access,
          buildPeriodCreditScope(organisationId, filters, period),
        ),
        select: {
          amount: true,
          status: true,
          organisationId: true,
          approvedAt: true,
          invoice: {
            select: {
              organisationId: true,
              assignedExecutive: true,
              currency: true,
            },
          },
        },
      }),
      prisma.customer.count({ where: buildCustomerDataWhere(access) }),
    ]);

    const metrics = calculateDashboardMetrics({
      invoices,
      periodCredits,
      filters,
      now,
      organisationId,
    });

    return res.status(200).json({
      success: true,
      message: "Dashboard summary fetched successfully",
      dashboard: {
        totalCustomers,
        totalInvoices: metrics.totalInvoices,
        overdueInvoices: metrics.overdueInvoices,
        paidInvoices: metrics.paidInvoices,
        partiallyPaidInvoices: metrics.partiallyPaidInvoices,
        promisesDueInRange: metrics.promisesDueInRange,
        brokenPromises: metrics.brokenPromises,
        currencies: metrics.currencies,
        trend: metrics.trend,
        period: metrics.period,
        appliedFilters: {
          from: filters.fromDate?.toISOString().slice(0, 10) ?? null,
          to: filters.toDate?.toISOString().slice(0, 10) ?? null,
          executive: filters.unassignedExecutive
            ? "__UNASSIGNED__"
            : filters.executive,
        },
        totalInvoiceAmount: metrics.legacy.totalInvoiceAmount,
        totalOutstanding: metrics.legacy.totalOutstanding,
        overdueAmount: metrics.legacy.overdueAmount,
        totalCollections: metrics.legacy.totalCollections,
        collectionsInRange: metrics.legacy.collectionsInRange,
        dsoMethod: metrics.dsoMethod,
        dsoPeriodDays: metrics.dsoPeriodDays,
      },
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

    console.error("Dashboard error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard summary",
    });
  }
};
