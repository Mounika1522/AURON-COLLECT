import prisma from "../config/prisma.js";
import {
  getOfficialSubscriptionPlanCodes,
  projectSubscriptionPlanForCatalog
} from "../services/official-subscription-plans.js";
import {
  assertRazorpayTestMode,
  createRazorpayClient,
  getRazorpayConfigurationStatus
} from "../services/razorpay.service.js";
import {
  createCustomerOrganizationBillingOrder,
  verifyCustomerOrganizationBillingPayment
} from "../services/customer-organization-subscription.service.js";
import {
  amountInPaise,
  getCurrentSubscriptionForOrganisation
} from "../services/subscription-billing.service.js";
import {
  getOrganizationSubscriptionReceiptPdf,
  sendOrganizationSubscriptionReceiptEmail
} from "../services/organization-subscription-receipt.service.js";

const publicPlan = (record) => {
  const plan = projectSubscriptionPlanForCatalog(record);
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    monthlyPrice: plan.monthlyPrice == null ? null : Number(plan.monthlyPrice),
    yearlyPrice: null,
    currency: plan.currency,
    isActive: true,
    isBuiltIn: true,
    maxUsers: plan.maxUsers,
    maxCustomers: plan.maxCustomers,
    maxInvoicesPerMonth: plan.maxInvoicesPerMonth,
    limitsStatus: plan.limitsStatus
  };
};

const publicSubscription = (subscription) => subscription
  ? {
      id: subscription.id,
      status: subscription.status,
      billingCycle: subscription.billingCycle,
      startsAt: subscription.startsAt,
      endsAt: subscription.endsAt,
      plan: { code: subscription.plan.code, name: subscription.plan.name }
    }
  : null;

const testBillingConfiguration = (env = process.env) => {
  const configuration = getRazorpayConfigurationStatus(env);
  return {
    available: configuration.available && configuration.mode === "test",
    mode: configuration.available && configuration.mode === "test"
      ? "test"
      : null
  };
};

export const getCustomerOrganizationSubscription = async (req, res) => {
  const organisationId = req.customer.organisationId;
  try {
    const [planRecords, currentSubscription, scheduled, payments] = await Promise.all([
      prisma.subscriptionPlan.findMany({
        where: { code: { in: getOfficialSubscriptionPlanCodes() } },
        orderBy: { createdAt: "asc" }
      }),
      getCurrentSubscriptionForOrganisation(prisma, organisationId),
      prisma.subscription.findFirst({
        where: {
          organisationId,
          status: "SCHEDULED",
          startsAt: { gt: new Date() }
        },
        include: { plan: { select: { code: true, name: true } } },
        orderBy: { startsAt: "asc" }
      }),
      prisma.billingPayment.findMany({
        where: { organisationId },
        select: {
          id: true,
          status: true,
          planName: true,
          billingCycle: true,
          amount: true,
          currency: true,
          effectiveAt: true,
          periodEndsAt: true,
          paidAt: true,
          createdAt: true,
          razorpayPaymentId: true,
          plan: { select: { code: true, name: true } },
          invoice: { select: { id: true, invoiceNumber: true } }
        },
        orderBy: { createdAt: "desc" },
        take: 20
      })
    ]);

    return res.status(200).json({
      success: true,
      plans: planRecords.map(publicPlan),
      billingConfiguration: testBillingConfiguration(),
      currentSubscription: publicSubscription(currentSubscription),
      scheduledSubscription: publicSubscription(scheduled),
      payments: payments.map((payment) => ({
        ...payment,
        amount: Number(payment.amount)
      }))
    });
  } catch (error) {
    console.error("Customer organization subscription query failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load organization subscription details."
    });
  }
};

