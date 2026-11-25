import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreditAdjustmentDataWhere,
  buildCommunicationDataWhere,
  buildCustomerDataWhere,
  buildDisputeDataWhere,
  buildInvoiceDataWhere,
  buildPromiseDataWhere,
  buildReceiptDataWhere,
  buildReceiptAllocationDataWhere,
  buildReminderDataWhere,
  buildTaskDataWhere,
  DashboardAccessError,
  getDashboardDataAccess,
} from "./dashboard-access.service.js";

const user = (role, overrides = {}) => ({
  userId: "user-1",
  organisationId: "org-1",
  name: "Alex Morgan",
  role,
  ...overrides,
});

test("existing administrator roles stay organization-wide but never cross the authenticated tenant", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "OWNER"]) {
    const access = getDashboardDataAccess(user(role));
    assert.equal(access.canViewOrganisation, true);
    assert.deepEqual(
      buildInvoiceDataWhere(access, { organisationId: "org-2" }),
      {
        AND: [
          { organisationId: "org-2" },
          {
            organisationId: "org-1",
            customer: { organisationId: "org-1" },
          },
        ],
      },
    );
  }
});

test("staff invoice scopes enforce authenticated organization and exact executive assignment", () => {
  const access = getDashboardDataAccess(user("USER"));
  const where = buildInvoiceDataWhere(access, {
    organisationId: "org-2",
    assignedExecutive: "Jordan Lee",
  });

  assert.deepEqual(where, {
    AND: [
      { organisationId: "org-2", assignedExecutive: "Jordan Lee" },
      {
        organisationId: "org-1",
        customer: { organisationId: "org-1" },
        assignedExecutive: "Alex Morgan",
      },
    ],
  });
});

test("staff can access only customers linked to their assigned invoices or tasks", () => {
  const access = getDashboardDataAccess(user("USER"));
  const where = buildCustomerDataWhere(access, { id: "customer-1" });

  assert.deepEqual(where, {
    AND: [
      { id: "customer-1" },
      {
        organisationId: "org-1",
        OR: [
          {
            invoices: {
              some: {
                organisationId: "org-1",
                assignedExecutive: "Alex Morgan",
              },
            },
          },
          {
            tasks: {
              some: {
                organisationId: "org-1",
                assignedExecutive: "Alex Morgan",
              },
            },
          },
        ],
      },
    ],
  });
});

test("staff scopes tasks, promises, disputes, receipts, and adjustments through their assignments", () => {
  const access = getDashboardDataAccess(user("USER"));

  assert.deepEqual(buildTaskDataWhere(access, { status: "PENDING" }), {
    AND: [
      { status: "PENDING" },
      {
        organisationId: "org-1",
        customer: { organisationId: "org-1" },
        assignedExecutive: "Alex Morgan",
        OR: [
          { invoiceId: null },
          {
            invoice: {
              organisationId: "org-1",
              assignedExecutive: "Alex Morgan",
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(buildPromiseDataWhere(access), {
    AND: [
      {},
      {
        organisationId: "org-1",
        customer: { organisationId: "org-1" },
        invoice: {
          organisationId: "org-1",
          assignedExecutive: "Alex Morgan",
        },
        OR: [
          { taskId: null },
          {
            task: {
              organisationId: "org-1",
              assignedExecutive: "Alex Morgan",
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(buildDisputeDataWhere(access), {
    AND: [
      {},
      {
        organisationId: "org-1",
        customer: { organisationId: "org-1" },
        invoice: {
          organisationId: "org-1",
          assignedExecutive: "Alex Morgan",
        },
      },
    ],
  });

  assert.deepEqual(buildReceiptDataWhere(access), {
    AND: [
      {},
      {
        organisationId: "org-1",
        customer: { organisationId: "org-1" },
        OR: [
          { allocations: { none: {} } },
          {
            AND: [
              {
                allocations: {
                  some: {
                    organisationId: "org-1",
                    invoice: {
                      organisationId: "org-1",
                      customer: { organisationId: "org-1" },
                      assignedExecutive: "Alex Morgan",
                    },
                  },
                },
              },
              {
                allocations: {
                  every: {
                    organisationId: "org-1",
                    invoice: {
                      organisationId: "org-1",
                      customer: { organisationId: "org-1" },
                      assignedExecutive: "Alex Morgan",
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(buildReceiptAllocationDataWhere(access), {
    AND: [
      {},
      {
        organisationId: "org-1",
        receipt: buildReceiptDataWhere(access),
        invoice: {
          organisationId: "org-1",
          customer: { organisationId: "org-1" },
          assignedExecutive: "Alex Morgan",
        },
      },
    ],
  });

  assert.deepEqual(buildCommunicationDataWhere(access, { channel: "EMAIL" }), {
    AND: [
      { channel: "EMAIL" },
      {
        organisationId: "org-1",
        customer: buildCustomerDataWhere(access),
        OR: [
          { invoiceId: null },
          {
            invoice: {
              organisationId: "org-1",
              assignedExecutive: "Alex Morgan",
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(buildReminderDataWhere(access, { channel: "EMAIL" }).AND[1].OR, [
    { invoiceId: null },
    {
      invoice: {
        organisationId: "org-1",
        customer: { organisationId: "org-1" },
        assignedExecutive: "Alex Morgan",
      },
    },
  ]);

  assert.deepEqual(buildCreditAdjustmentDataWhere(access), {
    AND: [
      {},
      {
        organisationId: "org-1",
        invoice: {
          organisationId: "org-1",
          customer: { organisationId: "org-1" },
          assignedExecutive: "Alex Morgan",
        },
      },
    ],
  });
});

test("unknown roles and staff without an authenticated allocation identity are denied", () => {
  assert.throws(
    () => getDashboardDataAccess(user("FINANCE_MANAGER")),
    DashboardAccessError,
  );
  assert.throws(
    () => getDashboardDataAccess(user("USER", { name: " " })),
    DashboardAccessError,
  );
  assert.throws(
    () => getDashboardDataAccess(user("ADMIN", { organisationId: null })),
    DashboardAccessError,
  );
});
