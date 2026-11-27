import { randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../config/prisma.js";
import {
  CUSTOMER_BILLING_CYCLES,
  addCustomerBillingPeriod,
  amountInPaise,
  assertCustomerSubscriptionTestMode,
  createCustomerRazorpayClient,
  getCustomerPlanPrice,
  isCustomerPlanEligibleForType,
  isCustomerPlanPurchasableForCycle,
  recordCapturedCustomerPayment,
  verifyCustomerSubscriptionPayment,
  verifyCustomerWebhookSignature
} from "../services/customer-subscription.service.js";
import { settleDueCustomerSubscriptions } from "../services/customer-subscription.scheduler.js";
import {
  finalizeCustomerSubscriptionReceipt,
  isStoredReceiptPdfValid,
  sendCustomerSubscriptionReceiptEmail
} from "../services/customer-subscription-receipt.service.js";

const logoPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../public/auron-logo.png");
const companyFooter = () => [
  process.env.COMPANY_BILLING_ADDRESS || "Alpha Auron Private Limited",
  process.env.COMPANY_GSTIN ? `GSTIN: ${process.env.COMPANY_GSTIN}` : null
].filter(Boolean).join(" · ");

const scopeFor = (customer) => ({
  organisationId: customer.organisationId,
  customerId: customer.customerId
});

const publicPayment = (payment) => ({
  id: payment.id,
  planId: payment.planId,
  status: payment.status,
  amount: Number(payment.amount),
  currency: payment.currency,
  planName: payment.planName,
  billingCycle: payment.billingCycle,
  periodStart: payment.periodStart,
  periodEnd: payment.periodEnd,
  paidAt: payment.paidAt,
  paymentMethod: payment.paymentMethod,
  razorpayPaymentId: payment.razorpayPaymentId,
  razorpayOrderId: payment.razorpayOrderId,
  invoice: payment.invoice
    ? { id: payment.invoice.id, invoiceNumber: payment.invoice.invoiceNumber }
    : null,
  receipt: payment.receipt
    ? { id: payment.receipt.id, receiptNumber: payment.receipt.receiptNumber }
    : null,
  createdAt: payment.createdAt
});

const publicSubscription = (subscription) => ({
  id: subscription.id,
  status: subscription.status,
  billingCycle: subscription.billingCycle,
  startsAt: subscription.startsAt,
  renewalAt: subscription.renewalAt,
  expiresAt: subscription.endsAt,
  cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  plan: {
    id: subscription.plan.id,
    name: subscription.plan.name,
    description: subscription.plan.description
  }
});

const isTestCheckoutAvailable = () => {
  try {
    assertCustomerSubscriptionTestMode();
    return true;
  } catch {
    return false;
  }
};

const billingDate = (value) => value
  ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value))
  : "—";

const billingCycleLabel = (cycle) => ({
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly"
}[cycle] || cycle || "—");

