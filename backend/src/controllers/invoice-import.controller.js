
import XLSX from "xlsx";
import prisma from "../config/prisma.js";
import {
  assertSubscriptionCapacity,
  SubscriptionLimitError
} from "../services/subscription-limits.service.js";
import {
  buildCustomerDataWhere,
} from "../services/dashboard-access.service.js";

// REQUIRED CSV / EXCEL COLUMNS
const requiredColumns = [
  "invoiceNumber",
  "customerCode",
  "invoiceDate",
  "dueDate",
  "subtotal",
  "tax",
  "discount",
  "total"
];

// VALIDATE AND PARSE DATE
const parseDate = (value) => {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    return null;
  }

  // Excel date serial number support
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (!parsed) return null;

    const date = new Date(
      Date.UTC(parsed.y, parsed.m - 1, parsed.d)
    );

    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dateText = String(value).trim();

  // Accept YYYY-MM-DD
  const match = dateText.match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(
    Date.UTC(year, month - 1, day)
  );

  // Reject invalid dates
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
};

// VALIDATE AMOUNT
const parseAmount = (value) => {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    return null;
  }

  const amount = Number(value);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  // Maximum two decimal places
  if (Math.round(amount * 100) !== amount * 100) {
    return null;
  }

  return amount;
};

// READ CSV / XLSX FILE
const readInvoiceFile = (filePath) => {
  const workbook = XLSX.readFile(filePath, {
    raw: false,
    cellDates: false,
    dateNF: "yyyy-mm-dd"
  });

  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error("Uploaded file has no worksheet");
  }

  const worksheet = workbook.Sheets[sheetName];

  return XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
    raw: false,
    dateNF: "yyyy-mm-dd"
  });
};

// VALIDATE ALL INVOICE ROWS
const validateInvoiceRows = async (rows, access) => {
  const { organisationId } = access;
  const errors = [];
  const validRows = [];
  const seenInvoiceNumbers = new Set();

  // Get customer codes from uploaded file
  const customerCodes = [
    ...new Set(
      rows
        .map((row) =>
          String(row.customerCode || "").trim()
        )
        .filter(Boolean)
    )
  ];

  // Find customers belonging to this organisation
  const customers = await prisma.customer.findMany({
    where: buildCustomerDataWhere(access, {
      customerCode: {
        in: customerCodes
      }
    }),
    select: {
      id: true,
      customerCode: true
    }
  });

  const customerMap = new Map(
    customers.map((customer) => [
      customer.customerCode,
      customer.id
    ])
  );

  // Check existing invoice numbers
  const invoiceNumbers = [
    ...new Set(
      rows
        .map((row) =>
          String(row.invoiceNumber || "").trim()
        )
        .filter(Boolean)
    )
  ];

  const existingInvoices = await prisma.invoice.findMany({
    where: {
      organisationId,
      invoiceNumber: {
        in: invoiceNumbers
      }
    },
    select: {
      invoiceNumber: true
    }
  });

  const existingInvoiceNumbers = new Set(
    existingInvoices.map(
      (invoice) => invoice.invoiceNumber
    )
  );

  // Validate each row
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowNumber = index + 2;
    const rowErrors = [];

    const invoiceNumber = String(
      row.invoiceNumber || ""
    ).trim();

    const customerCode = String(
      row.customerCode || ""
    ).trim();

    const invoiceDate = parseDate(row.invoiceDate);
    const dueDate = parseDate(row.dueDate);

    const subtotal = parseAmount(row.subtotal);
    const tax = parseAmount(row.tax);
    const discount = parseAmount(row.discount);
    const total = parseAmount(row.total);

    // Required fields
    if (!invoiceNumber) {
      rowErrors.push("Invoice number is required");
    }

    if (!customerCode) {
      rowErrors.push("Customer code is required");
    } else if (!customerMap.has(customerCode)) {
      rowErrors.push(
        `Customer code ${customerCode} was not found`
      );
    }

    // Duplicate invoice validation
    if (invoiceNumber) {
      if (existingInvoiceNumbers.has(invoiceNumber)) {
        rowErrors.push(
          "Invoice number already exists"
        );
      }

      if (seenInvoiceNumbers.has(invoiceNumber)) {
        rowErrors.push(
          "Duplicate invoice number in uploaded file"
        );
      }

      seenInvoiceNumbers.add(invoiceNumber);
    }

    // Date validation
    if (!invoiceDate) {
      rowErrors.push(
        "Invoice date must use YYYY-MM-DD format"
      );
    }

    if (!dueDate) {
      rowErrors.push(
        "Due date must use YYYY-MM-DD format"
      );
    }

    if (
      invoiceDate &&
      dueDate &&
      dueDate < invoiceDate
    ) {
      rowErrors.push(
        "Due date cannot be before invoice date"
      );
    }

    // Amount validation
    if (subtotal === null) {
      rowErrors.push("Invalid subtotal");
    }

    if (tax === null) {
      rowErrors.push("Invalid tax amount");
    }

    if (discount === null) {
      rowErrors.push("Invalid discount amount");
    }

    if (total === null) {
      rowErrors.push("Invalid total amount");
    }

    // Financial calculation validation
    if (
      subtotal !== null &&
      tax !== null &&
      discount !== null &&
      total !== null
    ) {
      if (discount > subtotal + tax) {
        rowErrors.push(
          "Discount cannot exceed subtotal plus tax"
        );
      }

      const expectedTotal = Math.round(
        (subtotal + tax - discount) * 100
      );

      if (
        expectedTotal !== Math.round(total * 100)
      ) {
        rowErrors.push(
          "Total must equal subtotal + tax - discount"
        );
      }
    }

    // Validate currency
    const currency = String(
      row.currency || "INR"
    ).trim().toUpperCase() || "INR";

    if (!/^[A-Z]{3}$/.test(currency)) {
      rowErrors.push("Invalid currency code");
    }

    // Validate invoice status
    const status = String(
      row.status || "ISSUED"
    ).trim().toUpperCase();
    const requestedExecutive = String(
      row.assignedExecutive || ""
    ).trim();
    if (
      access.assignedExecutive &&
      requestedExecutive &&
      requestedExecutive !== access.assignedExecutive
    ) {
      rowErrors.push("You cannot assign an invoice to another executive");
    }

    const allowedStatuses = [
      "DRAFT",
      "ISSUED",
      "PARTIALLY_PAID",
      "PAID",
      "OVERDUE",
      "CANCELLED"
    ];

    if (!allowedStatuses.includes(status)) {
      rowErrors.push("Invalid invoice status");
    }

    // Store validation errors
    if (rowErrors.length > 0) {
      errors.push({
        row: rowNumber,
        invoiceNumber,
        errors: rowErrors
      });

      continue;
    }

    // Add valid invoice row
    validRows.push({
      invoiceNumber,
      customerId: customerMap.get(customerCode),
      invoiceDate,
      dueDate,
      currency,
      subtotal: subtotal.toFixed(2),
      tax: tax.toFixed(2),
      discount: discount.toFixed(2),
      total: total.toFixed(2),
      assignedExecutive:
        access.assignedExecutive || requestedExecutive || null,
      salesperson:
        String(row.salesperson || "").trim() || null,
      status,
      notes:
        String(row.notes || "").trim() || null,
      organisationId
    });
  }

  return {
    validRows,
    errors
  };
};

