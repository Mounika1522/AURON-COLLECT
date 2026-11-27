import PDFDocument from "pdfkit";
import {
  drawBrandedPdfPageHeader,
  loadBrandedPdfLogo
} from "./branded-pdf.service.js";

export const getCustomerReceiptPdfFilename = (receiptNumber) =>
  `AURON-COLLECT-Payment-Receipt-${String(receiptNumber || "receipt").replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;

export const buildCustomerReceiptPdf = async (receipt) => {
  if (!receipt || receipt.status !== "POSTED") {
    throw new Error("Only posted receipts can be rendered for customer delivery.");
  }

  const document = new PDFDocument({ size: "A4", margin: 48 });
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));
  const pdf = new Promise((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  const logo = await loadBrandedPdfLogo();
  drawBrandedPdfPageHeader(document, logo, "Payment Receipt", { titleFontSize: 16 });

  document.moveDown().font("Helvetica-Bold").fontSize(10).fillColor("#e50914").text("RECEIPT DETAILS", 48, 91);
  const row = (label, value, y) => {
    document.font("Helvetica").fontSize(9).fillColor("#64748b").text(label, 48, y, { width: 150 });
    document.font("Helvetica").fontSize(10).fillColor("#111827").text(String(value ?? "—"), 205, y, { width: 340 });
  };
  row("Receipt number", receipt.receiptNumber, 116);
  row("Customer", receipt.customer.name, 138);
  row("Email", receipt.customer.email, 160);
  row("Phone", receipt.customer.phone, 182);
  row("Billing address", receipt.customer.billingAddress, 204);
  row("Customer tax registration", receipt.customer.taxRegistration, 226);
  row("Payment date", receipt.receiptDate.toISOString().slice(0, 10), 248);
  row("Payment method", receipt.paymentMethod, 270);
  row("Transaction reference", receipt.transactionReference || "—", 292);
  row("Status", receipt.status, 314);

  document.moveTo(48, 344).lineTo(547, 344).lineWidth(1).strokeColor("#e2e8f0").stroke();
  document.font("Helvetica-Bold").fontSize(10).fillColor("#e50914").text("INVOICE ALLOCATIONS", 48, 358);
  let y = 384;
  for (const allocation of receipt.allocations) {
    if (y > 710) {
      document.addPage();
      y = 55;
    }
    document.font("Helvetica-Bold").fontSize(9).fillColor("#111827")
      .text(allocation.invoice.invoiceNumber, 48, y);
    document.font("Helvetica").fontSize(9).fillColor("#111827")
      .text(`${receipt.currency} ${Number(allocation.amount).toFixed(2)}`, 360, y, { width: 180, align: "right" });
    y += 17;
    document.font("Helvetica").fontSize(8).fillColor("#64748b")
      .text(`Subtotal ${allocation.invoice.currency} ${Number(allocation.invoice.subtotal).toFixed(2)} · Tax ${allocation.invoice.currency} ${Number(allocation.invoice.tax).toFixed(2)} · Invoice total ${allocation.invoice.currency} ${Number(allocation.invoice.total).toFixed(2)}`, 48, y, { width: 490 });
    y += 20;
  }
  if (receipt.allocations.length === 0) {
    document.font("Helvetica").fontSize(9).fillColor("#64748b").text("No invoice allocation is recorded for this receipt.", 48, y);
    y += 20;
  }
  document.moveTo(48, y + 3).lineTo(547, y + 3).lineWidth(1).strokeColor("#e2e8f0").stroke();
  document.font("Helvetica").fontSize(9).fillColor("#64748b").text("AMOUNT RECEIVED", 48, y + 18);
  document.font("Helvetica-Bold").fontSize(16).fillColor("#111827")
    .text(`${receipt.currency} ${Number(receipt.amount).toFixed(2)}`, 205, y + 14);
  document.moveTo(48, 756).lineTo(547, 756).lineWidth(1).strokeColor("#e2e8f0").stroke();
  const footer = [
    process.env.COMPANY_BILLING_ADDRESS || "Alpha Auron Private Limited",
    process.env.COMPANY_GSTIN ? `GSTIN: ${process.env.COMPANY_GSTIN}` : null
  ].filter(Boolean).join(" · ");
  document.font("Helvetica").fontSize(8).fillColor("#64748b").text(
    `${footer} · Generated from verified account records`,
    48,
    768,
    { width: 490 }
  );
  document.end();

  return pdf;
};