const money = (value, currency) => {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      minimumFractionDigits: 2
    }).format(Number(value));
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`;
  }
};

export const renderBillingPdf = async ({ title, reference, customer, payment, invoice, payments }) => {
  const logo = await readFile(logoPath);
  return new Promise((resolve, reject) => {
      const document = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
      const chunks = [];
      document.on("data", (chunk) => chunks.push(chunk));
      document.on("error", reject);
      document.on("end", () => resolve(Buffer.concat(chunks)));

      document.save();
      document.fillColor("#e50914").rect(0, 0, 595.28, 8).fill();
      document.restore();
      document.image(logo, 48, 28, { fit: [54, 46] });
      document.fillColor("#111827").font("Helvetica-Bold").fontSize(16)
        .text("ALPHA AURON", 116, 35);
      document.fillColor("#64748b").font("Helvetica").fontSize(8)
        .text("ALPHA AURON PRIVATE LIMITED", 116, 56);
      document.fillColor("#111827").font("Helvetica-Bold").fontSize(18)
        .text(title.toUpperCase(), 330, 39, { width: 215, align: "right" });
      document.moveTo(48, 88).lineTo(547, 88).lineWidth(1).strokeColor("#e2e8f0").stroke();

      const watermarkWidth = 210;
      document.save();
      document.opacity(0.055);
      document.image(logo, (595.28 - watermarkWidth) / 2, 282, { width: watermarkWidth });
      document.restore();

      document.fillColor("#64748b").font("Helvetica").fontSize(9)
        .text("DOCUMENT REFERENCE", 48, 108);
      document.fillColor("#111827").font("Helvetica-Bold").fontSize(12)
        .text(reference || "—", 48, 123);
      document.fillColor("#64748b").font("Helvetica").fontSize(9)
        .text("ISSUED", 330, 108);
      document.fillColor("#111827").font("Helvetica-Bold").fontSize(10)
        .text(billingDate(invoice?.createdAt || payment?.createdAt), 330, 123);

      let y = 164;
      const section = (heading) => {
        document.fillColor("#e50914").font("Helvetica-Bold").fontSize(9)
          .text(heading.toUpperCase(), 48, y);
        y += 20;
      };
      const row = (label, value) => {
        if (y > 710) {
          document.addPage();
          y = 55;
        }
        document.fillColor("#64748b").font("Helvetica").fontSize(9)
          .text(label, 48, y, { width: 150 });
        document.fillColor("#111827").font("Helvetica").fontSize(10)
          .text(String(value ?? "—"), 205, y, { width: 340 });
        y += 21;
      };

      section("Billed to");
      row("Customer", customer?.name || "Customer");
      row("Email", customer?.email || "—");
      row("Phone", customer?.phone || "—");
      row("Billing address", customer?.billingAddress || "—");
      if (customer?.taxRegistration) row("Customer tax registration", customer.taxRegistration);

      if (payments) {
        section("Transactions");
        for (const transaction of payments) {
          row("Plan / billing cycle", `${transaction.planName} / ${billingCycleLabel(transaction.billingCycle)}`);
          row("Status / date", `${transaction.status} / ${billingDate(transaction.paidAt || transaction.createdAt)}`);
          row("Amount", money(transaction.amount, transaction.currency));
          row("Razorpay reference", transaction.razorpayPaymentId || transaction.razorpayOrderId || "—");
        }
      } else {
        section("Subscription");
        row("Plan", payment?.planName || invoice?.planName || "—");
        row("Billing cycle", billingCycleLabel(payment?.billingCycle || invoice?.billingCycle));
        row("Service period", `${billingDate(payment?.periodStart || invoice?.periodStart)} - ${billingDate(payment?.periodEnd || invoice?.periodEnd)}`);

        section("Payment");
        row("Payment status", payment?.status || "PAID");
        row("Payment date", billingDate(payment?.paidAt || payment?.createdAt));
        row("Payment method", payment?.paymentMethod || "—");
        row("Razorpay payment reference", payment?.razorpayPaymentId || "—");
        row("Razorpay order reference", payment?.razorpayOrderId || "—");
      }

      if (y > 700) {
        document.addPage();
        y = 55;
      }
      document.moveTo(48, y + 3).lineTo(547, y + 3).lineWidth(1).strokeColor("#e2e8f0").stroke();
      y += 20;
      document.fillColor("#64748b").font("Helvetica").fontSize(9).text("TOTAL AMOUNT", 48, y);
      const historyTotals = payments
        ? Object.entries(payments.reduce((totals, item) => {
            if (item.status === "PAID") {
              totals[item.currency] = (totals[item.currency] || 0) + Number(item.amount);
            }
            return totals;
          }, {}))
        : null;
      const totalText = historyTotals
        ? historyTotals.map(([currency, value]) => money(value, currency)).join(" · ") || money(0, "INR")
        : money(payment?.amount ?? invoice?.amount, payment?.currency || invoice?.currency || "INR");
      document.fillColor("#111827").font("Helvetica-Bold").fontSize(17)
        .text(totalText, 205, y - 3, { width: 340 });
      y += 30;
      if (!payments && (invoice?.taxTerms || payment?.taxTerms)) {
        document.fillColor("#64748b").font("Helvetica").fontSize(8)
          .text(`Tax terms: ${invoice?.taxTerms || payment?.taxTerms}. The amount shown is the charged amount; no tax amount is inferred.`, 48, y, { width: 490 });
        y += 30;
      }

      document.moveTo(48, 756).lineTo(547, 756).lineWidth(1).strokeColor("#e2e8f0").stroke();
      document.fillColor("#64748b").font("Helvetica").fontSize(8)
        .text(`${companyFooter()} · Generated from verified billing records`, 48, 768, { width: 370 });
      if (process.env.COMPANY_SUPPORT_EMAIL) {
        document.text(process.env.COMPANY_SUPPORT_EMAIL, 400, 768, { width: 147, align: "right" });
      }
      document.end();
  });
};

const sendBillingPdf = async (res, filename, data) => {
  const pdf = await renderBillingPdf(data);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).send(pdf);
};

const finalizeCapturedReceipt = async (paymentId, req) => {
  const origin =
    process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`;
  const receipt = await finalizeCustomerSubscriptionReceipt(paymentId, origin);
  if (!isStoredReceiptPdfValid(receipt)) {
    throw new Error("Verified payment receipt could not be finalized.");
  }

  try {
    const delivery = await sendCustomerSubscriptionReceiptEmail(receipt.id);
    return { receipt, emailStatus: delivery.status };
  } catch (error) {
    console.error("Payment receipt email tracking failed:", error.code || error.name);
    return { receipt, emailStatus: "FAILED" };
  }
};

