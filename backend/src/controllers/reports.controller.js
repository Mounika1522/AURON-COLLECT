
import XLSX from "xlsx";
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
  buildReceiptDataWhere,
} from "../services/dashboard-access.service.js";

// ---------------- COMMON HELPERS ----------------

const decimal = (value) => new Prisma.Decimal(value ?? 0);

const moneyNumber = (value) => Number(value.toFixed(2));

const getUTCDate = (value) => {
  const date = new Date(value);

  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
};

const getTodayUTC = () => {
  const now = new Date();

  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
};

// Sum valid posted allocations
const getAllocatedAmount = (allocations = []) => {
  return allocations.reduce(
    (total, allocation) => total.plus(allocation.amount),
    new Prisma.Decimal(0)
  );
};

// Sum approved credit adjustments
const getAdjustmentAmount = (adjustments = []) => {
  return adjustments.reduce(
    (total, adjustment) => total.plus(adjustment.amount),
    new Prisma.Decimal(0)
  );
};

// Calculate outstanding
const getOutstandingAmount = (invoice) => {
  const total = decimal(invoice.total);
  const allocated = getAllocatedAmount(invoice.allocations);
  const adjustments = getAdjustmentAmount(invoice.creditAdjustments);

  const outstanding = total
    .minus(allocated)
    .minus(adjustments);

  return outstanding.gt(0)
    ? outstanding
    : new Prisma.Decimal(0);
};

// Common allocation filter
const allocationFilter = {
  status: "POSTED",
  reversedAt: null,
  receipt: {
    status: "POSTED"
  }
};

// Fetch invoice records
const fetchInvoices = async (access, includeAllStatuses = false) => {
  return prisma.invoice.findMany({
    where: buildInvoiceDataWhere(access, {
      ...(includeAllStatuses
        ? {}
        : {
            status: {
              notIn: ["DRAFT", "CANCELLED", "WRITTEN_OFF"]
            }
          })
    }),
    include: {
      customer: {
        select: {
          customerCode: true,
          name: true,
          email: true,
          phone: true
        }
      },
      allocations: {
        where: buildReceiptAllocationDataWhere(access, allocationFilter),
        select: {
          amount: true
        }
      },
      creditAdjustments: {
        where: buildCreditAdjustmentDataWhere(access, {
          status: "APPROVED"
        }),
        select: {
          amount: true
        }
      }
    },
    orderBy: {
      invoiceDate: "desc"
    }
  });
};

