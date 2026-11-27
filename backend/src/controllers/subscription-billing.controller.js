import PDFDocument from "pdfkit";
import prisma from "../config/prisma.js";
import {
  assertRazorpayConfiguration,
  createRazorpayClient,
  verifyPaymentSignature,
  verifyWebhookSignature
} from "../services/razorpay.service.js";
import {
  amountInPaise,
  createBillingOrderRecord,
  recordCapturedPayment,
  writeBillingOrderCreatedAudit
} from "../services/subscription-billing.service.js";
import {
  sendOrganizationSubscriptionReceiptEmail
} from "../services/organization-subscription-receipt.service.js";

const isOrganisationAdmin = (req, res) => {
  if (!["ADMIN", "OWNER"].includes(req.user.role)) {
    res.status(403).json({
      success: false,
      message: "Only organisation administrators can manage billing"
    });
    return false;
  }
  return true;
};

const isBillingConfigurationError = (error) =>
  error.code === "RAZORPAY_CONFIGURATION_UNAVAILABLE";

const sendBillingReceiptSafely = async (paymentId) => {
  try {
    return await sendOrganizationSubscriptionReceiptEmail(paymentId);
  } catch (error) {
    console.error("Subscription receipt email failed:", error.code || error.name);
    return { status: "FAILED" };
  }
};

export const createSubscriptionOrder = async (req, res) => {
  if (!isOrganisationAdmin(req, res)) return;

  const planCode =
    typeof req.body.planCode === "string"
      ? req.body.planCode.trim().toUpperCase()
      : "";
  const billingCycle =
    typeof req.body.billingCycle === "string"
      ? req.body.billingCycle.trim().toUpperCase()
      : "";
  const idempotencyKey = req.get("Idempotency-Key");

  if (
    !planCode ||
    !["MONTHLY", "YEARLY"].includes(billingCycle) ||
    typeof idempotencyKey !== "string" ||
    !/^[a-zA-Z0-9._:-]{16,80}$/.test(idempotencyKey)
  ) {
    return res.status(400).json({
      success: false,
      message: "A plan, billing cycle, and valid Idempotency-Key are required"
    });
  }

  let razorpay;
  try {
    assertRazorpayConfiguration();
    razorpay = createRazorpayClient();
  } catch (error) {
    if (isBillingConfigurationError(error)) {
      return res.status(503).json({
        success: false,
        message: "Razorpay billing is not configured for this environment"
      });
    }
    throw error;
  }

  let orderRecord;
  try {
    orderRecord = await createBillingOrderRecord(
      req.user.organisationId,
      req.user.userId,
      planCode,
      billingCycle,
      idempotencyKey
    );
  } catch (error) {
    const status = {
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
          : "The requested billing order could not be created"
      });
    }
    console.error("Create subscription order failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to create the billing order"
    });
  }

  const payment = orderRecord.existing || orderRecord.record;
  if (!orderRecord.existing) {
    try {
      const gatewayOrder = await razorpay.orders.create({
        amount: amountInPaise(payment.amount),
        currency: payment.currency,
        receipt: payment.id,
        notes: {
          billingPaymentId: payment.id,
          planCode: payment.plan.code
        }
      });

      if (
        !gatewayOrder?.id ||
        gatewayOrder.amount !== amountInPaise(payment.amount) ||
        gatewayOrder.currency !== payment.currency
      ) {
        throw new Error("Gateway order response did not match billing record");
      }

      await prisma.$transaction(async (tx) => {
        const updated = await tx.billingPayment.updateMany({
          where: { id: payment.id, status: "CREATING" },
          data: { status: "CREATED", razorpayOrderId: gatewayOrder.id }
        });
        if (updated.count !== 1) {
          throw new Error("Billing order state changed unexpectedly");
        }
        await writeBillingOrderCreatedAudit(tx, payment);
      });

      payment.status = "CREATED";
      payment.razorpayOrderId = gatewayOrder.id;
    } catch (error) {
      await prisma.$transaction(async (tx) => {
        await tx.billingPayment.updateMany({
          where: { id: payment.id, status: "CREATING" },
          data: { status: "FAILED", errorCode: "ORDER_CREATION_FAILED" }
        });
        await tx.auditLog.create({
          data: {
            organisationId: payment.organisationId,
            actorUserId: payment.createdBy,
            action: "SUBSCRIPTION_ORDER_CREATION_FAILED",
            entityType: "BILLING_PAYMENT",
            entityId: payment.id,
            metadata: { errorCode: "ORDER_CREATION_FAILED" }
          }
        });
      });
      console.error("Razorpay order creation failed:", error.code || error.name);
      return res.status(502).json({
        success: false,
        message: "The payment order could not be created"
      });
    }
  }

  return res.status(orderRecord.existing ? 200 : 201).json({
    success: true,
    paymentId: payment.id,
    orderId: payment.razorpayOrderId,
    keyId: process.env.RAZORPAY_KEY_ID,
    amount: amountInPaise(payment.amount),
    currency: payment.currency,
    planName: payment.plan.name,
    billingCycle: payment.billingCycle,
    effectiveAt: payment.effectiveAt
  });
};