const toErrorCode = (error) =>
  /^[A-Z0-9_]{1,80}$/.test(error?.code || "") ? error.code : "PROVIDER_ERROR";

export const getCustomerSubscriptions = async (req, res) => {
  try {
    await settleDueCustomerSubscriptions();
    const where = scopeFor(req.customer);
    const [plans, subscriptions, payments] = await Promise.all([
      prisma.customerSubscriptionPlan.findMany({
        where: {
          organisationId: where.organisationId,
          isActive: true,
          pricingStatus: "APPROVED",
          pricingProposalStatus: "APPROVED",
          taxTermsStatus: "APPROVED",
          taxProposalStatus: "APPROVED",
          taxTerms: { not: null }
        },
        orderBy: { name: "asc" }
      }),
      prisma.customerSubscription.findMany({
        where,
        include: { plan: { select: { id: true, name: true, description: true } } },
        orderBy: [{ createdAt: "desc" }],
        take: 50
      }),
      prisma.customerSubscriptionPayment.findMany({
        where,
        include: {
          invoice: { select: { id: true, invoiceNumber: true } },
          receipt: { select: { id: true, receiptNumber: true } }
        },
        orderBy: { createdAt: "desc" },
        take: 20
      })
    ]);

    return res.status(200).json({
      success: true,
      checkoutEnabled: isTestCheckoutAvailable(),
      checkoutUnavailableMessage: isTestCheckoutAvailable()
        ? null
        : "Razorpay Test Mode is not configured. No payment has been initiated.",
      plans: plans
        .filter((plan) =>
          isCustomerPlanEligibleForType(plan, req.customer.customerType) &&
          CUSTOMER_BILLING_CYCLES.some((cycle) => isCustomerPlanPurchasableForCycle(plan, cycle))
        )
        .map((plan) => ({
          id: plan.id,
          name: plan.name,
          description: plan.description,
          currency: plan.currency,
          ...Object.fromEntries(CUSTOMER_BILLING_CYCLES.map((cycle) => {
            const price = isCustomerPlanPurchasableForCycle(plan, cycle)
              ? Number(getCustomerPlanPrice(plan, cycle))
              : null;
            return [cycle.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()) + "Price", price];
          })),
          billingCycles: CUSTOMER_BILLING_CYCLES.filter((cycle) =>
            isCustomerPlanPurchasableForCycle(plan, cycle)
          ),
          features: plan.features,
          usageLimits: plan.usageLimits,
          taxTerms: plan.taxTerms
        })),
      subscriptions: subscriptions.map(publicSubscription),
      payments: payments.map(publicPayment)
    });
  } catch (error) {
    console.error("Customer subscription query failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load subscription information."
    });
  }
};

