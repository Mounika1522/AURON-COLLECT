import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapCustomer,
  mapInvoice,
  mapReceipt,
  mapTask,
  mapPromise,
  mapDispute,
  mapCreditAdjustment,
  mapCommunication,
  mapReminder,
} from './backend-data.js';

test('maps backend financial records without inventing calculated invoice balances', () => {
  const invoice = mapInvoice({
    id: 'invoice-1',
    invoiceNumber: 'INV-1',
    customerId: 'customer-1',
    customer: { name: 'Acme' },
    invoiceDate: '2026-11-01T00:00:00.000Z',
    dueDate: '2026-12-01T00:00:00.000Z',
    subtotal: '100.00',
    tax: '18.00',
    discount: '0.00',
    total: '118.00',
    status: 'ISSUED',
  });

  assert.equal(invoice.invoiceNumber, 'INV-1');
  assert.equal(invoice.invoiceDate, '2026-11-01');
  assert.equal(invoice.totalAmount, 118);
  assert.equal(Object.hasOwn(invoice, 'postedPaid'), false);
  assert.equal(Object.hasOwn(invoice, 'outstanding'), false);
});

test('maps backend receipt status and preserves allocation status', () => {
  const receipt = mapReceipt({
    id: 'receipt-1',
    receiptNumber: 'R-1',
    customerId: 'customer-1',
    customer: { name: 'Acme' },
    receiptDate: '2026-11-02T00:00:00.000Z',
    amount: '50.00',
    currency: 'USD',
    paymentMethod: 'BANK',
    status: 'POSTED',
    allocations: [{
      id: 'allocation-1',
      invoiceId: 'invoice-1',
      amount: '50',
      status: 'POSTED',
      reversedAt: null,
    }],
  });

  assert.equal(receipt.status, 'Posted');
  assert.equal(receipt.currency, 'USD');
  assert.equal(receipt.dateTime, '2026-11-02T00:00:00.000Z');
  assert.equal(receipt.allocations[0].amount, 50);
  assert.equal(receipt.allocations[0].status, 'POSTED');
  assert.equal(receipt.allocations[0].reversedAt, null);
});

test('maps customer, task, promise, dispute, credit and communication records', () => {
  assert.equal(mapCustomer({ id: 'c1', name: 'Acme', riskLevel: 'HIGH' }).riskRating, 'High');
  assert.equal(mapTask({ id: 't1', status: 'IN_PROGRESS', priority: 'CRITICAL' }).status, 'In Progress');
  const promise = mapPromise({
    id: 'p1',
    status: 'BROKEN',
    createdAt: '2026-11-01T10:00:00.000Z',
    invoice: { currency: 'USD' },
  });
  assert.equal(promise.status, 'BROKEN');
  assert.equal(promise.currency, 'USD');
  assert.equal(promise.createdAt, '2026-11-01T10:00:00.000Z');
  assert.equal(mapDispute({ id: 'd1', status: 'UNDER_REVIEW' }).status, 'Under Review');
  assert.equal(mapCreditAdjustment({ id: 'a1', status: 'APPROVED' }).status, 'Approved');
  assert.equal(mapCommunication({ id: 'm1', channel: 'WHATSAPP' }).channel, 'Whatsapp');
  assert.equal(mapReminder({ id: 'r1', status: 'PENDING' }).status, 'Pending');
});
