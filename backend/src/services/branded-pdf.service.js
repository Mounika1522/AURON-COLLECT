import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../config/prisma.js";

const logoPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../public/auron-collect-logo.png");
const PAGE_PADDING = 48;
const FOOTER_HEIGHT = 48;
const RED = "#e50914";
const INK = "#111827";
const MUTED = "#64748b";

const companyFooter = () => [
  process.env.COMPANY_BILLING_ADDRESS || "Alpha Auron Private Limited",
  process.env.COMPANY_GSTIN ? `GSTIN: ${process.env.COMPANY_GSTIN}` : null
].filter(Boolean).join(" · ");

const displayValue = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export const loadBrandedPdfLogo = () => readFile(logoPath);

export const drawBrandedPdfPageHeader = (
  document,
  logo,
  title,
  { titleFontSize = 14, companyName = "ALPHA AURON PRIVATE LIMITED" } = {}
) => {
  const { width, height } = document.page;
  document.save();
  document.fillColor(RED).rect(0, 0, width, 8).fill();
  document.restore();
  document.image(logo, PAGE_PADDING, 25, { fit: [54, 46] });
  document.font("Helvetica-Bold").fontSize(16).fillColor(INK)
    .text("ALPHA AURON", 116, 32);
  document.font("Helvetica").fontSize(8).fillColor(MUTED)
    .text(companyName.toUpperCase(), 116, 52, {
      width: 205,
      lineBreak: false,
      ellipsis: true
    });
  document.font("Helvetica-Bold").fontSize(titleFontSize).fillColor(INK)
    .text(title.toUpperCase(), width - PAGE_PADDING - 215, 39, {
      width: 215,
      align: "right",
      height: 38
    });
  document.save();
  document.opacity(0.055);
  document.image(logo, (width - 210) / 2, 280, { width: 210 });
  document.restore();
};

const getColumnWidths = (columns, width) => {
  const weights = columns.map((column) => Number(column.weight) || 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (width * weight) / totalWeight);
};

