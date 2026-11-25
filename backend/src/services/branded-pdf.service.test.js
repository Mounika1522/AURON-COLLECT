import assert from "node:assert/strict";
import test from "node:test";
import { renderBrandedPdf } from "./branded-pdf.service.js";

test("branded statement PDFs paginate long reports and include empty reports", async () => {
  const rows = Array.from({ length: 120 }, (_, index) => ({
    date: "25 Nov 2026",
    reference: `TX-${index + 1}`,
    description: `Ledger transaction ${index + 1} with a description that wraps cleanly across table columns.`,
    debit: "INR 125.00",
    credit: "INR 0.00",
    balance: `INR ${(index + 125).toFixed(2)}`
  }));
  const options = {
    organisationName: "Example Organisation",
    title: "Customer Statement",
    period: "1 Nov 2026 to 25 Nov 2026",
    customer: { id: "customer-1", code: "C-100", name: "Example Customer" },
    summary: [{ label: "Closing outstanding", value: "INR 125.00" }],
    columns: [
      { key: "date", label: "Date", weight: 0.9 },
      { key: "reference", label: "Transaction ID", weight: 1.25 },
      { key: "description", label: "Description", weight: 2.8 },
      { key: "debit", label: "Debit", weight: 1, align: "right" },
      { key: "credit", label: "Credit", weight: 1, align: "right" },
      { key: "balance", label: "Balance", weight: 1.15, align: "right" }
    ]
  };
  const paginatedPdf = await renderBrandedPdf({ ...options, rows });
  const emptyPdf = await renderBrandedPdf({ ...options, rows: [] });
  const pageCount = (pdf) =>
    (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;

  assert.equal(paginatedPdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pageCount(paginatedPdf) > 1);
  assert.equal(emptyPdf.subarray(0, 5).toString("ascii"), "%PDF-");
});