const buildCreditAdjustmentReport = async (access) =>
  prisma.creditAdjustment.findMany({
    where: buildCreditAdjustmentDataWhere(access),
    include: {
      invoice: {
        select: {
          invoiceNumber: true,
          currency: true,
          customer: {
            select: { customerCode: true, name: true }
          }
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

// ---------------- 1. INVOICE REPORT ----------------

export const getInvoiceReport = async (req, res) => {
  try {
    const invoices = await fetchInvoices(
      req.dashboardAccess,
      true
    );

    const report = invoices.map((invoice) => {
      const allocated = getAllocatedAmount(invoice.allocations);
      const adjustmentAmount = getAdjustmentAmount(invoice.creditAdjustments);
      const outstanding = getOutstandingAmount(invoice);

      return {
        invoiceNumber: invoice.invoiceNumber,
        customer: invoice.customer.name,
        customerCode: invoice.customer.customerCode,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        total: moneyNumber(decimal(invoice.total)),
        allocatedAmount: moneyNumber(allocated),
        adjustmentAmount: moneyNumber(adjustmentAmount),
        outstanding: moneyNumber(outstanding),
        status: invoice.status
      };
    });

    return res.status(200).json({
      success: true,
      count: report.length,
      invoices: report
    });

  } catch (error) {
    console.error("Invoice report error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch invoice report"
    });
  }
};

// ---------------- 2. COLLECTION REPORT ----------------

export const getCollectionReport = async (req, res) => {
  try {
    const access = req.dashboardAccess;

    const receipts = await prisma.receipt.findMany({
      where: buildReceiptDataWhere(access, { status: "POSTED" }),
      include: {
        customer: {
          select: {
            customerCode: true,
            name: true
          }
        },
        allocations: {
          where: buildReceiptAllocationDataWhere(access, {
            status: "POSTED",
            reversedAt: null
          }),
          select: {
            amount: true,
            invoice: {
              select: {
                invoiceNumber: true
              }
            }
          }
        }
      },
      orderBy: {
        receiptDate: "desc"
      }
    });

    const report = receipts.map((receipt) => {
      const allocated = getAllocatedAmount(receipt.allocations);

      return {
        receiptNumber: receipt.receiptNumber,
        customer: receipt.customer.name,
        customerCode: receipt.customer.customerCode,
        receiptDate: receipt.receiptDate,
        amount: moneyNumber(decimal(receipt.amount)),
        paymentMethod: receipt.paymentMethod,
        transactionReference: receipt.transactionReference,
        allocatedAmount: moneyNumber(allocated),

        allocations: receipt.allocations.map((item) => ({
          invoiceNumber: item.invoice.invoiceNumber,
          amount: moneyNumber(decimal(item.amount))
        }))
      };
    });

    const totalCollections = receipts.reduce(
      (sum, receipt) => sum.plus(receipt.amount),
      new Prisma.Decimal(0)
    );

    return res.status(200).json({
      success: true,
      totalReceipts: receipts.length,
      totalCollections: moneyNumber(totalCollections),
      collections: report
    });

  } catch (error) {
    console.error("Collection report error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch collection report"
    });
  }
};

// ---------------- 3. OUTSTANDING REPORT ----------------

export const getOutstandingReport = async (req, res) => {
  try {
    const invoices = await fetchInvoices(req.dashboardAccess);

    const report = invoices
      .map((invoice) => {
        const allocated = getAllocatedAmount(invoice.allocations);
        const adjustmentAmount = getAdjustmentAmount(invoice.creditAdjustments);
        const outstanding = getOutstandingAmount(invoice);

        return {
          invoiceNumber: invoice.invoiceNumber,
          customerCode: invoice.customer.customerCode,
          customer: invoice.customer.name,
          invoiceTotal: moneyNumber(decimal(invoice.total)),
          allocatedAmount: moneyNumber(allocated),
          adjustmentAmount: moneyNumber(adjustmentAmount),
          outstanding: moneyNumber(outstanding)
        };
      })
      .filter((item) => item.outstanding > 0);

    const totalOutstanding = report.reduce(
      (sum, item) => sum.plus(item.outstanding),
      new Prisma.Decimal(0)
    );

    return res.status(200).json({
      success: true,
      count: report.length,
      totalOutstanding: moneyNumber(totalOutstanding),
      outstandingInvoices: report
    });

  } catch (error) {
    console.error("Outstanding report error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch outstanding report"
    });
  }
};

// ---------------- 4. OVERDUE REPORT ----------------

const buildOverdueReport = async (access, includeCurrency = false) => {
  const today = getTodayUTC();

  const invoices = await prisma.invoice.findMany({
    where: buildInvoiceDataWhere(access, {
      dueDate: {
        lt: new Date(today)
      },
      status: {
        notIn: ["DRAFT", "CANCELLED", "WRITTEN_OFF"]
      }
    }),
    include: {
      customer: {
        select: {
          customerCode: true,
          name: true,
          phone: true,
          email: true
        }
      },
      allocations: {
        where: buildReceiptAllocationDataWhere(access, allocationFilter),
        select: {
          amount: true
        }
      },
      creditAdjustments: {
        where: buildCreditAdjustmentDataWhere(access, {
          status: "APPROVED"
        }),
        select: {
          amount: true
        }
      }
    },
    orderBy: {
      dueDate: "asc"
    }
  });

  const report = invoices
    .map((invoice) => {
      const adjustmentAmount = getAdjustmentAmount(invoice.creditAdjustments);
      const outstanding = getOutstandingAmount(invoice);

      const overdueDays = Math.max(
        0,
        Math.floor(
          (today - getUTCDate(invoice.dueDate)) /
          (1000 * 60 * 60 * 24)
        )
      );

      return {
        invoiceNumber: invoice.invoiceNumber,
        customer: invoice.customer.name,
        customerCode: invoice.customer.customerCode,
        ...(includeCurrency ? { currency: invoice.currency } : {}),
        phone: invoice.customer.phone,
        email: invoice.customer.email,
        dueDate: invoice.dueDate,
        overdueDays,
        adjustmentAmount: moneyNumber(adjustmentAmount),
        outstanding: moneyNumber(outstanding)
      };
    })
    .filter((item) => item.outstanding > 0);

  return report;
};

export const getOverdueReport = async (req, res) => {
  try {
    const report = await buildOverdueReport(req.dashboardAccess);

    const totalOverdue = report.reduce(
      (sum, item) => sum.plus(item.outstanding),
      new Prisma.Decimal(0)
    );

    return res.status(200).json({
      success: true,
      overdueInvoices: report.length,
      totalOverdue: moneyNumber(totalOverdue),
      invoices: report
    });

  } catch (error) {
    console.error("Overdue report error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch overdue report"
    });
  }
};

// ---------------- 5. CUSTOMER-WISE REPORT ----------------

const buildCustomerReport = async (access) => {
  const customers = await prisma.customer.findMany({
    where: buildCustomerDataWhere(access),
    include: {
      invoices: {
        where: buildInvoiceDataWhere(access, {
          status: {
            notIn: ["DRAFT", "CANCELLED", "WRITTEN_OFF"]
          }
        }),
        include: {
          allocations: {
            where: buildReceiptAllocationDataWhere(access, allocationFilter),
            select: {
              amount: true
            }
          },
          creditAdjustments: {
            where: buildCreditAdjustmentDataWhere(access, {
              status: "APPROVED"
            }),
            select: {
              amount: true
            }
          }
        }
      },
      receipts: {
        where: buildReceiptDataWhere(access, { status: "POSTED" }),
        select: {
          amount: true
        }
      }
    },
    orderBy: {
      name: "asc"
    }
  });

  return customers.map((customer) => {
    const invoiceAmount = customer.invoices.reduce(
      (sum, invoice) => sum.plus(invoice.total),
      new Prisma.Decimal(0)
    );

    const allocatedAmount = customer.invoices.reduce(
      (sum, invoice) =>
        sum.plus(getAllocatedAmount(invoice.allocations)),
      new Prisma.Decimal(0)
    );

    const adjustmentAmount = customer.invoices.reduce(
      (sum, invoice) =>
        sum.plus(getAdjustmentAmount(invoice.creditAdjustments)),
      new Prisma.Decimal(0)
    );

    const totalReceipts = customer.receipts.reduce(
      (sum, receipt) => sum.plus(receipt.amount),
      new Prisma.Decimal(0)
    );

    const outstanding = invoiceAmount
      .minus(allocatedAmount)
      .minus(adjustmentAmount);

    return {
      customerCode: customer.customerCode,
      customer: customer.name,
      email: customer.email,
      phone: customer.phone,
      totalInvoices: customer.invoices.length,
      invoiceAmount: moneyNumber(invoiceAmount),
      allocatedAmount: moneyNumber(allocatedAmount),
      adjustmentAmount: moneyNumber(adjustmentAmount),
      outstanding: moneyNumber(
        outstanding.gt(0)
          ? outstanding
          : new Prisma.Decimal(0)
      ),
      totalReceipts: moneyNumber(totalReceipts)
    };
  });
};

export const getCustomerReport = async (req, res) => {
  try {
    const report = await buildCustomerReport(req.dashboardAccess);

    return res.status(200).json({
      success: true,
      count: report.length,
      customers: report
    });

  } catch (error) {
    console.error("Customer report error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer report"
    });
  }
};