export const verifySubscriptionPayment = async (req, res) => {
  if (!isOrganisationAdmin(req, res)) return;

  const {
    billingPaymentId,
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature
  } = req.body;

  if (
    typeof billingPaymentId !== "string" ||
    typeof orderId !== "string" ||
    typeof paymentId !== "string" ||
    typeof signature !== "string"
  ) {
    return res.status(400).json({
      success: false,
      message: "The payment verification details are incomplete"
    });
  }

  let gateway;
  try {
    assertRazorpayConfiguration();
    gateway = createRazorpayClient();
  } catch (error) {
    if (isBillingConfigurationError(error)) {
      return res.status(503).json({
        success: false,
        message: "Razorpay billing is not configured for this environment"
      });
    }
    throw error;
  }

  if (!verifyPaymentSignature(orderId, paymentId, signature)) {
    return res.status(400).json({
      success: false,
      message: "Payment signature verification failed"
    });
  }

  const payment = await prisma.billingPayment.findFirst({
    where: {
      id: billingPaymentId,
      organisationId: req.user.organisationId,
      razorpayOrderId: orderId
    }
  });
  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Billing order not found"
    });
  }

  try {
    const gatewayPayment = await gateway.payments.fetch(paymentId);
    if (gatewayPayment.order_id !== orderId || gatewayPayment.id !== paymentId) {
      return res.status(400).json({
        success: false,
        message: "Payment does not match the billing order"
      });
    }

    const result = await prisma.$transaction((tx) =>
      recordCapturedPayment(tx, payment, gatewayPayment)
    );

    if (!["PAID", "ALREADY_PAID"].includes(result.status)) {
      return res.status(409).json({
        success: false,
        message: "The payment has not been captured for this billing order"
      });
    }
    const receiptEmail = await sendBillingReceiptSafely(payment.id);

    return res.status(200).json({
      success: true,
      message: "Subscription payment verified",
      subscription: result.payment.subscription,
      receiptEmailStatus: receiptEmail.status,
      invoice: result.payment.invoice
        ? {
            id: result.payment.invoice.id,
            invoiceNumber: result.payment.invoice.invoiceNumber
          }
        : undefined
    });
  } catch (error) {
    console.error("Subscription payment verification failed:", error.code || error.name);
    return res.status(502).json({
      success: false,
      message: "Unable to verify the payment with the payment provider"
    });
  }
};

export const getBillingHistory = async (req, res) => {
  if (!isOrganisationAdmin(req, res)) return;
  try {
    const invoices = await prisma.billingInvoice.findMany({
      where: { organisationId: req.user.organisationId },
      select: {
        id: true,
        invoiceNumber: true,
        planName: true,
        billingCycle: true,
        amount: true,
        currency: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" }
    });
    return res.status(200).json({ success: true, invoices });
  } catch (error) {
    console.error("Billing history query failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load billing history"
    });
  }
};

const renderInvoicePdf = (invoice) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(20).text("Auron Collect", { continued: false });
    doc.moveDown(0.5).fontSize(16).text("Subscription invoice");
    doc.moveDown();
    doc.fontSize(10).text(`Billed to: ${invoice.organisation.name}`);
    doc.fontSize(10).text(`Invoice number: ${invoice.invoiceNumber}`);
    doc.text(`Invoice date: ${invoice.createdAt.toISOString().slice(0, 10)}`);
    doc.text(`Plan: ${invoice.planName}`);
    doc.text(`Billing cycle: ${invoice.billingCycle.toLowerCase()}`);
    doc.text(
      `Service period: ${invoice.periodStart.toISOString().slice(0, 10)} to ${invoice.periodEnd.toISOString().slice(0, 10)}`
    );
    doc.moveDown();
    doc.text(`Amount charged: ${invoice.currency} ${invoice.amount.toFixed(2)}`);
    doc.moveDown(0.5).fontSize(9).text(
      "No tax calculation is included; the amount shown is the amount charged."
    );
    doc.end();
  });

