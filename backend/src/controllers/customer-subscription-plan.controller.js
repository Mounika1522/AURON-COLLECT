import prisma from "../config/prisma.js";
import {
  canActivateCustomerPlan,
  CustomerPlanValidationError,
  normalizeCustomerPlanInput
} from "../services/customer-subscription-plan.service.js";

const planScope = (req) => ({
  organisationId: req.user.organisationId
});

export const requireCustomerPlanManager = (req, res, next) => {
  if (!["ADMIN", "OWNER"].includes(req.user?.role)) {
    return res.status(403).json({
      success: false,
      message: "Only organization admins and owners can manage customer plans."
    });
  }
  return next();
};

const reportError = (res, error, message) => {
  if (error instanceof CustomerPlanValidationError) {
    return res.status(400).json({ success: false, message: error.message });
  }
  if (error.code === "P2002") {
    return res.status(409).json({
      success: false,
      message: "A plan with this code already exists in your organization."
    });
  }
  console.error("Customer subscription plan operation failed:", error.code || error.name);
  return res.status(500).json({ success: false, message });
};

const getOrganizationCustomerTypes = (organisationId) =>
  prisma.customer.findMany({
    where: { organisationId, status: "ACTIVE" },
    distinct: ["type"],
    select: { type: true },
    orderBy: { type: "asc" }
  });

export const getCustomerSubscriptionPlanManagement = async (req, res) => {
  try {
    const { organisationId } = planScope(req);
    const [organizationPlans, customers] = await Promise.all([
      prisma.customerSubscriptionPlan.findMany({
        where: { organisationId },
        orderBy: [{ createdAt: "desc" }]
      }),
      getOrganizationCustomerTypes(organisationId)
    ]);
    return res.status(200).json({
      success: true,
      plans: organizationPlans,
      customerTypes: customers.map(({ type }) => type)
    });
  } catch (error) {
    return reportError(res, error, "Unable to load customer subscription plans.");
  }
};

export const createCustomerSubscriptionPlan = async (req, res) => {
  try {
    const organisationId = req.user.organisationId;
    const customerTypes = await getOrganizationCustomerTypes(organisationId);
    const { data } = normalizeCustomerPlanInput(req.body, {
      customerTypes: customerTypes.map(({ type }) => type)
    });
    if (data.isActive) {
      return res.status(400).json({
        success: false,
        message: "A new plan must receive separate pricing and tax approvals before activation."
      });
    }
    data.organisationId = organisationId;
    data.isActive = false;
    data.pricingProposalStatus = "PENDING_APPROVAL";
    data.taxProposalStatus = "PENDING_APPROVAL";

    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.customerSubscriptionPlan.create({ data });
      await tx.auditLog.create({
        data: {
          organisationId,
          actorUserId: req.user.userId,
          action: "CUSTOMER_SUBSCRIPTION_PLAN_CREATED",
          entityType: "CustomerSubscriptionPlan",
          entityId: created.id,
          metadata: { code: created.code }
        }
      });
      return created;
    });
    return res.status(201).json({ success: true, plan });
  } catch (error) {
    return reportError(res, error, "Unable to create the customer subscription plan.");
  }
};

export const updateCustomerSubscriptionPlan = async (req, res) => {
  try {
    const scope = planScope(req);
    const current = await prisma.customerSubscriptionPlan.findFirst({
      where: { id: req.params.planId, ...scope }
    });
    if (!current) {
      return res.status(404).json({ success: false, message: "Customer plan not found." });
    }
    const customerTypes = await getOrganizationCustomerTypes(scope.organisationId);
    const { data, pricingChanged, taxChanged } = normalizeCustomerPlanInput(req.body, {
      current,
      customerTypes: customerTypes.map(({ type }) => type)
    });
    if (!Object.keys(data).length) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one plan field to update."
      });
    }
    if (pricingChanged) {
      data.pricingProposalStatus = "PENDING_APPROVAL";
      data.pricingApprovedAt = null;
      data.pricingApprovedBy = null;
    }
    if (taxChanged) {
      data.taxProposalStatus = "PENDING_APPROVAL";
      data.taxApprovedAt = null;
      data.taxApprovedBy = null;
    }
    const updatedState = { ...current, ...data };
    if (data.isActive === true && !current.isActive && !canActivateCustomerPlan(updatedState)) {
      return res.status(409).json({
        success: false,
        message: "Approve at least one price and the tax terms before activating this plan."
      });
    }

    const plan = await prisma.$transaction(async (tx) => {
      const updated = await tx.customerSubscriptionPlan.update({
        where: { id: current.id },
        data
      });
      await tx.auditLog.create({
        data: {
          organisationId: scope.organisationId,
          actorUserId: req.user.userId,
          action: current.isActive && data.isActive === false
            ? "CUSTOMER_SUBSCRIPTION_PLAN_DEACTIVATED"
            : "CUSTOMER_SUBSCRIPTION_PLAN_UPDATED",
          entityType: "CustomerSubscriptionPlan",
          entityId: updated.id,
          metadata: {
            pricingProposalStatus: updated.pricingProposalStatus,
            taxProposalStatus: updated.taxProposalStatus,
            isActive: updated.isActive
          }
        }
      });
      return updated;
    });
    return res.status(200).json({ success: true, plan });
  } catch (error) {
    return reportError(res, error, "Unable to update the customer subscription plan.");
  }
};