export const createCustomerSubscriptionCheckout = async (req, res) => {
  let createdPayment;
  try {
    assertCustomerSubscriptionTestMode();
    const planId = req.body?.planId;
    const billingCycle = req.body?.billingCycle;
    const idempotencyKey = req.get("Idempotency-Key");
    if (
      typeof planId !== "string" ||
      !planId ||
      !CUSTOMER_BILLING_CYCLES.includes(billingCycle) ||
      typeof idempotencyKey !== "string" ||
      !/^[a-zA-Z0-9._:-]{8,100}$/.test(idempotencyKey)
    ) {
      return res.status(400).json({
        success: false,
        message: "A plan, billing cycle, and valid idempotency key are required."
      });
    }

    const where = scopeFor(req.customer);
    const plan = await prisma.customerSubscriptionPlan.findFirst({
      where: { id: planId, organisationId: where.organisationId, isActive: true }
    });
    if (
      !isCustomerPlanPurchasableForCycle(plan, billingCycle) ||
      !isCustomerPlanEligibleForType(plan, req.customer.customerType)
    ) {
      return res.status(404).json({
        success: false,
        message: "The selected plan and billing cycle are not currently available."
      });
    }

    const price = getCustomerPlanPrice(plan, billingCycle);

    const checkoutRecord = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "Customer"
        WHERE "id" = ${where.customerId}
          AND "organisationId" = ${where.organisationId}
        FOR UPDATE
      `;
      const previous = await tx.customerSubscriptionPayment.findFirst({
        where: { ...where, idempotencyKey },
        include: { subscription: true }
      });
      if (previous) {
        if (previous.razorpayOrderId) return { existing: previous };
        const error = new Error("This checkout request is already being processed.");
        error.code = "CUSTOMER_CHECKOUT_IDEMPOTENCY_PENDING";
        throw error;
      }

      const outstanding = await tx.customerSubscriptionPayment.findFirst({
        where: { ...where, status: { in: ["CREATING", "CREATED"] } },
        select: { id: true }
      });
      if (outstanding) {
        const pending = await tx.customerSubscriptionPayment.findUnique({
          where: { id: outstanding.id }
        });
        if (
          pending?.status === "CREATED" &&
          pending.razorpayOrderId &&
          pending.planId === plan.id &&
          pending.billingCycle === billingCycle
        ) {
          return { existing: pending };
        }
        const error = new Error("Complete or retry your pending checkout before starting another.");
        error.code = "CUSTOMER_CHECKOUT_PENDING";
        throw error;
      }

      const now = new Date();
      const scheduled = await tx.customerSubscription.findFirst({
        where: {
          ...where,
          status: "SCHEDULED",
          startsAt: { gt: now }
        },
        select: { id: true }
      });
      if (scheduled) {
        const error = new Error("A subscription change is already scheduled for your next renewal.");
        error.code = "CUSTOMER_SUBSCRIPTION_CHANGE_SCHEDULED";
        throw error;
      }
      const active = await tx.customerSubscription.findFirst({
        where: { ...where, status: "ACTIVE" },
        orderBy: { endsAt: "desc" }
      });
      const periodStart =
        active && active.endsAt > now ? active.endsAt : now;
      const periodEnd = addCustomerBillingPeriod(periodStart, billingCycle);
      const subscription = await tx.customerSubscription.create({
        data: {
          ...where,
          planId: plan.id,
          replacesSubscriptionId: active?.id || null,
          status: "PENDING",
          billingCycle,
          startsAt: periodStart,
          renewalAt: periodEnd,
          endsAt: periodEnd
        }
      });
      const payment = await tx.customerSubscriptionPayment.create({
        data: {
          ...where,
          planId: plan.id,
          subscriptionId: subscription.id,
          planName: plan.name,
          billingCycle,
          amount: price,
          currency: plan.currency,
          taxTerms: plan.taxTerms,
          status: "CREATING",
          idempotencyKey,
          periodStart,
          periodEnd
        }
      });
      await tx.auditLog.create({
        data: {
          organisationId: where.organisationId,
          action: "CUSTOMER_SUBSCRIPTION_CHECKOUT_CREATED",
          entityType: "CustomerSubscriptionPayment",
          entityId: payment.id,
          metadata: {
            customerId: where.customerId,
            planId: plan.id,
            billingCycle
          }
        }
      });
      return { payment };
    });

    if (checkoutRecord.existing) {
      const previous = checkoutRecord.existing;
      return res.status(200).json({
        success: true,
        alreadyPaid: previous.status === "PAID",
        paymentId: previous.id,
        orderId: previous.razorpayOrderId,
        amount: Number(previous.amount),
        currency: previous.currency,
        keyId: process.env.CUSTOMER_RAZORPAY_KEY_ID,
        customer: { name: req.customer.fullName, email: req.customer.email },
        periodStart: previous.periodStart,
        periodEnd: previous.periodEnd
      });
    }

    createdPayment = checkoutRecord.payment;
    const amount = amountInPaise(price);
    const razorpay = createCustomerRazorpayClient();
    const order = await razorpay.orders.create({
      amount,
      currency: plan.currency,
      receipt: createdPayment.id,
      notes: { customerSubscriptionPaymentId: createdPayment.id }
    });
    if (
      typeof order?.id !== "string" ||
      !order.id ||
      order.amount !== amount ||
      order.currency !== plan.currency
    ) {
      throw new Error("Razorpay order response did not match the billing record");
    }

    const saved = await prisma.customerSubscriptionPayment.update({
      where: { id: createdPayment.id },
      data: { status: "CREATED", razorpayOrderId: order.id }
    });
    return res.status(201).json({
      success: true,
      paymentId: saved.id,
      orderId: order.id,
      amount: Number(saved.amount),
      currency: saved.currency,
      keyId: process.env.CUSTOMER_RAZORPAY_KEY_ID,
      customer: { name: req.customer.fullName, email: req.customer.email },
      periodStart: saved.periodStart,
      periodEnd: saved.periodEnd
    });
  } catch (error) {
    if (createdPayment) {
      await prisma.$transaction([
        prisma.customerSubscriptionPayment.updateMany({
          where: { id: createdPayment.id, status: "CREATING" },
          data: { status: "FAILED", errorCode: toErrorCode(error) }
        }),
        prisma.customerSubscription.updateMany({
          where: { id: createdPayment.subscriptionId, status: "PENDING" },
          data: { status: "PAYMENT_FAILED" }
        })
      ]);
    }
    if (error.code === "CUSTOMER_SUBSCRIPTION_TEST_UNAVAILABLE") {
      return res.status(503).json({
        success: false,
        message: "Razorpay Test Mode is not configured."
      });
    }
    if (error.code === "CUSTOMER_CHECKOUT_IDEMPOTENCY_PENDING" ||
      error.code === "CUSTOMER_CHECKOUT_PENDING" ||
      error.code === "CUSTOMER_SUBSCRIPTION_CHANGE_SCHEDULED") {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "A checkout request with this idempotency key already exists."
      });
    }
    console.error("Customer subscription checkout failed:", error.code || error.name);
    return res.status(502).json({
      success: false,
      message: "Unable to create the subscription checkout."
    });
  }
};

export const verifyCustomerSubscriptionCheckout = async (req, res) => {
  try {
    assertCustomerSubscriptionTestMode();
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } =
      req.body || {};
    if (
      typeof orderId !== "string" ||
      typeof paymentId !== "string" ||
      typeof signature !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "The payment verification response is incomplete."
      });
    }

    const payment = await prisma.customerSubscriptionPayment.findFirst({
      where: { ...scopeFor(req.customer), razorpayOrderId: orderId }
    });
    if (!payment) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed."
      });
    }

    const razorpay = createCustomerRazorpayClient();
    const result = await verifyCustomerSubscriptionPayment({
      payment,
      orderId,
      paymentId,
      signature,
      secret: process.env.CUSTOMER_RAZORPAY_KEY_SECRET,
      fetchProviderPayment: (id) => razorpay.payments.fetch(id),
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
        message: "Payment is awaiting confirmation."
      });
    }

    if (result.status === "PAYMENT_MISMATCH") {
      return res.status(409).json({
        success: false,
        message: "The confirmed payment does not match the subscription order."
      });
    }
    if (result.status === "PAYMENT_NOT_PAYABLE") {
      return res.status(409).json({
        success: false,
        message: "This payment is no longer eligible for receipt issuance."
      });
    }
    let receiptDelivery;
    try {
      receiptDelivery = await finalizeCapturedReceipt(payment.id, req);
    } catch (error) {
      console.error("Verified receipt generation failed:", error.code || error.name);
      return res.status(503).json({
        success: true,
        status: "PAID",
        receiptStatus: "PENDING",
        message: "Payment is verified. Do not retry checkout; the receipt is being prepared."
      });
    }
    return res.status(200).json({
      success: true,
      status: result.status === "ALREADY_PAID" ? "PAID" : result.status,
      receipt: {
        id: receiptDelivery.receipt.id,
        receiptNumber: receiptDelivery.receipt.receiptNumber
      },
      receiptEmailStatus: receiptDelivery.emailStatus
    });
  } catch (error) {
    if (error.code === "CUSTOMER_SUBSCRIPTION_TEST_UNAVAILABLE") {
      return res.status(503).json({
        success: false,
        message: "Razorpay Test Mode is not configured."
      });
    }
    console.error("Customer subscription payment verification failed:", error.code || error.name);
    return res.status(502).json({
      success: false,
      message: "Unable to verify the payment at this time."
    });
  }
};

export const handleCustomerSubscriptionWebhook = async (req, res) => {
  try {
    assertCustomerSubscriptionTestMode();
    const signature = req.get("X-Razorpay-Signature");
    const providerEventId = req.get("X-Razorpay-Event-Id");
    if (
      !Buffer.isBuffer(req.body) ||
      typeof providerEventId !== "string" ||
      providerEventId.length < 1 ||
      providerEventId.length > 200 ||
      !verifyCustomerWebhookSignature(req.body, signature)
    ) {
      return res.status(400).json({ success: false, message: "Invalid payment webhook." });
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.status(400).json({ success: false, message: "Invalid payment webhook payload." });
    }
    if (typeof payload?.event !== "string" || payload.event.length > 120) {
      return res.status(400).json({ success: false, message: "Invalid payment webhook event." });
    }

    let event;
    try {
      event = await prisma.customerSubscriptionWebhookEvent.create({
        data: {
          providerEventId,
          eventType: payload.event
        }
      });
    } catch (error) {
      if (error.code === "P2002") {
        const existingEvent = await prisma.customerSubscriptionWebhookEvent.findUnique({
          where: { providerEventId },
          select: { id: true, paymentId: true, status: true }
        });
        if (
          existingEvent?.status === "RECEIPT_PENDING" &&
          existingEvent.paymentId
        ) {
          await finalizeCapturedReceipt(existingEvent.paymentId, req);
          await prisma.customerSubscriptionWebhookEvent.update({
            where: { id: existingEvent.id },
            data: { status: "PROCESSED", processedAt: new Date() }
          });
        }
        return res.status(200).json({ success: true, duplicate: true });
      }
      throw error;
    }

    if (!["payment.captured", "order.paid", "payment.failed"].includes(payload.event)) {
      await prisma.customerSubscriptionWebhookEvent.update({
        where: { id: event.id },
        data: { status: "IGNORED", processedAt: new Date() }
      });
      return res.status(200).json({ success: true, ignored: true });
    }

    const providerPayment = payload.payload?.payment?.entity;
    const orderId =
      providerPayment?.order_id || payload.payload?.order?.entity?.id;
    const payment = orderId
      ? await prisma.customerSubscriptionPayment.findFirst({
          where: { razorpayOrderId: orderId }
        })
      : null;
    if (!payment) {
      await prisma.customerSubscriptionWebhookEvent.update({
        where: { id: event.id },
        data: { status: "FAILED", processedAt: new Date(), errorCode: "ORDER_NOT_FOUND" }
      });
      return res.status(200).json({ success: true, processed: false });
    }

    if (payload.event === "payment.failed") {
      await prisma.$transaction([
        prisma.customerSubscriptionPayment.updateMany({
          where: { id: payment.id, status: { not: "PAID" } },
          data: { status: "FAILED", errorCode: "PAYMENT_FAILED" }
        }),
        prisma.customerSubscription.updateMany({
          where: { id: payment.subscriptionId, status: "PENDING" },
          data: { status: "PAYMENT_FAILED" }
        }),
        prisma.customerSubscriptionWebhookEvent.update({
          where: { id: event.id },
          data: {
            organisationId: payment.organisationId,
            customerId: payment.customerId,
            paymentId: payment.id,
            status: "PROCESSED",
            processedAt: new Date()
          }
        })
      ]);
      return res.status(200).json({ success: true });
    }

    const result = await prisma.$transaction(async (tx) => {
      const recorded = await recordCapturedCustomerPayment(tx, payment, providerPayment);
      await tx.customerSubscriptionWebhookEvent.update({
        where: { id: event.id },
        data: {
          organisationId: payment.organisationId,
          customerId: payment.customerId,
          paymentId: payment.id,
          status: ["PAYMENT_MISMATCH", "PAYMENT_NOT_PAYABLE"].includes(recorded.status)
            ? "FAILED"
            : "RECEIPT_PENDING",
          processedAt: null,
          errorCode: recorded.status === "PAYMENT_MISMATCH"
            ? "PAYMENT_MISMATCH"
            : recorded.status === "PAYMENT_NOT_PAYABLE"
              ? "PAYMENT_NOT_PAYABLE"
              : null
        }
      });
      return recorded;
    });
    if (["PAYMENT_MISMATCH", "PAYMENT_NOT_PAYABLE"].includes(result.status)) {
      return res.status(200).json({ success: true, processed: false });
    }
    await finalizeCapturedReceipt(payment.id, req);
    await prisma.customerSubscriptionWebhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date() }
    });
    return res.status(200).json({
      success: true,
      processed: true
    });
  } catch (error) {
    if (error.code === "CUSTOMER_SUBSCRIPTION_TEST_UNAVAILABLE") {
      return res.status(503).json({ success: false, message: "Payment webhook is unavailable." });
    }
    console.error("Customer subscription webhook failed:", error.code || error.name);
    return res.status(500).json({ success: false, message: "Payment webhook processing failed." });
  }
};

export const cancelCustomerSubscription = async (req, res) => {
  try {
    const result = await prisma.customerSubscription.updateMany({
      where: {
        id: req.params.subscriptionId,
        ...scopeFor(req.customer),
        status: "ACTIVE",
        cancelAtPeriodEnd: false
      },
      data: { cancelAtPeriodEnd: true }
    });
    if (result.count !== 1) {
      return res.status(404).json({
        success: false,
        message: "An active subscription eligible for cancellation was not found."
      });
    }
    await prisma.auditLog.create({
      data: {
        organisationId: req.customer.organisationId,
        action: "CUSTOMER_SUBSCRIPTION_CANCEL_AT_PERIOD_END",
        entityType: "CustomerSubscription",
        entityId: req.params.subscriptionId,
        metadata: { customerId: req.customer.customerId }
      }
    });
    return res.status(200).json({
      success: true,
      message: "Your subscription will remain active until its current period ends."
    });
  } catch (error) {
    console.error("Customer subscription cancellation failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to update the subscription."
    });
  }
};

export const getCustomerSubscriptionBilling = async (req, res) => {
  try {
    const where = scopeFor(req.customer);
    const [invoices, receipts] = await Promise.all([
      prisma.customerSubscriptionInvoice.findMany({
        where,
        include: { payment: true },
        orderBy: { createdAt: "desc" },
        take: 100
      }),
      prisma.customerSubscriptionReceipt.findMany({
        where: {
          ...where,
          payment: { status: "PAID" }
        },
        select: {
          id: true,
          receiptNumber: true,
          amount: true,
          currency: true,
          paidAt: true,
          payment: {
            select: { paymentMethod: true, razorpayPaymentId: true }
          }
        },
        orderBy: { createdAt: "desc" }
      })
    ]);
    return res.status(200).json({
      success: true,
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        planName: invoice.planName,
        billingCycle: invoice.billingCycle,
        amount: Number(invoice.amount),
        currency: invoice.currency,
        createdAt: invoice.createdAt,
        paymentId: invoice.paymentId,
        razorpayPaymentId: invoice.payment.razorpayPaymentId,
        status: invoice.payment.status
      })),
      receipts: receipts.map((receipt) => ({
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        amount: Number(receipt.amount),
        currency: receipt.currency,
        paidAt: receipt.paidAt,
        paymentMethod: receipt.payment.paymentMethod,
        razorpayPaymentId: receipt.payment.razorpayPaymentId
      }))
    });
  } catch (error) {
    console.error("Customer subscription billing query failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load subscription billing history."
    });
  }
};

export const getCustomerSubscriptionInvoicePdf = async (req, res) => {
  try {
    const invoice = await prisma.customerSubscriptionInvoice.findFirst({
      where: { id: req.params.invoiceId, ...scopeFor(req.customer) },
      include: {
        payment: true,
        customer: {
          select: {
            name: true,
            email: true,
            phone: true,
            billingAddress: true,
            taxRegistration: true
          }
        }
      }
    });
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found." });
    }
    return await sendBillingPdf(res, `${invoice.invoiceNumber}.pdf`, {
      title: "Subscription tax invoice",
      reference: invoice.invoiceNumber,
      customer: invoice.customer,
      payment: invoice.payment,
      invoice
    });
  } catch (error) {
    console.error("Customer subscription invoice download failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to download the subscription invoice."
    });
  }
};

export const getCustomerSubscriptionReceiptPdf = async (req, res) => {
  try {
    const receipt = await prisma.customerSubscriptionReceipt.findFirst({
      where: {
        id: req.params.receiptId,
        ...scopeFor(req.customer),
        payment: { status: "PAID" }
      },
      select: {
        id: true,
        paymentId: true,
        receiptNumber: true,
        pdfBytes: true,
        pdfSha256: true,
        verificationTokenHash: true,
        payment: { select: { status: true } }
      }
    });
    if (!receipt) {
      return res.status(404).json({ success: false, message: "Receipt not found." });
    }
    const finalized = isStoredReceiptPdfValid(receipt)
      ? receipt
      : await finalizeCustomerSubscriptionReceipt(
          receipt.paymentId,
          process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`
        );
    if (
      !isStoredReceiptPdfValid(finalized) ||
      finalized.payment.status !== "PAID"
    ) {
      return res.status(404).json({ success: false, message: "Verified receipt PDF is not available." });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${receipt.receiptNumber}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(Buffer.from(finalized.pdfBytes));
  } catch (error) {
    console.error("Customer subscription receipt download failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to download the subscription receipt."
    });
  }
};