export const renderBrandedPdf = async ({
  organisationName,
  title,
  sectionTitle = title,
  titleFontSize = 14,
  period,
  customer,
  summary = [],
  columns,
  rows,
  landscape = false,
  emptyMessage = "No records are available for this statement."
}) => {
  if (!organisationName) throw new Error("Organisation name is required while generating PDF.");
  const logo = await loadBrandedPdfLogo();

  const layout = landscape ? "landscape" : "portrait";

  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      layout,
      margin: PAGE_PADDING,
      bufferPages: true
    });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    const pageWidth = document.page.width;
    const pageHeight = document.page.height;
    const contentWidth = pageWidth - PAGE_PADDING * 2;
    const bottomLimit = pageHeight - FOOTER_HEIGHT;
    const tableWidth = contentWidth;
    const columnWidths = getColumnWidths(columns, tableWidth);
    let y = 0;

    const drawFooter = (pageNumber, pageCount) => {
      document.moveTo(PAGE_PADDING, pageHeight - 44)
        .lineTo(pageWidth - PAGE_PADDING, pageHeight - 44)
        .lineWidth(1)
        .strokeColor("#e2e8f0")
        .stroke();
      document.font("Helvetica").fontSize(7).fillColor(MUTED)
        .text(`${companyFooter()} · Confidential`, PAGE_PADDING, pageHeight - 34, {
          width: contentWidth - 70,
          lineBreak: false,
          ellipsis: true
        });
      document.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - PAGE_PADDING - 70, pageHeight - 34, {
        width: 70,
        align: "right",
        lineBreak: false
      });
    };

    const drawTableHeader = () => {
      const headerHeight = 24;
      document.save();
      document.fillColor("#f1f5f9").rect(PAGE_PADDING, y, tableWidth, headerHeight).fill();
      document.restore();
      let x = PAGE_PADDING;
      document.font("Helvetica-Bold").fontSize(7.5).fillColor(INK);
      columns.forEach((column, index) => {
        document.text(column.label, x + 4, y + 7, {
          width: columnWidths[index] - 8,
          height: headerHeight - 8,
          align: column.align || "left",
          lineBreak: false,
          ellipsis: true
        });
        x += columnWidths[index];
      });
      y += headerHeight;
      document.moveTo(PAGE_PADDING, y).lineTo(PAGE_PADDING + tableWidth, y)
        .lineWidth(0.6).strokeColor("#cbd5e1").stroke();
    };

    const startContinuationPage = () => {
      document.addPage();
      drawBrandedPdfPageHeader(document, logo, title, {
        companyName: organisationName,
        titleFontSize
      });
      y = 102;
      drawTableHeader();
    };

    drawBrandedPdfPageHeader(document, logo, title, {
      companyName: organisationName,
      titleFontSize
    });
    y = 101;
    document.font("Helvetica-Bold").fontSize(10).fillColor(RED)
      .text(sectionTitle.toUpperCase(), PAGE_PADDING, y);
    y += 17;
    document.font("Helvetica").fontSize(8.5).fillColor(MUTED);
    document.text(`Organisation: ${organisationName}`, PAGE_PADDING, y, { width: contentWidth * 0.62 });
    document.text(`Generated: ${new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata"
    }).format(new Date())}`, PAGE_PADDING + contentWidth * 0.62, y, {
      width: contentWidth * 0.38,
      align: "right"
    });
    y += 14;

    if (period) {
      document.text(`Period: ${period}`, PAGE_PADDING, y, { width: contentWidth });
      y += 14;
    }

    if (customer) {
      document.fillColor(INK).font("Helvetica-Bold").fontSize(8.5)
        .text(`Customer: ${displayValue(customer.name)}  ·  Customer ID: ${displayValue(customer.id)}${customer.code ? `  ·  Code: ${displayValue(customer.code)}` : ""}`, PAGE_PADDING, y, {
          width: contentWidth
        });
      y += 14;
      if (customer.email || customer.phone) {
        document.font("Helvetica").fontSize(8).fillColor(MUTED)
          .text([customer.email, customer.phone].filter(Boolean).join("  ·  "), PAGE_PADDING, y, {
            width: contentWidth
          });
        y += 13;
      }
    }

    if (summary.length) {
      const summaryColumns = 2;
      const summaryColumnWidth = contentWidth / summaryColumns;
      summary.forEach((item, index) => {
        if (index % summaryColumns === 0) {
          if (y + 22 > bottomLimit) {
            document.addPage();
            drawBrandedPdfPageHeader(document, logo, title, {
              companyName: organisationName,
              titleFontSize
            });
            y = 102;
            document.font("Helvetica-Bold").fontSize(9).fillColor(RED)
              .text("FINANCIAL SUMMARY (CONTINUED)", PAGE_PADDING, y);
            y += 16;
          }
          y += 5;
        }
        const x = PAGE_PADDING + (index % summaryColumns) * summaryColumnWidth;
        document.font("Helvetica").fontSize(8).fillColor(MUTED)
          .text(`${item.label}:`, x, y, { width: summaryColumnWidth * 0.55 });
        document.font("Helvetica-Bold").fontSize(8).fillColor(INK)
          .text(displayValue(item.value), x + summaryColumnWidth * 0.55, y, {
            width: summaryColumnWidth * 0.43,
            align: "right",
            lineBreak: false,
            ellipsis: true
          });
        if (index % summaryColumns === summaryColumns - 1 || index === summary.length - 1) y += 14;
      });
    }

    if (y + 31 > bottomLimit) {
      document.addPage();
      drawBrandedPdfPageHeader(document, logo, title, {
        companyName: organisationName,
        titleFontSize
      });
      y = 102;
    }
    y += 7;
    drawTableHeader();

    if (!rows.length) {
      document.font("Helvetica").fontSize(9).fillColor(MUTED)
        .text(emptyMessage, PAGE_PADDING + 4, y + 12, { width: contentWidth - 8 });
    } else {
      rows.forEach((row, rowIndex) => {
        const cellTexts = columns.map((column) => displayValue(row[column.key]));
        document.font("Helvetica").fontSize(7.5);
        const rowHeight = Math.max(22, ...cellTexts.map((text, index) =>
          document.heightOfString(text, {
            width: Math.max(10, columnWidths[index] - 8),
            lineGap: 1
          }) + 8
        ));
        if (y + rowHeight > bottomLimit) startContinuationPage();
        const actualHeight = Math.max(22, ...cellTexts.map((text, index) =>
          document.heightOfString(text, {
            width: Math.max(10, columnWidths[index] - 8),
            lineGap: 1
          }) + 8
        ));
        let x = PAGE_PADDING;
        document.font("Helvetica").fontSize(7.5).fillColor(INK);
        cellTexts.forEach((text, index) => {
          document.text(text, x + 4, y + 5, {
            width: columnWidths[index] - 8,
            height: actualHeight - 6,
            align: columns[index].align || "left",
            lineGap: 1,
            ellipsis: true
          });
          x += columnWidths[index];
        });
        y += actualHeight;
        document.moveTo(PAGE_PADDING, y).lineTo(PAGE_PADDING + tableWidth, y)
          .lineWidth(0.35).strokeColor(rowIndex % 2 ? "#f1f5f9" : "#e2e8f0").stroke();
      });
    }

    const range = document.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      document.switchToPage(index);
      drawFooter(index + 1, range.count);
    }
    document.end();
  });
};

export const loadBrandedOrganisationName = async (organisationId) => {
  const organisation = await prisma.organisation.findUnique({
    where: { id: organisationId },
    select: { name: true }
  });
  if (!organisation) throw new Error("Organisation not found while generating PDF.");
  return organisation.name;
};
