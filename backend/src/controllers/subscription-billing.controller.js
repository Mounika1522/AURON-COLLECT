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
import { buildTokenizedCheckoutOptions } from "../services/subscription-auto-renewal.service.js";
import {
  sendOrganizationSubscriptionReceiptEmail
} from "../services/organization-subscription-receipt.service.js";
import { markRenewalFailed } from "../services/subscription-auto-renewal.scheduler.js";
import { atAsiaKolkataRenewalTime } from "../services/subscription-auto-renewal.service.js";

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
      idempotencyKey,
      prisma,
      { autoRenewRequested: req.body?.autoRenew === true }
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
      let razorpayCustomerId = payment.razorpayCustomerId;
      if (payment.autoRenewRequested && !razorpayCustomerId) {
        const contact =
          typeof req.body?.contact === "string" ? req.body.contact.trim() : "";
        if (!/^[+\d][\d\s().-]{6,19}$/.test(contact)) {
          const error = new Error("A billing phone number is required for auto-renew.");
          error.code = "BILLING_AUTORENEW_PHONE_REQUIRED";
          throw error;
        }
        const providerCustomer = await razorpay.customers.create({
          name: req.user.name,
          email: req.user.email,
          contact,
          fail_existing: "0",
          notes: { organisationId: payment.organisationId }
        });
        if (typeof providerCustomer?.id !== "string" || !providerCustomer.id) {
          throw new Error("Razorpay did not return a customer ID");
        }
        razorpayCustomerId = providerCustomer.id;
        await prisma.billingPayment.update({
          where: { id: payment.id },
          data: { razorpayCustomerId }
        });
      }

      const amount = amountInPaise(payment.amount);
      const orderRequest = payment.autoRenewRequested
        ? buildTokenizedCheckoutOptions({
            amount,
            currency: payment.currency,
            customerId: razorpayCustomerId,
            receipt: payment.id,
            notes: {
              billingPaymentId: payment.id,
              planCode: payment.plan.code
            }
          })
        : {
            amount,
            currency: payment.currency,
            receipt: payment.id,
            notes: {
              billingPaymentId: payment.id,
              planCode: payment.plan.code
            }
          };
      const gatewayOrder = await razorpay.orders.create(orderRequest);

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
      payment.razorpayCustomerId = razorpayCustomerId;
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
    customerId: payment.razorpayCustomerId,
    autoRenewRequested: payment.autoRenewRequested,
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
    if (error.code === "BILLING_AUTORENEW_PHONE_REQUIRED") {
      return res.status(400).json({
        success: false,
        message: "Enter a valid billing phone number to enable auto-renew."
      });
    }
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
      const token = payload.payload?.token?.entity || null;
      const providerSubscription = payload.payload?.subscription?.entity || null;
      const isSubscriptionLifecycleEvent = [
        "subscription.charged",
        "subscription.cancelled",
        "subscription.paused"
      ].includes(eventType);
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
          status: payment || token || providerSubscription ? "RECEIVED" : "IGNORED"
        }
      });

      if (eventType.startsWith("token.") && token?.id && token?.customer_id) {
        const tokenData = {
          razorpayTokenId: token.id,
          paymentMethod: token.method || null
        };
        if (eventType === "token.confirmed") {
          await tx.billingPayment.updateMany({
            where: {
              razorpayCustomerId: token.customer_id,
              autoRenewRequested: true,
              status: { in: ["CREATING", "CREATED", "PAID"] }
            },
            data: tokenData
          });
          const subscriptions = await tx.subscription.findMany({
            where: {
              razorpayCustomerId: token.customer_id,
              autoRenewRequested: true,
              status: { in: ["ACTIVE", "SCHEDULED"] }
            },
            select: { id: true, endsAt: true }
          });
          for (const subscription of subscriptions) {
            await tx.subscription.update({
              where: { id: subscription.id },
              data: {
                ...tokenData,
                autoRenew: true,
                nextRenewalDate: subscription.endsAt
                  ? atAsiaKolkataRenewalTime(subscription.endsAt)
                  : null,
                lastRenewalStatus: "SCHEDULED"
              }
            });
          }
        } else if (["token.cancelled", "token.paused"].includes(eventType)) {
          await tx.subscription.updateMany({
            where: {
              razorpayCustomerId: token.customer_id,
              autoRenew: true
            },
            data: {
              autoRenew: false,
              nextRenewalDate: null,
              lastRenewalStatus: eventType === "token.paused" ? "PAUSED" : "CANCELLED"
            }
          });
        }
        await tx.razorpayWebhookEvent.update({
          where: { id: event.id },
          data: { status: "PROCESSED", processedAt: new Date() }
        });
        return { status: "PROCESSED" };
      }

      if (isSubscriptionLifecycleEvent && providerSubscription?.id) {
        const localSubscription = await tx.subscription.findFirst({
          where: { razorpaySubscriptionId: providerSubscription.id }
        });
        if (localSubscription) {
          const subscriptionData = eventType === "subscription.charged"
            ? {
                lastRenewalStatus: "PAID",
                renewalAttempts: 0
              }
            : {
                autoRenew: false,
                autoRenewRequested: false,
                nextRenewalDate: null,
                lastRenewalStatus: eventType === "subscription.paused"
                  ? "PAUSED"
                  : "CANCELLED"
              };
          await tx.subscription.update({
            where: { id: localSubscription.id },
            data: subscriptionData
          });
        }
        await tx.razorpayWebhookEvent.update({
          where: { id: event.id },
          data: { status: localSubscription ? "PROCESSED" : "IGNORED", processedAt: new Date() }
        });
        return { status: localSubscription ? "PROCESSED" : "IGNORED" };
      }

      if (!payment) {
        await tx.razorpayWebhookEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date() }
        });
        return { status: "IGNORED" };
      }

      if (eventType === "payment.failed") {
        const isRenewal = Boolean(payment.renewalSourceSubscriptionId);
        if (!isRenewal) {
          await tx.billingPayment.updateMany({
            where: { id: payment.id, status: { in: ["CREATING", "CREATED"] } },
            data: { status: "FAILED", errorCode: "PAYMENT_FAILED" }
          });
        }
        await tx.razorpayWebhookEvent.update({
          where: { id: event.id },
          data: { status: "PROCESSED", processedAt: new Date() }
        });
        return {
          status: "PROCESSED",
          failedRenewal: isRenewal ? payment : null
        };
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
    if (result.failedRenewal) {
      await markRenewalFailed("organization", result.failedRenewal, new Date(), db);
    }
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

export const enableOrganizationAutoRenew = async (req, res) => {
  if (!isOrganisationAdmin(req, res)) return;
  try {
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: req.params.id,
        organisationId: req.user.organisationId,
        status: "ACTIVE"
      }
    });
    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "An active organization subscription was not found."
      });
    }

    const hasConfirmedToken = Boolean(
      subscription.razorpayCustomerId && subscription.razorpayTokenId
    );
    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        autoRenew: hasConfirmedToken,
        autoRenewRequested: true,
        nextRenewalDate: hasConfirmedToken
          ? atAsiaKolkataRenewalTime(subscription.endsAt)
          : null,
        lastRenewalStatus: hasConfirmedToken ? "SCHEDULED" : "TOKEN_PENDING",
        renewalAttempts: 0
      }
    });
    await prisma.auditLog.create({
      data: {
        organisationId: req.user.organisationId,
        actorUserId: req.user.userId,
        action: "ORGANIZATION_SUBSCRIPTION_AUTO_RENEW_ENABLED",
        entityType: "Subscription",
        entityId: updated.id,
        metadata: { active: hasConfirmedToken }
      }
    });
    return res.status(200).json({
      success: true,
      autoRenew: updated.autoRenew,
      autoRenewRequested: updated.autoRenewRequested,
      nextRenewalDate: updated.nextRenewalDate,
      message: hasConfirmedToken
        ? "Auto-renew is enabled."
        : "Auto-renew will activate after your next regular checkout saves a payment method."
    });
  } catch (error) {
    console.error("Organization auto-renew enable failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to enable auto-renew."
    });
  }
};