export const getCustomerSubscriptionPaymentPdf = async (req, res) => {
  try {
    const payment = await prisma.customerSubscriptionPayment.findFirst({
      where: { id: req.params.paymentId, ...scopeFor(req.customer) },
      include: {
        customer: {
          select: {
            name: true,
            email: true,
            phone: true,
            billingAddress: true,
            taxRegistration: true
          }
        }
      }
    });
    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment transaction not found." });
    }
    return await sendBillingPdf(res, `transaction-${payment.id}.pdf`, {
      title: "Payment transaction details",
      reference: payment.razorpayPaymentId || payment.razorpayOrderId || payment.id,
      customer: payment.customer,
      payment
    });
  } catch (error) {
    console.error("Customer payment transaction PDF failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to download payment transaction details."
    });
  }
};

export const getCustomerSubscriptionHistoryPdf = async (req, res) => {
  try {
    const payments = await prisma.customerSubscriptionPayment.findMany({
      where: scopeFor(req.customer),
      include: {
        customer: {
          select: {
            name: true,
            email: true,
            phone: true,
            billingAddress: true,
            taxRegistration: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    const customer = payments[0]?.customer || await prisma.customer.findFirst({
      where: {
        id: req.customer.customerId,
        organisationId: req.customer.organisationId
      },
      select: {
        name: true,
        email: true,
        phone: true,
        billingAddress: true,
        taxRegistration: true
      }
    });
    return await sendBillingPdf(res, "subscription-payment-history.pdf", {
      title: "Subscription payment history",
      reference: `HISTORY-${randomUUID().toUpperCase()}`,
      customer,
      payments
    });
  } catch (error) {
    console.error("Customer subscription payment history PDF failed:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to download your subscription payment history."
    });
  }
};
