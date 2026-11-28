import prisma from "../config/prisma.js";
import { getCurrentSubscriptionForOrganisation } from "../services/subscription-billing.service.js";
import {
  getOfficialSubscriptionPlanCodes,
  projectSubscriptionPlanForCatalog
} from "../services/official-subscription-plans.js";
import { getRazorpayConfigurationStatus } from "../services/razorpay.service.js";

const isPlatformAdmin = (req, res) => {
  if (req.user.role !== "SUPER_ADMIN") {
    res.status(403).json({
      success: false,
      message: "Only platform administrators can configure subscription plans"
    });
    return false;
  }
  return true;
};

const isOrganisationAdmin = (req, res) => {
  if (!["ADMIN", "OWNER"].includes(req.user.role)) {
    res.status(403).json({
      success: false,
      message: "Only organisation administrators can view billing"
    });
    return false;
  }
  return true;
};

const approvalFields = [
  "proposedMaxUsers",
  "proposedMaxCustomers",
  "proposedMaxInvoicesPerMonth"
];

const validatePrice = (value, field) => {
  if (value === null) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(\.\d{1,2})?$/.test(String(value))) {
    throw new Error(`${field} must be a positive amount with at most two decimal places, or null`);
  }
  return amount.toFixed(2);
};

const validateLimit = (value, field) => {
  if (value === null) return null;
  if (!Number.isInteger(Number(value)) || Number(value) < 0) {
    throw new Error(`${field} must be a non-negative integer, or null`);
  }
  return Number(value);
};

export const getSubscriptionPlans = async (req, res) => {
  try {
    const records = await prisma.subscriptionPlan.findMany({
      where: {
        OR: [
          { code: { in: getOfficialSubscriptionPlanCodes() } },
          {
            isActive: true,
            pricingStatus: "APPROVED",
            limitsStatus: "APPROVED"
          }
        ]
      },
      orderBy: { createdAt: "asc" }
    });
    const plans = records.map(projectSubscriptionPlanForCatalog);
    return res.status(200).json({
      success: true,
      count: plans.length,
      plans,
      billingConfiguration: getRazorpayConfigurationStatus()
    });
  } catch (error) {
    console.error("Get subscription plans failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscription plans"
    });
  }
};

export const getPlanConfigurations = async (req, res) => {
  if (!isPlatformAdmin(req, res)) return;
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: { createdAt: "asc" }
    });
    return res.status(200).json({ success: true, plans });
  } catch (error) {
    console.error("Get plan configuration failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load plan configuration"
    });
  }
};

export const createSubscriptionPlan = async (req, res) => {
  if (!isPlatformAdmin(req, res)) return;
  try {
    const { name, code, description } = req.body;
    if (
      typeof name !== "string" ||
      typeof code !== "string" ||
      !name.trim() ||
      !/^[a-z0-9_-]{2,40}$/i.test(code.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "A plan name and valid plan code are required"
      });
    }

    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.subscriptionPlan.create({
        data: {
          name: name.trim(),
          code: code.trim().toUpperCase(),
          description:
            typeof description === "string" ? description.trim() || null : null,
          isActive: false,
          pricingStatus: "PENDING_APPROVAL",
          limitsStatus: "PENDING_APPROVAL"
        }
      });
      await tx.auditLog.create({
        data: {
          actorUserId: req.user.userId,
          action: "SUBSCRIPTION_PLAN_CREATED",
          entityType: "SUBSCRIPTION_PLAN",
          entityId: created.id,
          metadata: { planCode: created.code }
        }
      });
      return created;
    });

    return res.status(201).json({
      success: true,
      message: "Plan created as pending management approval",
      plan
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "A plan with that code already exists"
      });
    }
    console.error("Create subscription plan failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to create the subscription plan"
    });
  }
};

export const updatePlanConfiguration = async (req, res) => {
  if (!isPlatformAdmin(req, res)) return;

  const allowedFields = [
    "proposedMonthlyPrice",
    "proposedYearlyPrice",
    ...approvalFields
  ];
  const submittedFields = allowedFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(req.body, field)
  );
  if (!submittedFields.length) {
    return res.status(400).json({
      success: false,
      message: "Provide at least one proposed price or limit"
    });
  }

  try {
    const data = {};
    for (const field of submittedFields) {
      data[field] = field.startsWith("proposed") && field.includes("Price")
        ? validatePrice(req.body[field], field)
        : validateLimit(req.body[field], field);
    }

    if (
      submittedFields.some((field) => field.includes("Price"))
    ) {
      data.pricingProposalStatus = "PENDING_APPROVAL";
    }
    if (submittedFields.some((field) => field.includes("Max"))) {
      data.limitsProposalStatus = "PENDING_APPROVAL";
    }

    const plan = await prisma.$transaction(async (tx) => {
      const current = await tx.subscriptionPlan.findUnique({
        where: { code: req.params.code.toUpperCase() }
      });
      if (!current) return null;

      const updated = await tx.subscriptionPlan.update({
        where: { id: current.id },
        data
      });
      await tx.auditLog.create({
        data: {
          actorUserId: req.user.userId,
          action: "SUBSCRIPTION_PLAN_PROPOSAL_UPDATED",
          entityType: "SUBSCRIPTION_PLAN",
          entityId: updated.id,
          metadata: {
            planCode: updated.code,
            changedFields: submittedFields
          }
        }
      });
      return updated;
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found"
      });
    }
    return res.status(200).json({
      success: true,
      message: "Proposal saved as pending approval",
      plan
    });
  } catch (error) {
    if (error.message.includes("must be")) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Update plan configuration failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to update plan configuration"
    });
  }
};