export const approveCustomerSubscriptionPlanPricing = async (req, res) => {
  if (req.user.role !== "OWNER") {
    return res.status(403).json({
      success: false,
      message: "Only an organization owner can approve customer plan pricing."
    });
  }
  try {
    const scope = planScope(req);
    const plan = await prisma.$transaction(async (tx) => {
      const current = await tx.customerSubscriptionPlan.findFirst({
        where: { id: req.params.planId, ...scope }
      });
      if (!current) return null;
      if (current.pricingProposalStatus !== "PENDING_APPROVAL") {
        const error = new Error("Pricing has no pending proposal to approve.");
        error.status = 409;
        throw error;
      }
      const proposalHasPrice = [
        current.proposedMonthlyPrice,
        current.proposedQuarterlyPrice,
        current.proposedHalfYearlyPrice,
        current.proposedYearlyPrice
      ].some((price) => Number(price) > 0);
      if (!proposalHasPrice) {
        const error = new Error("Add at least one positive cycle price before approval.");
        error.status = 409;
        throw error;
      }
      const updated = await tx.customerSubscriptionPlan.update({
        where: { id: current.id },
        data: {
          monthlyPrice: current.proposedMonthlyPrice,
          quarterlyPrice: current.proposedQuarterlyPrice,
          halfYearlyPrice: current.proposedHalfYearlyPrice,
          yearlyPrice: current.proposedYearlyPrice,
          pricingStatus: "APPROVED",
          pricingProposalStatus: "APPROVED",
          pricingApprovedAt: new Date(),
          pricingApprovedBy: req.user.userId
        }
      });
      await tx.auditLog.create({
        data: {
          organisationId: scope.organisationId,
          actorUserId: req.user.userId,
          action: "CUSTOMER_SUBSCRIPTION_PLAN_PRICING_APPROVED",
          entityType: "CustomerSubscriptionPlan",
          entityId: current.id,
          metadata: { currency: current.currency }
        }
      });
      return updated;
    });
    if (!plan) {
      return res.status(404).json({ success: false, message: "Customer plan not found." });
    }
    return res.status(200).json({ success: true, plan });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return reportError(res, error, "Unable to approve customer plan pricing.");
  }
};

export const approveCustomerSubscriptionPlanTax = async (req, res) => {
  if (req.user.role !== "OWNER") {
    return res.status(403).json({
      success: false,
      message: "Only an organization owner can approve customer plan tax terms."
    });
  }
  try {
    const scope = planScope(req);
    const plan = await prisma.$transaction(async (tx) => {
      const current = await tx.customerSubscriptionPlan.findFirst({
        where: { id: req.params.planId, ...scope }
      });
      if (!current) return null;
      const approvedTerms = current.proposedTaxTerms?.trim();
      if (
        current.taxProposalStatus !== "PENDING_APPROVAL" ||
        !approvedTerms
      ) {
        const error = new Error("A non-empty pending tax proposal is required for approval.");
        error.status = 409;
        throw error;
      }
      const updated = await tx.customerSubscriptionPlan.update({
        where: { id: current.id },
        data: {
          taxTerms: approvedTerms,
          taxTermsStatus: "APPROVED",
          taxProposalStatus: "APPROVED",
          taxApprovedAt: new Date(),
          taxApprovedBy: req.user.userId
        }
      });
      await tx.auditLog.create({
        data: {
          organisationId: scope.organisationId,
          actorUserId: req.user.userId,
          action: "CUSTOMER_SUBSCRIPTION_PLAN_TAX_APPROVED",
          entityType: "CustomerSubscriptionPlan",
          entityId: current.id
        }
      });
      return updated;
    });
    if (!plan) {
      return res.status(404).json({ success: false, message: "Customer plan not found." });
    }
    return res.status(200).json({ success: true, plan });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return reportError(res, error, "Unable to approve customer plan tax terms.");
  }
};