export const downloadBillingInvoice = async (req, res) => {
  if (!isOrganisationAdmin(req, res)) return;
  try {
    const invoice = await prisma.billingInvoice.findFirst({
      where: {
        id: req.params.id,
        organisationId: req.user.organisationId
      },
      include: { organisation: { select: { name: true } } }
    });
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Billing invoice not found"
      });
    }

    const pdf = await renderInvoicePdf(invoice);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${invoice.invoiceNumber}.pdf"`
    );
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(pdf);
  } catch (error) {
    console.error("Billing invoice PDF failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to download the billing invoice"
    });
  }
};

export const createRazorpayWebhookHandler = ({
  db = prisma,
  env = process.env,
  sendReceipt = sendBillingReceiptSafely
} = {}) => async (req, res) => {
  try {
    assertRazorpayConfiguration(env);
  } catch (error) {
    if (isBillingConfigurationError(error)) {
      return res.status(503).json({
        success: false,
        message: "Razorpay billing is not configured for this environment"
      });
    }
    throw error;
  }

  const signature = req.get("X-Razorpay-Signature");
  const providerEventId = req.get("X-Razorpay-Event-Id");
  if (
    !providerEventId ||
    providerEventId.length > 255 ||
    !verifyWebhookSignature(req.body, signature, env.RAZORPAY_WEBHOOK_SECRET)
  ) {
    return res.status(401).json({
      success: false,
      message: "Webhook signature verification failed"
    });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({
      success: false,
      message: "Invalid webhook payload"
    });
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const eventType =
        typeof payload.event === "string" ? payload.event : "unknown";
      const gatewayPayment =
        payload.payload?.payment?.entity || null;
      const isCapturedEvent =
        eventType === "payment.captured" &&
        gatewayPayment?.status === "captured" &&
        typeof gatewayPayment.order_id === "string";

      const payment = typeof gatewayPayment?.order_id === "string"
        ? await tx.billingPayment.findFirst({
            where: { razorpayOrderId: gatewayPayment.order_id }
          })
        : null;
      const event = await tx.razorpayWebhookEvent.create({
        data: {
          providerEventId,
          eventType,
          organisationId: payment?.organisationId,
          billingPaymentId: payment?.id,
          status: payment ? "RECEIVED" : "IGNORED"
        }
      });

      if (!payment) {
        await tx.razorpayWebhookEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date() }
        });
        return { status: "IGNORED" };
      }

      if (!isCapturedEvent) {
        await tx.auditLog.create({
          data: {
            organisationId: payment.organisationId,
            action: "SUBSCRIPTION_PAYMENT_EVENT_RECORDED",
            entityType: "BILLING_PAYMENT",
            entityId: payment.id,
            metadata: { eventType }
          }
        });
        await tx.razorpayWebhookEvent.update({
          where: { id: event.id },
          data: { status: "IGNORED", processedAt: new Date() }
        });
        return { status: "IGNORED", paymentId: payment.id };
      }

      const capture = await recordCapturedPayment(tx, payment, gatewayPayment);
      await tx.razorpayWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: ["PAID", "ALREADY_PAID"].includes(capture.status)
            ? "PROCESSED"
            : "REJECTED",
          errorCode: ["PAID", "ALREADY_PAID"].includes(capture.status)
            ? null
            : "BILLING_PAYMENT_MISMATCH",
          processedAt: new Date()
        }
      });
      if (!["PAID", "ALREADY_PAID"].includes(capture.status)) {
        await tx.auditLog.create({
          data: {
            organisationId: payment.organisationId,
            action: "SUBSCRIPTION_PAYMENT_EVENT_REJECTED",
            entityType: "BILLING_PAYMENT",
            entityId: payment.id,
            metadata: {
              eventType,
              errorCode: "BILLING_PAYMENT_MISMATCH"
            }
          }
        });
      }
      return { status: capture.status, paymentId: payment.id };
    });
    if (["PAID", "ALREADY_PAID"].includes(result.status)) {
      await sendReceipt(result.paymentId);
    }
    return res.status(200).json({
      success: true,
      duplicate: false,
      status: result.status
    });
  } catch (error) {
    if (error.code === "P2002") {
      const existingEvent = await db.razorpayWebhookEvent.findUnique({
        where: { providerEventId },
        select: { status: true, billingPaymentId: true }
      });
      if (existingEvent?.status === "PROCESSED" && existingEvent.billingPaymentId) {
        await sendReceipt(existingEvent.billingPaymentId);
      }
      return res.status(200).json({
        success: true,
        duplicate: true
      });
    }
    console.error("Razorpay webhook processing failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Webhook processing failed"
    });
  }
};

export const handleRazorpayWebhook = createRazorpayWebhookHandler();