export const getCreditAdjustmentReport = async (req, res) => {
  try {
    const adjustments = await buildCreditAdjustmentReport(req.dashboardAccess);
    return res.status(200).json({
      success: true,
      count: adjustments.length,
      adjustments: adjustments.map((adjustment) => ({
        adjustmentNumber: adjustment.adjustmentNumber,
        invoiceNumber: adjustment.invoice.invoiceNumber,
        customerCode: adjustment.invoice.customer.customerCode,
        customer: adjustment.invoice.customer.name,
        date: adjustment.createdAt,
        approvedAt: adjustment.approvedAt,
        reason: adjustment.reason,
        amount: moneyNumber(decimal(adjustment.amount)),
        currency: adjustment.invoice.currency,
        status: adjustment.status
      }))
    });
  } catch (error) {
    console.error("Credit adjustment report error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch credit adjustment report"
    });
  }
};

// ---------------- 6. EXPORT REPORT ----------------

export const exportReport = async (req, res) => {
  try {
    const access = req.dashboardAccess;
    const reportType = String(req.params.type || "").toLowerCase();
    const format = String(req.query.format || "xlsx").toLowerCase();

    const allowedReports = [
      "invoices",
      "collections",
      "outstanding",
      "overdue",
      "customers",
      "credits"
    ];

    if (!allowedReports.includes(reportType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid report type",
        availableReports: allowedReports
      });
    }

    if (!["xlsx", "csv", "pdf"].includes(format)) {
      return res.status(400).json({
        success: false,
        message: "Format must be xlsx, csv or pdf"
      });
    }

    let data = [];

    // Invoice export
    if (reportType === "invoices") {
      const invoices = await fetchInvoices(
        access,
        true
      );

      data = invoices.map((invoice) => ({
        InvoiceNumber: invoice.invoiceNumber,
        CustomerCode: invoice.customer.customerCode || "",
        Customer: invoice.customer.name,
        InvoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
        DueDate: invoice.dueDate.toISOString().slice(0, 10),
        ...(format === "pdf" ? { Currency: invoice.currency } : {}),
        Total: moneyNumber(decimal(invoice.total)),
        Allocated: moneyNumber(getAllocatedAmount(invoice.allocations)),
        AdjustmentAmount: moneyNumber(getAdjustmentAmount(invoice.creditAdjustments)),
        Outstanding: moneyNumber(getOutstandingAmount(invoice)),
        Status: invoice.status
      }));
    }

    // Collections export
    else if (reportType === "collections") {
      const receipts = await prisma.receipt.findMany({
        where: buildReceiptDataWhere(access, { status: "POSTED" }),
        include: {
          customer: {
            select: {
              customerCode: true,
              name: true
            }
          },
          allocations: {
            where: buildReceiptAllocationDataWhere(access, {
              status: "POSTED",
              reversedAt: null
            }),
            select: {
              amount: true
            }
          }
        },
        orderBy: {
          receiptDate: "desc"
        }
      });

      data = receipts.map((receipt) => ({
        ReceiptNumber: receipt.receiptNumber,
        CustomerCode: receipt.customer.customerCode || "",
        Customer: receipt.customer.name,
        ReceiptDate: receipt.receiptDate.toISOString().slice(0, 10),
        ...(format === "pdf" ? { Currency: receipt.currency } : {}),
        Amount: moneyNumber(decimal(receipt.amount)),
        PaymentMethod: receipt.paymentMethod,
        TransactionReference: receipt.transactionReference || "",
        AllocatedAmount: moneyNumber(
          getAllocatedAmount(receipt.allocations)
        )
      }));
    }

    // Outstanding export
    else if (reportType === "outstanding") {
      const invoices = await fetchInvoices(access);

      data = invoices
        .map((invoice) => ({
          InvoiceNumber: invoice.invoiceNumber,
          CustomerCode: invoice.customer.customerCode || "",
          Customer: invoice.customer.name,
          ...(format === "pdf" ? { Currency: invoice.currency } : {}),
          InvoiceTotal: moneyNumber(decimal(invoice.total)),
          AllocatedAmount: moneyNumber(
            getAllocatedAmount(invoice.allocations)
          ),
          AdjustmentAmount: moneyNumber(
            getAdjustmentAmount(invoice.creditAdjustments)
          ),
          Outstanding: moneyNumber(
            getOutstandingAmount(invoice)
          )
        }))
        .filter((item) => item.Outstanding > 0);
    }

    // Overdue export
    else if (reportType === "overdue") {
      const overdueInvoices = await buildOverdueReport(access, format === "pdf");

      data = overdueInvoices.map((invoice) => ({
        InvoiceNumber: invoice.invoiceNumber,
        CustomerCode: invoice.customerCode || "",
        Customer: invoice.customer,
        ...(format === "pdf" ? { Currency: invoice.currency || "" } : {}),
        DueDate: new Date(invoice.dueDate).toISOString().slice(0, 10),
        OverdueDays: invoice.overdueDays,
        AdjustmentAmount: invoice.adjustmentAmount,
        Outstanding: invoice.outstanding
      }));
    }

    // Customer export
    else if (reportType === "customers") {
      const customers = await buildCustomerReport(access);

      data = customers.map((customer) => ({
        CustomerCode: customer.customerCode || "",
        Customer: customer.customer,
        Email: customer.email || "",
        Phone: customer.phone || "",
        TotalInvoices: customer.totalInvoices,
        InvoiceAmount: customer.invoiceAmount,
        AllocatedAmount: customer.allocatedAmount,
        AdjustmentAmount: customer.adjustmentAmount,
        Outstanding: customer.outstanding,
        TotalReceipts: customer.totalReceipts
      }));
    }
    // Credit adjustment statement
    else if (reportType === "credits") {
      const adjustments = await buildCreditAdjustmentReport(access);
      data = adjustments.map((adjustment) => ({
        AdjustmentNumber: adjustment.adjustmentNumber,
        InvoiceNumber: adjustment.invoice.invoiceNumber,
        CustomerCode: adjustment.invoice.customer.customerCode || "",
        Customer: adjustment.invoice.customer.name,
        Date: adjustment.createdAt.toISOString().slice(0, 10),
        ApprovedAt: adjustment.approvedAt?.toISOString().slice(0, 10) || "",
        Reason: adjustment.reason,
        Currency: adjustment.invoice.currency,
        Amount: moneyNumber(decimal(adjustment.amount)),
        Status: adjustment.status
      }));
    }
    if (format === "pdf") {
      const reportTitles = {
        invoices: "Invoice Report",
        collections: "Collections and Payment Statement",
        outstanding: "Outstanding Account Statement",
        overdue: "Overdue Receivables Statement",
        customers: "Customer Account Summary",
        credits: "Credit Adjustment Statement"
      };
      const moneyKey = {
        invoices: "Total",
        collections: "Amount",
        outstanding: "Outstanding",
        overdue: "Outstanding",
        credits: "Amount"
      }[reportType];
      const totalsByCurrency = new Map();
      if (moneyKey) {
        for (const row of data) {
          if (reportType === "credits" && row.Status !== "APPROVED") continue;
          const currency = row.Currency || "INR";
          totalsByCurrency.set(
            currency,
            (totalsByCurrency.get(currency) || 0) + Number(row[moneyKey] || 0)
          );
        }
      }
      const defaultColumns = {
        invoices: ["InvoiceNumber", "CustomerCode", "Customer", "InvoiceDate", "DueDate", "Currency", "Total", "Outstanding", "Status"],
        collections: ["ReceiptNumber", "CustomerCode", "Customer", "ReceiptDate", "Currency", "Amount", "PaymentMethod", "TransactionReference", "AllocatedAmount"],
        outstanding: ["InvoiceNumber", "CustomerCode", "Customer", "Currency", "InvoiceTotal", "AllocatedAmount", "AdjustmentAmount", "Outstanding"],
        overdue: ["InvoiceNumber", "CustomerCode", "Customer", "Currency", "DueDate", "OverdueDays", "AdjustmentAmount", "Outstanding"],
        customers: ["CustomerCode", "Customer", "Email", "Phone", "TotalInvoices", "InvoiceAmount", "AllocatedAmount", "AdjustmentAmount", "Outstanding", "TotalReceipts"],
        credits: ["AdjustmentNumber", "InvoiceNumber", "CustomerCode", "Customer", "Date", "ApprovedAt", "Reason", "Currency", "Amount", "Status"]
      }[reportType];
      const columnKeys = data.length ? Object.keys(data[0]) : defaultColumns;
      const columns = columnKeys.map((key) => ({
        key,
        label: key.replace(/([a-z])([A-Z])/g, "$1 $2"),
        weight: ["Customer", "Reason", "TransactionReference"].includes(key) ? 1.8 : 1,
        align: /amount|total|allocated|outstanding|paid/i.test(key) ? "right" : "left"
      }));
      const organisationName = await loadBrandedOrganisationName(access.organisationId);
      const pdf = await renderBrandedPdf({
        organisationName,
        title: reportTitles[reportType],
        period: `Records through ${new Date().toISOString().slice(0, 10)}`,
        summary: [
          { label: "Records", value: data.length },
          ...[...totalsByCurrency].map(([currency, total]) => ({
            label: `${currency} ${
              {
                invoices: "invoiced",
                collections: "collected",
                outstanding: "outstanding",
                overdue: "overdue",
                credits: "approved credits"
              }[reportType]
            }`,
            value: `${currency} ${total.toFixed(2)}`
          }))
        ],
        columns,
        rows: data,
        landscape: true,
        emptyMessage: "No records are available for this report."
      });
      const fileName = `auron-${reportType}-${new Date().toISOString().slice(0, 10)}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).send(pdf);
    }

    // Protect CSV files from spreadsheet formula injection
    if (format === "csv") {
      data = data.map((row) => {
        const safeRow = {};

        for (const [key, value] of Object.entries(row)) {
          if (
            typeof value === "string" &&
            /^[=+\-@\t\r]/.test(value)
          ) {
            safeRow[key] = "'" + value;
          } else {
            safeRow[key] = value;
          }
        }

        return safeRow;
      });
    }

    // Create workbook
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Report"
    );

    const fileBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: format
    });

    const date = new Date().toISOString().slice(0, 10);
    const fileName = `auron-${reportType}-${date}.${format}`;

    if (format === "csv") {
      res.setHeader(
        "Content-Type",
        "text/csv; charset=utf-8"
      );
    } else {
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
    }

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    return res.status(200).send(fileBuffer);

  } catch (error) {
    console.error("Report export error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to export report"
    });
  }
};