export const approvePlanConfiguration = async (req, res) => {
  if (!isPlatformAdmin(req, res)) return;
  const { pricingApproved, limitsApproved } = req.body;
  if (pricingApproved !== true && limitsApproved !== true) {
    return res.status(400).json({
      success: false,
      message: "Explicitly approve pricing, limits, or both"
    });
  }

  try {
    const plan = await prisma.$transaction(async (tx) => {
      const current = await tx.subscriptionPlan.findUnique({
        where: { code: req.params.code.toUpperCase() }
      });
      if (!current) return null;

      const data = {};
      if (pricingApproved === true) {
        if (
          (!current.proposedMonthlyPrice ||
            current.proposedMonthlyPrice.isZero()) &&
          (!current.proposedYearlyPrice ||
            current.proposedYearlyPrice.isZero())
        ) {
          const error = new Error("At least one proposed price must be configured");
          error.code = "PRICE_PROPOSAL_REQUIRED";
          throw error;
        }
        data.monthlyPrice = current.proposedMonthlyPrice;
        data.yearlyPrice = current.proposedYearlyPrice;
        data.pricingStatus = "APPROVED";
        data.pricingProposalStatus = "APPROVED";
        data.pricingApprovedAt = new Date();
        data.pricingApprovedBy = req.user.userId;
      }
      if (limitsApproved === true) {
        data.maxUsers = current.proposedMaxUsers;
        data.maxCustomers = current.proposedMaxCustomers;
        data.maxInvoicesPerMonth = current.proposedMaxInvoicesPerMonth;
        data.limitsStatus = "APPROVED";
        data.limitsProposalStatus = "APPROVED";
        data.limitsApprovedAt = new Date();
        data.limitsApprovedBy = req.user.userId;
      }

      const updated = await tx.subscriptionPlan.update({
        where: { id: current.id },
        data: {
          ...data,
          isActive:
            (data.pricingStatus || current.pricingStatus) === "APPROVED" &&
            (data.limitsStatus || current.limitsStatus) === "APPROVED" &&
            Boolean(
              data.monthlyPrice?.gt(0) ||
              data.yearlyPrice?.gt(0) ||
              (!Object.prototype.hasOwnProperty.call(data, "monthlyPrice") &&
                current.monthlyPrice?.gt(0)) ||
              (!Object.prototype.hasOwnProperty.call(data, "yearlyPrice") &&
                current.yearlyPrice?.gt(0))
            )
        }
      });
      await tx.auditLog.create({
        data: {
          actorUserId: req.user.userId,
          action: "SUBSCRIPTION_PLAN_APPROVED",
          entityType: "SUBSCRIPTION_PLAN",
          entityId: updated.id,
          metadata: {
            planCode: updated.code,
            pricingApproved: pricingApproved === true,
            limitsApproved: limitsApproved === true,
            purchasable: updated.isActive
          }
        }
      });
      return updated;
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found"
      });
    }
    return res.status(200).json({
      success: true,
      message: plan.isActive
        ? "Plan configuration approved and available for purchase"
        : "Approval saved; the plan remains unavailable until both pricing and limits are approved",
      plan
    });
  } catch (error) {
    if (error.code === "PRICE_PROPOSAL_REQUIRED") {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Approve subscription plan failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to approve plan configuration"
    });
  }
};

export const getCurrentSubscription = async (req, res) => {
  if (!isOrganisationAdmin(req, res)) return;
  try {
    const subscription = await getCurrentSubscriptionForOrganisation(
      prisma,
      req.user.organisationId
    );
    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "No active subscription found"
      });
    }
    const publicSubscription = { ...subscription };
    delete publicSubscription.razorpayCustomerId;
    delete publicSubscription.razorpayTokenId;
    delete publicSubscription.razorpaySubscriptionId;
    return res.status(200).json({
      success: true,
      subscription: publicSubscription,
      nextRenewalAt: subscription.nextRenewalDate || subscription.endsAt
    });
  } catch (error) {
    console.error("Get current subscription failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch current subscription"
    });
  }
};

export const getSubscriptionUsage = async (req, res) => {
  if (!isOrganisationAdmin(req, res)) return;
  try {
    const organisationId = req.user.organisationId;
    const subscription = await getCurrentSubscriptionForOrganisation(
      prisma,
      organisationId
    );
    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "No active subscription found"
      });
    }

    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );
    const [users, customers, monthlyInvoices] = await Promise.all([
      prisma.user.count({ where: { organisationId } }),
      prisma.customer.count({ where: { organisationId } }),
      prisma.invoice.count({
        where: { organisationId, createdAt: { gte: monthStart } }
      })
    ]);

    const approved = subscription.plan.limitsStatus === "APPROVED";
    const makeUsage = (used, limit) => ({
      used,
      limit: approved ? limit : null,
      remaining:
        !approved || limit === null ? null : Math.max(0, limit - used),
      unlimited: approved && limit === null,
      limitReached: approved && limit !== null && used >= limit,
      configured: approved
    });

    return res.status(200).json({
      success: true,
      plan: subscription.plan.name,
      billingCycle: subscription.billingCycle,
      usage: {
        users: makeUsage(users, subscription.plan.maxUsers),
        customers: makeUsage(customers, subscription.plan.maxCustomers),
        monthlyInvoices: makeUsage(
          monthlyInvoices,
          subscription.plan.maxInvoicesPerMonth
        )
      }
    });
  } catch (error) {
    console.error("Get subscription usage failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscription usage"
    });
  }
};