// CHECK REQUIRED FILE COLUMNS
const checkRequiredColumns = (rows) => {
  const headers = Object.keys(rows[0] || {});

  return requiredColumns.filter(
    (column) => !headers.includes(column)
  );
};

// PREVIEW INVOICE IMPORT
export const previewInvoiceImport = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a CSV or XLSX file"
      });
    }

    const rows = readInvoiceFile(req.file.path);

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Uploaded file contains no invoice rows"
      });
    }

    const missingColumns = checkRequiredColumns(rows);

    if (missingColumns.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Required columns are missing",
        missingColumns,
        expectedColumns: requiredColumns
      });
    }

    const result = await validateInvoiceRows(
      rows,
      req.dashboardAccess
    );

    return res.status(200).json({
      success: true,
      message: "Invoice import preview generated",
      totalRows: rows.length,
      validCount: result.validRows.length,
      errorCount: result.errors.length,
      preview: result.validRows,
      errors: result.errors,
      sourceFile: req.file.filename,
      note: "This is only a preview. No invoices have been imported yet."
    });

  } catch (error) {
    console.error(
      "Invoice preview error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to preview invoice file"
    });
  }
};

// CONFIRM INVOICE IMPORT
export const confirmInvoiceImport = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload the same CSV or XLSX file again to confirm"
      });
    }

    const rows = readInvoiceFile(req.file.path);

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Uploaded file contains no invoice rows"
      });
    }

    const missingColumns = checkRequiredColumns(rows);

    if (missingColumns.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Required columns are missing",
        missingColumns,
        expectedColumns: requiredColumns
      });
    }

    const result = await validateInvoiceRows(
      rows,
      req.dashboardAccess
    );

    const importedCount = result.validRows.length
      ? await prisma.$transaction(async (tx) => {
          const uniqueRows = [
            ...new Map(
              result.validRows.map((row) => [row.invoiceNumber, row])
            ).values()
          ];
          const existing = await tx.invoice.findMany({
            where: {
              organisationId: req.user.organisationId,
              invoiceNumber: { in: uniqueRows.map((row) => row.invoiceNumber) }
            },
            select: { invoiceNumber: true }
          });
          const existingNumbers = new Set(
            existing.map((invoice) => invoice.invoiceNumber)
          );
          const rowsToAdd = uniqueRows.filter(
            (row) => !existingNumbers.has(row.invoiceNumber)
          );

          await assertSubscriptionCapacity(
            tx,
            req.user.organisationId,
            "invoices",
            rowsToAdd.length
          );
          const imported = await tx.invoice.createMany({
            data: result.validRows,
            skipDuplicates: true
          });
          return imported.count;
        }, { isolationLevel: "Serializable" })
      : 0;

    return res.status(200).json({
      success: true,
      message: "Invoice import completed",
      totalRows: rows.length,
      importedCount,
      errorCount: result.errors.length,
      errors: result.errors,
      skippedCount: rows.length - importedCount,
      note: "Invalid or duplicate rows were not imported."
    });

  } catch (error) {
    if (error instanceof SubscriptionLimitError) {
      return res.status(409).json({
        success: false,
        code: error.code,
        message: error.message,
        limit: error.limit
      });
    }

    if (error.code === "P2034") {
      return res.status(409).json({
        success: false,
        message: "Invoice import conflicted with another update. Please retry."
      });
    }

    console.error(
      "Invoice import error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to import invoices"
    });
  }
};
