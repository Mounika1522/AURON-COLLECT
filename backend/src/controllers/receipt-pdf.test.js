import assert from "node:assert/strict";
import test from "node:test";
import { buildReceiptAllocationSummary } from "./receipt.controller.js";

test("receipt PDF allocation rows group invoice allocations and calculate remaining balances", () => {
  const invoice = {
    invoiceNumber: "INV-100",
    total: "100.00",
    allocations: [{ amount: "30.00" }, { amount: "35.00" }],
    creditAdjustments: [{ amount: "5.00" }]
  };
  const summary = buildReceiptAllocationSummary([
    { invoiceId: "invoice-1", invoice, amount: "25.00" },
    { invoiceId: "invoice-1", invoice, amount: "10.00" }
  ]);

  assert.equal(summary.totalAllocated.toFixed(2), "35.00");
  assert.deepEqual(summary.rows, [{
    reference: "INV-100",
    allocated: "35.00",
    outstanding: "30.00"
  }]);
});

test("receipt PDF allocation rows never show negative outstanding balances", () => {
  const summary = buildReceiptAllocationSummary([{
    invoiceId: "invoice-2",
    amount: "20.00",
    invoice: {
      invoiceNumber: "INV-200",
      total: "20.00",
      allocations: [{ amount: "25.00" }],
      creditAdjustments: []
    }
  }]);

  assert.equal(summary.rows[0].outstanding, "0.00");
});
