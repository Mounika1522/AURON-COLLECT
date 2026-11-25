import prisma from "../config/prisma.js";
import { calculateAgeingSummary } from "../services/dashboard-metrics.service.js";
import {
  buildInvoiceScope,
  DashboardFilterError,
  parseDashboardFilters,
} from "../services/dashboard-filters.service.js";
import {
  buildInvoiceDataWhere,
  DashboardAccessError,
  getDashboardDataAccess,
} from "../services/dashboard-access.service.js";
import {
  loadBrandedOrganisationName,
  renderBrandedPdf
} from "../services/branded-pdf.service.js";

export const getAgeingReport = async (req, res) => {
  try {
    const access =
      req.dashboardAccess || getDashboardDataAccess(req.user);
    const organisationId = access.organisationId;
    const now = new Date();
    const filters = parseDashboardFilters(req.query, now, access);
    const invoices = await prisma.invoice.findMany({
      where: buildInvoiceDataWhere(
        access,
        buildInvoiceScope(organisationId, filters),
      ),
      include: {
        customer: {
          select: {
            name: true,
          },
        },
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
      },
      orderBy: {
        dueDate: "asc",
      },
    });

    const { currencySummaries, invoices: invoiceDetails } =
      calculateAgeingSummary({ invoices, now, organisationId, filters });
    const singleCurrency =
      currencySummaries.length === 1 ? currencySummaries[0] : null;
    const asOfDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    )
      .toISOString()
      .slice(0, 10);

    if (String(req.query.format || "").toLowerCase() === "pdf") {
      const summary = currencySummaries.map((currencySummary) => ({
        label: `${currencySummary.currency} outstanding`,
        value: `${currencySummary.currency} ${currencySummary.totalOutstanding}`
      }));
      const organisationName = await loadBrandedOrganisationName(organisationId);
      const pdf = await renderBrandedPdf({
        organisationName,
        title: "Receivables Ageing Report",
        period: `As of ${asOfDate}${filters.fromDate || filters.toDate
          ? ` · Invoice date filters: ${filters.fromDate?.toISOString().slice(0, 10) || "any"} to ${filters.toDate?.toISOString().slice(0, 10) || "any"}`
          : ""}`,
        summary: [
          { label: "Open invoices", value: invoiceDetails.length },
          ...summary
        ],
        landscape: true,
        columns: [
          { key: "invoiceNumber", label: "Invoice", weight: 1.15 },
          { key: "customerName", label: "Customer", weight: 1.6 },
          { key: "dueDate", label: "Due date", weight: 1 },
          { key: "overdueDays", label: "Days overdue", weight: 0.8, align: "right" },
          { key: "ageingCategory", label: "Ageing bucket", weight: 1 },
          { key: "invoiceTotal", label: "Invoice total", weight: 1, align: "right" },
          { key: "paidAmount", label: "Paid", weight: 0.9, align: "right" },
          { key: "adjustmentAmount", label: "Credits", weight: 0.9, align: "right" },
          { key: "outstandingAmount", label: "Outstanding", weight: 1.1, align: "right" }
        ],
        rows: invoiceDetails.map((invoice) => ({
          ...invoice,
          dueDate: invoice.dueDate.toISOString().slice(0, 10),
          ageingCategory: invoice.ageingCategory
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (letter) => letter.toUpperCase())
        })),
        emptyMessage: "No outstanding invoices match the selected ageing filters."
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="auron-ageing-${asOfDate}.pdf"`
      );
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).send(pdf);
    }

    return res.status(200).json({
      success: true,
      message: "Ageing report generated successfully",
      asOfDate,
      totalInvoices: invoiceDetails.length,
      totalOutstanding: singleCurrency?.totalOutstanding ?? null,
      summary: singleCurrency?.summary ?? null,
      appliedFilters: {
        from: filters.fromDate?.toISOString().slice(0, 10) ?? null,
        to: filters.toDate?.toISOString().slice(0, 10) ?? null,
        executive: filters.unassignedExecutive
          ? "__UNASSIGNED__"
          : filters.executive,
      },
      currencySummaries,
      invoices: invoiceDetails,
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

    console.error("Ageing report error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to generate ageing report",
    });
  }
};
