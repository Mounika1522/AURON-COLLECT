const ORGANISATION_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "OWNER"]);

export class DashboardAccessError extends Error {
  constructor() {
    super("You do not have permission to access this data.");
    this.name = "DashboardAccessError";
    this.statusCode = 403;
  }
}

export const getDashboardDataAccess = (user) => {
  const role = String(user?.role || "").toUpperCase();
  const organisationId = user?.organisationId;
  const userId = user?.userId;
  const assignedExecutive = String(user?.name || "").trim();

  if (
    !organisationId ||
    !userId ||
    (!ORGANISATION_ROLES.has(role) && role !== "USER") ||
    (role === "USER" && !assignedExecutive)
  ) {
    throw new DashboardAccessError();
  }

  return {
    role,
    organisationId,
    userId,
    assignedExecutive: role === "USER" ? assignedExecutive : null,
    canViewOrganisation: role !== "USER",
  };
};

const withScope = (where, scope) => ({
  AND: [where || {}, scope],
});

export const buildInvoiceDataScope = (access) =>
  ({
    organisationId: access.organisationId,
    customer: { organisationId: access.organisationId },
    ...(access.assignedExecutive
      ? { assignedExecutive: access.assignedExecutive }
      : {}),
  });

export const buildInvoiceDataWhere = (access, where = {}) =>
  withScope(where, buildInvoiceDataScope(access));

export const buildCustomerDataWhere = (access, where = {}) => {
  const scope = { organisationId: access.organisationId };
  if (access.assignedExecutive) {
    scope.OR = [
      {
        invoices: {
          some: {
            organisationId: access.organisationId,
            assignedExecutive: access.assignedExecutive,
          },
        },
      },
      {
        tasks: {
          some: {
            organisationId: access.organisationId,
            assignedExecutive: access.assignedExecutive,
          },
        },
      },
    ];
  }
  return withScope(where, scope);
};

export const buildTaskDataWhere = (access, where = {}) =>
  withScope(where, {
    organisationId: access.organisationId,
    customer: { organisationId: access.organisationId },
    ...(access.assignedExecutive
      ? {
          assignedExecutive: access.assignedExecutive,
          OR: [
            { invoiceId: null },
            {
              invoice: {
                organisationId: access.organisationId,
                assignedExecutive: access.assignedExecutive,
              },
            },
          ],
        }
      : {}),
  });

export const buildCommunicationDataWhere = (access, where = {}) => {
  const scope = {
    organisationId: access.organisationId,
    customer: buildCustomerDataWhere(access),
  };
  if (access.assignedExecutive) {
    scope.OR = [
      { invoiceId: null },
      {
        invoice: {
          organisationId: access.organisationId,
          assignedExecutive: access.assignedExecutive,
        },
      },
    ];
  }
  return withScope(where, scope);
};

export const buildReminderDataWhere = (access, where = {}) => {
  const scope = {
    organisationId: access.organisationId,
    customer: buildCustomerDataWhere(access),
  };
  if (access.assignedExecutive) {
    scope.OR = [
      { invoiceId: null },
      {
        invoice: {
          organisationId: access.organisationId,
          customer: { organisationId: access.organisationId },
          assignedExecutive: access.assignedExecutive,
        },
      },
    ];
  }
  return withScope(where, scope);
};

export const buildPromiseDataWhere = (access, where = {}) => {
  const scope = {
    organisationId: access.organisationId,
    customer: { organisationId: access.organisationId },
  };
  if (access.assignedExecutive) {
    scope.invoice = {
      organisationId: access.organisationId,
      assignedExecutive: access.assignedExecutive,
    };
    scope.OR = [
      { taskId: null },
      {
        task: {
          organisationId: access.organisationId,
          assignedExecutive: access.assignedExecutive,
        },
      },
    ];
  }
  return withScope(where, scope);
};

export const buildDisputeDataWhere = (access, where = {}) => {
  const scope = {
    organisationId: access.organisationId,
    customer: { organisationId: access.organisationId },
  };
  if (access.assignedExecutive) {
    scope.invoice = {
      organisationId: access.organisationId,
      assignedExecutive: access.assignedExecutive,
    };
  }
  return withScope(where, scope);
};

export const buildReceiptDataWhere = (access, where = {}) => {
  const scope = {
    organisationId: access.organisationId,
    customer: { organisationId: access.organisationId },
  };
  if (access.assignedExecutive) {
    const assignedAllocation = {
      organisationId: access.organisationId,
      invoice: {
        organisationId: access.organisationId,
        customer: { organisationId: access.organisationId },
        assignedExecutive: access.assignedExecutive,
      },
    };
    scope.OR = [
      { allocations: { none: {} } },
      {
        AND: [
          { allocations: { some: assignedAllocation } },
          { allocations: { every: assignedAllocation } },
        ],
      },
    ];
  }
  return withScope(where, scope);
};

export const buildReceiptAllocationDataWhere = (access, where = {}) =>
  withScope(where, {
    organisationId: access.organisationId,
    receipt: buildReceiptDataWhere(access),
    invoice: {
      organisationId: access.organisationId,
      customer: { organisationId: access.organisationId },
      ...(access.assignedExecutive
        ? { assignedExecutive: access.assignedExecutive }
        : {}),
    },
  });

export const buildCreditAdjustmentDataWhere = (access, where = {}) => {
  const scope = {
    organisationId: access.organisationId,
    invoice: {
      organisationId: access.organisationId,
      customer: { organisationId: access.organisationId },
      ...(access.assignedExecutive
        ? { assignedExecutive: access.assignedExecutive }
        : {}),
    },
  };
  return withScope(where, scope);
};