export const disableOrganizationAutoRenew = async (req, res) => {
  if (!isOrganisationAdmin(req, res)) return;
  try {
    const result = await prisma.subscription.updateMany({
      where: {
        id: req.params.id,
        organisationId: req.user.organisationId,
        status: { in: ["ACTIVE", "SCHEDULED", "PAST_DUE"] }
      },
      data: {
        autoRenew: false,
        autoRenewRequested: false,
        nextRenewalDate: null,
        lastRenewalStatus: "DISABLED"
      }
    });
    if (result.count !== 1) {
      return res.status(404).json({
        success: false,
        message: "The organization subscription was not found."
      });
    }
    await prisma.auditLog.create({
      data: {
        organisationId: req.user.organisationId,
        actorUserId: req.user.userId,
        action: "ORGANIZATION_SUBSCRIPTION_AUTO_RENEW_DISABLED",
        entityType: "Subscription",
        entityId: req.params.id
      }
    });
    return res.status(200).json({
      success: true,
      autoRenew: false,
      autoRenewRequested: false,
      message: "Auto-renew has been disabled."
    });
  } catch (error) {
    console.error("Organization auto-renew disable failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to disable auto-renew."
    });
  }
};

export const handleRazorpayWebhook = createRazorpayWebhookHandler();