export const createCustomerOrganizationSubscriptionOrder = async (req, res) => {
  const planCode =
    typeof req.body?.planCode === "string"
      ? req.body.planCode.trim().toUpperCase()
      : "";
  const billingCycle =
    typeof req.body?.billingCycle === "string"
      ? req.body.billingCycle.trim().toUpperCase()
      : "";
  const idempotencyKey = req.get("Idempotency-Key");

  try {
    const result = await createCustomerOrganizationBillingOrder({
      organisationId: req.customer.organisationId,
      customerId: req.customer.customerId,
      planCode,
      billingCycle,
      idempotencyKey
    });
    const payment = result.payment;
    return res.status(result.existing ? 200 : 201).json({
      success: true,
      alreadyPaid: result.alreadyPaid,
      paymentId: payment.id,
      orderId: payment.razorpayOrderId,
      keyId: process.env.RAZORPAY_KEY_ID,
      amount: amountInPaise(payment.amount),
      currency: payment.currency,
      planName: payment.plan.name,
      billingCycle: payment.billingCycle,
      effectiveAt: payment.effectiveAt
    });
  } catch (error) {
    if (error.code === "RAZORPAY_TEST_MODE_UNAVAILABLE" ||
        error.code === "RAZORPAY_CONFIGURATION_UNAVAILABLE") {
      return res.status(503).json({
        success: false,
        message: "Razorpay Test Mode is not configured."
      });
    }
    const status = {
      CUSTOMER_ORGANIZATION_PLAN_INVALID: 400,
      BILLING_IDEMPOTENCY_CONFLICT: 409,
      BILLING_ORDER_PENDING: 409,
      BILLING_PLAN_CHANGE_SCHEDULED: 409,
      PLAN_NOT_PURCHASABLE: 409,
      PLAN_CYCLE_UNAVAILABLE: 409,
      P2002: 409,
      P2034: 409
    }[error.code];
    if (status) {
      return res.status(status).json({
        success: false,
        message: error.code === "BILLING_ORDER_PENDING"
          ? error.message
          : "The requested subscription checkout could not be created."
      });
    }
    console.error("Customer organization subscription order failed:", error.code || error.name);
    return res.status(502).json({
      success: false,
      message: "Unable to create the subscription checkout."
    });
  }
};

export const verifyCustomerOrganizationSubscriptionOrder = async (req, res) => {
  const {
    paymentId: billingPaymentId,
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature
  } = req.body || {};
  if (
    typeof billingPaymentId !== "string" ||
    typeof orderId !== "string" ||
    typeof paymentId !== "string" ||
    typeof signature !== "string"
  ) {
    return res.status(400).json({
      success: false,
      message: "The payment verification response is incomplete."
    });
  }

  try {
    const payment = await prisma.billingPayment.findFirst({
      where: {
        id: billingPaymentId,
        organisationId: req.customer.organisationId,
        customerId: req.customer.customerId,
        razorpayOrderId: orderId
      }
    });
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Billing order not found."
      });
    }

    assertRazorpayTestMode();
    const razorpay = createRazorpayClient();
    const result = await verifyCustomerOrganizationBillingPayment({
      payment,
      orderId,
      paymentId,
      signature
    }, {
      fetchProviderPayment: (providerPaymentId) =>
        razorpay.payments.fetch(providerPaymentId),
      runTransaction: (callback) => prisma.$transaction(callback)
    });

    if (result.status === "INVALID_SIGNATURE") {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed."
      });
    }
    if (result.status === "PENDING") {
      return res.status(202).json({
        success: true,
        status: "PENDING",
        message: "Payment is awaiting provider confirmation."
      });
    }
    if (!["PAID", "ALREADY_PAID"].includes(result.status)) {
      return res.status(409).json({
        success: false,
        message: "The confirmed payment does not match this subscription order."
      });
    }

    let receiptEmailStatus = "FAILED";
    try {
      const email = await sendOrganizationSubscriptionReceiptEmail(payment.id);
      receiptEmailStatus = email.status;
    } catch (error) {
      console.error("Customer organization receipt email failed:", error.code || error.name);
    }

    return res.status(200).json({
      success: true,
      status: "PAID",
      receiptEmailStatus,
      subscription: result.payment?.subscription || null,
      invoice: result.payment?.invoice
        ? {
            id: result.payment.invoice.id,
            invoiceNumber: result.payment.invoice.invoiceNumber
          }
        : undefined
    });
  } catch (error) {
    if (error.code === "RAZORPAY_TEST_MODE_UNAVAILABLE" ||
        error.code === "RAZORPAY_CONFIGURATION_UNAVAILABLE") {
      return res.status(503).json({
        success: false,
        message: "Razorpay Test Mode is not configured."
      });
    }
    console.error("Customer organization payment verification failed:", error.code || error.name);
    return res.status(502).json({
      success: false,
      message: "Unable to verify the payment with Razorpay."
    });
  }
};

export const downloadCustomerOrganizationSubscriptionReceipt = async (req, res) => {
  try {
    const receipt = await getOrganizationSubscriptionReceiptPdf(
      req.params.paymentId,
      req.customer.organisationId
    );
    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: "Subscription receipt not found."
      });
    }
    const safeReference = receipt.invoiceNumber.replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="AURON-COLLECT-Subscription-Receipt-${safeReference}.pdf"`
    );
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(receipt.pdfBytes);
  } catch (error) {
    console.error("Customer organization receipt PDF failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to prepare the subscription receipt."
    });
  }
};
