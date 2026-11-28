import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import test from "node:test";
import zlib from "node:zlib";
import prisma from "../config/prisma.js";
import {
  handleCustomerSubscriptionWebhook
} from "./customer-subscription.controller.js";
import customerPortalRoutes from "../routes/customer-portal.routes.js";
import receiptRoutes from "../routes/receipt.routes.js";
import adminNotificationRoutes from "../routes/admin-notification.routes.js";
import { sendTrackedCustomerEmail } from "../services/customer-email-delivery.service.js";
import {
  finalizeCustomerSubscriptionReceipt,
  isStoredReceiptPdfValid,
  sendCustomerSubscriptionReceiptEmail
} from "../services/customer-subscription-receipt.service.js";
import {
  verifyCustomerSubscriptionPayment
} from "../services/customer-subscription.service.js";
import { getCustomerReceiptPdfFilename } from "../services/customer-receipt-pdf.service.js";

const TEST_ONLY_PAYMENT_SECRET = "test-harness-payment-secret";
const TEST_ONLY_WEBHOOK_SECRET = "test-harness-webhook-secret";

const sign = (secret, value) =>
  crypto.createHmac("sha256", secret).update(value).digest("hex");

const assertIsolatedDevelopmentDatabase = () => {
  const databaseUrl = new URL(process.env.DATABASE_URL || "");
  assert.equal(databaseUrl.protocol, "postgresql:");
  assert.equal(databaseUrl.hostname, "localhost");
  assert.equal(databaseUrl.port, "5432");
  assert.equal(
    decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, "")),
    "auron_collect_app_dev",
    "receipt integration tests may only write to auron_collect_app_dev"
  );
};

const extractPdfText = (pdf) => {
  let offset = 0;
  let text = "";

  while ((offset = pdf.indexOf(Buffer.from("stream"), offset)) >= 0) {
    let start = offset + Buffer.byteLength("stream");
    if (pdf[start] === 13) start += 1;
    if (pdf[start] === 10) start += 1;

    const end = pdf.indexOf(Buffer.from("endstream"), start);
    if (end < 0) break;

    let contentEnd = end;
    while (
      contentEnd > start &&
      (pdf[contentEnd - 1] === 10 || pdf[contentEnd - 1] === 13)
    ) {
      contentEnd -= 1;
    }

    try {
      const content = zlib.inflateSync(pdf.subarray(start, contentEnd)).toString("latin1");
      for (const array of content.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
        text += [...array[1].matchAll(/<([a-f0-9]+)>/gi)]
          .map(([, hex]) => Buffer.from(hex, "hex").toString("utf8"))
          .join("") + "\n";
      }
    } catch {
      // Other compressed PDF streams contain image data rather than text.
    }
    offset = end + Buffer.byteLength("endstream");
  }

  return text;
};

const extractPdfAttachment = (rawMessage, filename) => {
  const message = rawMessage.toString("utf8");
  const boundary = message.match(/boundary="?([^"\r\n;]+)"?/i)?.[1];
  assert.ok(boundary, "stream transport output must contain a MIME boundary");

  const attachmentIndex = message.indexOf("Content-Type: application/pdf");
  assert.notEqual(attachmentIndex, -1, "receipt PDF attachment must be present");
  const partStart = message.lastIndexOf(`--${boundary}`, attachmentIndex);
  assert.notEqual(partStart, -1, "receipt attachment must start at a MIME boundary");
  const contentEnd = message.indexOf(`--${boundary}`, attachmentIndex);
  assert.notEqual(contentEnd, -1, "receipt attachment must end at a MIME boundary");
  const attachmentPart = message.slice(partStart, contentEnd);
  const filenameParts = [...attachmentPart.matchAll(
    /filename(?:\*(\d+))?=(?:"([^"]*)"|([^;\r\n,]*))/gi
  )].sort((left, right) => Number(left[1] || 0) - Number(right[1] || 0));
  assert.equal(
    filenameParts.map((part) => part[2] ?? part[3].trim()).join(""),
    filename,
    "receipt PDF attachment filename must match"
  );
  assert.match(attachmentPart, /Content-Transfer-Encoding: base64/i);
  const headerEnd = attachmentPart.match(/\r?\n\r?\n/);
  assert.ok(headerEnd, "receipt attachment must have a MIME header/body separator");
  const contentStart = partStart + headerEnd.index + headerEnd[0].length;
  const encoded = message.slice(contentStart, contentEnd).replace(/\s/g, "");
  return Buffer.from(encoded, "base64");
};

const createMockResponse = () => ({
  statusCode: 200,
  headers: {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  send(body) {
    this.body = body;
    return this;
  }
});

test("test-only verified event completes the receipt pipeline without external payment or email", async (t) => {
  assertIsolatedDevelopmentDatabase();

  const envKeys = [
    "NODE_ENV",
    "JWT_SECRET",
    "CUSTOMER_RAZORPAY_MODE",
    "CUSTOMER_RAZORPAY_KEY_ID",
    "CUSTOMER_RAZORPAY_KEY_SECRET",
    "CUSTOMER_RAZORPAY_WEBHOOK_SECRET",
    "PUBLIC_API_URL",
    "NOTIFICATION_DELIVERY_MODE",
    "PAYMENT_RECEIPT_EMAIL_PRODUCTION_AUTHORIZED",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "EMAIL_FROM"
  ];
  const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  const suffix = crypto.randomUUID();
  const streamMessages = [];
  const originalCreateTransport = nodemailer.createTransport.bind(nodemailer);
  let streamTransportCalls = 0;
  let server;
  let organisation;
  let otherOrganisation;
  let customer;
  let otherCustomer;
  let portalAccount;
  let otherPortalAccount;
  let admin;
  let otherAdmin;
  let plan;

  const testSecret = (key, value) => {
    process.env[key] = value;
  };
  testSecret("NODE_ENV", "test");
  testSecret("JWT_SECRET", crypto.randomBytes(32).toString("hex"));
  testSecret("CUSTOMER_RAZORPAY_MODE", "test");
  testSecret("CUSTOMER_RAZORPAY_KEY_ID", "rzp_test_test_harness_only");
  testSecret("CUSTOMER_RAZORPAY_KEY_SECRET", TEST_ONLY_PAYMENT_SECRET);
  testSecret("CUSTOMER_RAZORPAY_WEBHOOK_SECRET", TEST_ONLY_WEBHOOK_SECRET);
  testSecret("PUBLIC_API_URL", "http://127.0.0.1");
  testSecret("NOTIFICATION_DELIVERY_MODE", "disabled");
  testSecret("PAYMENT_RECEIPT_EMAIL_PRODUCTION_AUTHORIZED", "false");
  testSecret("SMTP_HOST", "127.0.0.1");
  testSecret("SMTP_PORT", "1");
  testSecret("SMTP_USER", "stream-transport-only");
  testSecret("SMTP_PASS", "stream-transport-only");
  testSecret("EMAIL_FROM", "auron-collect-test@example.invalid");

  t.mock.method(nodemailer, "createTransport", () => {
    streamTransportCalls += 1;
    const streamTransport = originalCreateTransport({
      streamTransport: true,
      buffer: true,
      newline: "unix"
    });
    return {
      sendMail: async (message) => {
        const result = await streamTransport.sendMail(message);
        streamMessages.push(Buffer.from(result.message));
        return {
          ...result,
          accepted: result.envelope.to,
          rejected: []
        };
      },
      close: () => streamTransport.close()
    };
  });

  const makePaymentFixture = async (key) => {
    const periodStart = new Date(Date.now() - 60_000);
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const subscription = await prisma.customerSubscription.create({
      data: {
        organisationId: organisation.id,
        customerId: customer.id,
        planId: plan.id,
        status: "PENDING",
        billingCycle: "MONTHLY",
        startsAt: periodStart,
        renewalAt: periodEnd,
        endsAt: periodEnd
      }
    });
    const payment = await prisma.customerSubscriptionPayment.create({
      data: {
        organisationId: organisation.id,
        customerId: customer.id,
        planId: plan.id,
        subscriptionId: subscription.id,
        planName: plan.name,
        billingCycle: "MONTHLY",
        amount: "12.50",
        currency: "INR",
        taxTerms: "Test-only receipt integration fixture.",
        status: "CREATED",
        idempotencyKey: `receipt-test-${suffix}-${key}`,
        razorpayOrderId: `order_test_only_${suffix}_${key}`,
        periodStart,
        periodEnd
      }
    });
    return payment;
  };

  const verifyWithTestOnlyEvent = async (payment, providerEvent, signatureOverride) => {
    const paymentId = providerEvent.id;
    const signature = signatureOverride ||
      sign(TEST_ONLY_PAYMENT_SECRET, `${payment.razorpayOrderId}|${paymentId}`);
    return verifyCustomerSubscriptionPayment({
      payment,
      orderId: payment.razorpayOrderId,
      paymentId,
      signature,
      secret: TEST_ONLY_PAYMENT_SECRET,
      fetchProviderPayment: async (requestedPaymentId) => {
        assert.equal(requestedPaymentId, paymentId);
        return providerEvent;
      },
      runTransaction: (callback) => prisma.$transaction(callback)
    });
  };

  try {
    organisation = await prisma.organisation.create({
      data: { name: `Receipt Test ${suffix}` }
    });
    otherOrganisation = await prisma.organisation.create({
      data: { name: `Other Receipt Test ${suffix}` }
    });
    customer = await prisma.customer.create({
      data: {
        customerCode: `RCPT-${suffix}`,
        name: "Receipt Integration Customer",
        email: `receipt-${suffix}@example.invalid`,
        status: "ACTIVE",
        organisationId: organisation.id
      }
    });
    otherCustomer = await prisma.customer.create({
      data: {
        customerCode: `OTHER-RCPT-${suffix}`,
        name: "Other Receipt Integration Customer",
        email: `other-receipt-${suffix}@example.invalid`,
        status: "ACTIVE",
        organisationId: otherOrganisation.id
      }
    });
    portalAccount = await prisma.customerPortalAccount.create({
      data: {
        customerId: customer.id,
        email: customer.email,
        fullName: customer.name,
        passwordHash: "integration-test-only",
        emailVerifiedAt: new Date()
      }
    });
    otherPortalAccount = await prisma.customerPortalAccount.create({
      data: {
        customerId: otherCustomer.id,
        email: otherCustomer.email,
        fullName: otherCustomer.name,
        passwordHash: "integration-test-only",
        emailVerifiedAt: new Date()
      }
    });
    admin = await prisma.user.create({
      data: {
        name: "Receipt Test Admin",
        email: `receipt-admin-${suffix}@example.invalid`,
        password: "integration-test-only",
        role: "OWNER",
        organisationId: organisation.id
      }
    });
    otherAdmin = await prisma.user.create({
      data: {
        name: "Other Receipt Test Admin",
        email: `other-receipt-admin-${suffix}@example.invalid`,
        password: "integration-test-only",
        role: "OWNER",
        organisationId: otherOrganisation.id
      }
    });
    plan = await prisma.customerSubscriptionPlan.create({
      data: {
        organisationId: organisation.id,
        code: `receipt-test-${suffix}`,
        name: "Receipt Test Plan",
        monthlyPrice: "12.50",
        currency: "INR",
        pricingStatus: "APPROVED",
        pricingProposalStatus: "APPROVED",
        taxTerms: "Test-only receipt integration fixture.",
        taxTermsStatus: "APPROVED",
        taxProposalStatus: "APPROVED",
        isActive: true
      }
    });

    const successPayment = await makePaymentFixture("success");
    const invalidSignaturePayment = await makePaymentFixture("invalid");
    const pendingPayment = await makePaymentFixture("pending");
    const failedPayment = await makePaymentFixture("failed");
    const deniedEmailPayment = await makePaymentFixture("email-denied");

    const invalidSignatureEvent = {
      id: `pay_test_only_${suffix}_invalid`,
      order_id: invalidSignaturePayment.razorpayOrderId,
      status: "captured",
      currency: "INR",
      amount: 1250
    };
    const invalidSignatureResult = await verifyWithTestOnlyEvent(
      invalidSignaturePayment,
      invalidSignatureEvent,
      "0".repeat(64)
    );
    assert.deepEqual(invalidSignatureResult, { status: "INVALID_SIGNATURE" });
    assert.equal(
      (await prisma.customerSubscriptionPayment.findUnique({
        where: { id: invalidSignaturePayment.id }
      })).status,
      "CREATED"
    );
    assert.equal(
      await prisma.customerSubscriptionReceipt.count({
        where: { paymentId: invalidSignaturePayment.id }
      }),
      0
    );

    const pendingEvent = {
      id: `pay_test_only_${suffix}_pending`,
      order_id: pendingPayment.razorpayOrderId,
      status: "authorized",
      currency: "INR",
      amount: 1250
    };
    assert.deepEqual(await verifyWithTestOnlyEvent(pendingPayment, pendingEvent), {
      status: "PENDING"
    });
    assert.equal(
      await prisma.customerSubscriptionReceipt.count({
        where: { paymentId: pendingPayment.id }
      }),
      0
    );

    const testOnlyProviderEvent = {
      id: `pay_test_only_${suffix}_captured`,
      order_id: successPayment.razorpayOrderId,
      status: "captured",
      currency: "INR",
      amount: 1250,
      method: "card",
      created_at: Math.floor(Date.now() / 1000)
    };
    const capturedResult = await verifyWithTestOnlyEvent(
      successPayment,
      testOnlyProviderEvent
    );
    assert.equal(capturedResult.status, "ACTIVE");
    assert.ok(capturedResult.receiptNumber);

    const failedWebhookPayment = failedPayment;
    const failedEventBody = Buffer.from(JSON.stringify({
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: `pay_test_only_${suffix}_failed`,
            order_id: failedWebhookPayment.razorpayOrderId,
            status: "failed"
          }
        }
      }
    }));
    const failedWebhookSignature = sign(TEST_ONLY_WEBHOOK_SECRET, failedEventBody);
    const webhookResponse = createMockResponse();
    await handleCustomerSubscriptionWebhook({
      body: failedEventBody,
      protocol: "http",
      get: (name) => ({
        "X-Razorpay-Signature": failedWebhookSignature,
        "X-Razorpay-Event-Id": `evt_test_only_${suffix}_failed`
      })[name]
    }, webhookResponse);
    assert.equal(webhookResponse.statusCode, 200);
    assert.equal(
      (await prisma.customerSubscriptionPayment.findUnique({
        where: { id: failedWebhookPayment.id }
      })).status,
      "FAILED"
    );
    assert.equal(
      await prisma.customerSubscriptionReceipt.count({
        where: { paymentId: failedWebhookPayment.id }
      }),
      0
    );
    assert.equal(
      await prisma.customerSubscriptionInvoice.count({
        where: { paymentId: failedWebhookPayment.id }
      }),
      0
    );
    assert.equal(
      (await prisma.customerSubscription.findUnique({
        where: { id: failedWebhookPayment.subscriptionId }
      })).status,
      "PAYMENT_FAILED"
    );

    const persistedReceipt = await prisma.customerSubscriptionReceipt.findUnique({
      where: { paymentId: successPayment.id },
      include: { payment: true, customer: true }
    });
    assert.ok(persistedReceipt);
    assert.equal(persistedReceipt.receiptNumber, capturedResult.receiptNumber);
    assert.equal(persistedReceipt.transactionId, testOnlyProviderEvent.id);
    assert.equal(persistedReceipt.payment.status, "PAID");
    assert.equal(
      await prisma.customerSubscriptionInvoice.count({
        where: { paymentId: successPayment.id }
      }),
      1
    );

    const finalizedReceipt = await finalizeCustomerSubscriptionReceipt(
      successPayment.id,
      "http://127.0.0.1"
    );
    assert.ok(isStoredReceiptPdfValid(finalizedReceipt));
    assert.equal(Buffer.from(finalizedReceipt.pdfBytes).subarray(0, 5).toString(), "%PDF-");
    assert.ok(finalizedReceipt.pdfBytes.length > 10_000);
    assert.match(finalizedReceipt.pdfSha256, /^[a-f0-9]{64}$/);
    assert.match(finalizedReceipt.verificationTokenHash, /^[a-f0-9]{64}$/);
    const receiptPdfText = extractPdfText(Buffer.from(finalizedReceipt.pdfBytes));
    for (const brandText of [
      "ALPHA AURON PRIVATE LIMITED",
      "AURON COLLECT",
      "OFFICIAL PAYMENT RECEIPT",
      finalizedReceipt.receiptNumber,
      testOnlyProviderEvent.id,
      customer.name,
      customer.id,
      customer.email,
      "Payment amount",
      "Payment date and time",
      "Payment mode",
      "Next renewal date",
      "PAID - provider verified",
      "Not applicable - subscription payment",
      "SCAN TO VERIFY RECEIPT",
      "Authorised Signatory"
    ]) {
      assert.ok(receiptPdfText.includes(brandText), `receipt PDF should contain ${brandText}`);
    }
    assert.ok(Buffer.from(finalizedReceipt.pdfBytes).includes(Buffer.from("/Subtype /Image")));

    const repeatedFinalization = await finalizeCustomerSubscriptionReceipt(
      successPayment.id,
      "http://127.0.0.1"
    );
    assert.equal(repeatedFinalization.id, finalizedReceipt.id);
    assert.deepEqual(
      Buffer.from(repeatedFinalization.pdfBytes),
      Buffer.from(finalizedReceipt.pdfBytes)
    );

    const paidPayment = await prisma.customerSubscriptionPayment.findUnique({
      where: { id: successPayment.id }
    });
    const duplicateResult = await verifyWithTestOnlyEvent(
      paidPayment,
      testOnlyProviderEvent
    );
    assert.deepEqual(duplicateResult, { status: "ALREADY_PAID" });
    assert.equal(
      await prisma.customerSubscriptionReceipt.count({
        where: { paymentId: successPayment.id }
      }),
      1
    );
    assert.equal(
      await prisma.customerSubscriptionInvoice.count({
        where: { paymentId: successPayment.id }
      }),
      1
    );

    testSecret("NODE_ENV", "production");
    testSecret("NOTIFICATION_DELIVERY_MODE", "disabled");
    testSecret("PAYMENT_RECEIPT_EMAIL_PRODUCTION_AUTHORIZED", "false");
    const emailResult = await sendCustomerSubscriptionReceiptEmail(finalizedReceipt.id);
    assert.equal(emailResult.status, "SMTP_ACCEPTED");
    assert.equal(streamTransportCalls, 1);
    assert.equal(streamMessages.length, 1);
    const emailAttachment = extractPdfAttachment(
      streamMessages[0],
      getCustomerReceiptPdfFilename(finalizedReceipt.receiptNumber)
    );
    assert.deepEqual(emailAttachment, Buffer.from(finalizedReceipt.pdfBytes));
    assert.equal(emailAttachment.subarray(0, 5).toString(), "%PDF-");

    const repeatedEmail = await sendCustomerSubscriptionReceiptEmail(finalizedReceipt.id);
    assert.equal(repeatedEmail.status, "ALREADY_ATTEMPTED");
    assert.equal(streamTransportCalls, 1);

    const deniedEmailEvent = {
      id: `pay_test_only_${suffix}_email_denied`,
      order_id: deniedEmailPayment.razorpayOrderId,
      status: "captured",
      currency: "INR",
      amount: 1250,
      method: "card",
      created_at: Math.floor(Date.now() / 1000)
    };
    assert.equal(
      (await verifyWithTestOnlyEvent(deniedEmailPayment, deniedEmailEvent)).status,
      "ACTIVE"
    );
    const deniedReceipt = await finalizeCustomerSubscriptionReceipt(
      deniedEmailPayment.id,
      "http://127.0.0.1"
    );
    testSecret("NODE_ENV", "test");
    testSecret("NOTIFICATION_DELIVERY_MODE", "disabled");
    testSecret("PAYMENT_RECEIPT_EMAIL_PRODUCTION_AUTHORIZED", "false");
    const disabledDelivery = await sendCustomerSubscriptionReceiptEmail(deniedReceipt.id);
    assert.equal(disabledDelivery.status, "DISABLED");
    assert.equal(streamTransportCalls, 1);
    const disabledAttempt = await prisma.emailDeliveryAttempt.findFirst({
      where: {
        customerSubscriptionReceiptId: deniedReceipt.id,
        purpose: "PAYMENT_RECEIPT"
      }
    });
    assert.equal(disabledAttempt.status, "DISABLED");

    const skippedEmail = await sendTrackedCustomerEmail({
      accountId: portalAccount.id,
      customerId: customer.id,
      purpose: "PASSWORD_RESET",
      to: "",
      subject: "Password reset",
      text: "Password reset"
    });
    assert.equal(skippedEmail.status, "SKIPPED");

    const app = express();
    app.use(express.json());
    app.use("/api/receipts", receiptRoutes);
    app.use("/api/customer-portal", customerPortalRoutes);
    app.use("/api/admin-notifications", adminNotificationRoutes);
    const listener = await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve(server));
    });
    const baseUrl = `http://127.0.0.1:${listener.address().port}`;
    const adminToken = jwt.sign({
      userId: admin.id,
      organisationId: organisation.id,
      sessionVersion: admin.sessionVersion
    }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const otherAdminToken = jwt.sign({
      userId: otherAdmin.id,
      organisationId: otherOrganisation.id,
      sessionVersion: otherAdmin.sessionVersion
    }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const customerToken = jwt.sign({
      tokenType: "CUSTOMER_PORTAL",
      accountId: portalAccount.id,
      customerId: customer.id,
      sessionVersion: 0
    }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const otherCustomerToken = jwt.sign({
      tokenType: "CUSTOMER_PORTAL",
      accountId: otherPortalAccount.id,
      customerId: otherCustomer.id,
      sessionVersion: 0
    }, process.env.JWT_SECRET, { expiresIn: "10m" });
    const get = (path, token) => fetch(`${baseUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

    const adminNotificationsResponse = await get(
      "/api/admin-notifications",
      adminToken
    );
    assert.equal(adminNotificationsResponse.status, 200);
    const adminNotifications = await adminNotificationsResponse.json();
    const skippedEmailNotification = adminNotifications.notifications.find(
      (notification) => notification.id === `FAILED_EMAIL:${skippedEmail.attemptId}`
    );
    assert.ok(skippedEmailNotification);
    assert.equal(skippedEmailNotification.title, "Customer email not verified");
    assert.match(skippedEmailNotification.message, /No verified customer email/);

    const adminListResponse = await get(
      "/api/receipts/customer-subscriptions",
      adminToken
    );
    assert.equal(adminListResponse.status, 200);
    const adminList = await adminListResponse.json();
    const listedReceipt = adminList.receipts.find(
      (receipt) => receipt.id === finalizedReceipt.id
    );
    assert.ok(listedReceipt);
    assert.equal(listedReceipt.emailStatus, "SMTP_ACCEPTED");
    assert.equal(Object.hasOwn(listedReceipt, "pdfBytes"), false);
    assert.equal(Object.hasOwn(listedReceipt, "verificationTokenHash"), false);

    const customerBillingResponse = await get(
      "/api/customer-portal/subscriptions/billing",
      customerToken
    );
    assert.equal(customerBillingResponse.status, 200);
    const customerBilling = await customerBillingResponse.json();
    assert.ok(customerBilling.receipts.some((receipt) =>
      receipt.id === finalizedReceipt.id
    ));

    const customerPdfResponse = await get(
      `/api/customer-portal/subscriptions/receipts/${finalizedReceipt.id}/pdf`,
      customerToken
    );
    assert.equal(customerPdfResponse.status, 200);
    assert.match(customerPdfResponse.headers.get("content-disposition"), /attachment/);
    assert.equal(customerPdfResponse.headers.get("cache-control"), "private, no-store");
    const customerDownloadedPdf = Buffer.from(await customerPdfResponse.arrayBuffer());
    assert.equal(customerDownloadedPdf.subarray(0, 5).toString(), "%PDF-");
    assert.deepEqual(customerDownloadedPdf, Buffer.from(finalizedReceipt.pdfBytes));

    const adminPdfResponse = await get(
      `/api/receipts/customer-subscriptions/${finalizedReceipt.id}/pdf`,
      adminToken
    );
    assert.equal(adminPdfResponse.status, 200);
    assert.equal(adminPdfResponse.headers.get("cache-control"), "private, no-store");
    const adminDownloadedPdf = Buffer.from(await adminPdfResponse.arrayBuffer());
    assert.equal(adminDownloadedPdf.subarray(0, 5).toString(), "%PDF-");
    assert.deepEqual(adminDownloadedPdf, Buffer.from(finalizedReceipt.pdfBytes));

    const unauthenticatedResponse = await get(
      `/api/customer-portal/subscriptions/receipts/${finalizedReceipt.id}/pdf`
    );
    assert.equal(unauthenticatedResponse.status, 401);
    const otherCustomerResponse = await get(
      `/api/customer-portal/subscriptions/receipts/${finalizedReceipt.id}/pdf`,
      otherCustomerToken
    );
    assert.equal(otherCustomerResponse.status, 404);
    const otherAdminResponse = await get(
      `/api/receipts/customer-subscriptions/${finalizedReceipt.id}/pdf`,
      otherAdminToken
    );
    assert.equal(otherAdminResponse.status, 404);
    const otherAdminListResponse = await get(
      "/api/receipts/customer-subscriptions",
      otherAdminToken
    );
    assert.equal(otherAdminListResponse.status, 200);
    assert.deepEqual((await otherAdminListResponse.json()).receipts, []);

    const emailAttempts = await prisma.emailDeliveryAttempt.findMany({
      where: { customerId: customer.id, purpose: "PAYMENT_RECEIPT" }
    });
    assert.equal(emailAttempts.length, 2);
    assert.ok(emailAttempts.some((attempt) => attempt.status === "SMTP_ACCEPTED"));
    assert.ok(emailAttempts.some((attempt) => attempt.status === "DISABLED"));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));

    if (organisation) {
      await prisma.emailDeliveryAttempt.deleteMany({
        where: { customerId: customer?.id }
      });
      await prisma.customerSubscriptionWebhookEvent.deleteMany({
        where: { organisationId: organisation.id }
      });
      await prisma.customerSubscriptionReceipt.deleteMany({
        where: { organisationId: organisation.id }
      });
      await prisma.customerSubscriptionInvoice.deleteMany({
        where: { organisationId: organisation.id }
      });
      await prisma.customerSubscriptionPayment.deleteMany({
        where: { organisationId: organisation.id }
      });
      await prisma.customerSubscription.deleteMany({
        where: { organisationId: organisation.id }
      });
      await prisma.customerSubscriptionPlan.deleteMany({
        where: { organisationId: organisation.id }
      });
      await prisma.auditLog.deleteMany({
        where: { organisationId: organisation.id }
      });
      await prisma.customerPortalAccount.deleteMany({
        where: { customerId: { in: [customer?.id, otherCustomer?.id].filter(Boolean) } }
      });
      await prisma.user.deleteMany({
        where: { organisationId: { in: [organisation.id, otherOrganisation?.id].filter(Boolean) } }
      });
      await prisma.customer.deleteMany({
        where: { organisationId: { in: [organisation.id, otherOrganisation?.id].filter(Boolean) } }
      });
      await prisma.organisation.deleteMany({
        where: { id: { in: [organisation.id, otherOrganisation?.id].filter(Boolean) } }
      });
    } else if (otherOrganisation) {
      await prisma.user.deleteMany({
        where: { organisationId: otherOrganisation.id }
      });
      await prisma.customer.deleteMany({
        where: { organisationId: otherOrganisation.id }
      });
      await prisma.organisation.delete({
        where: { id: otherOrganisation.id }
      });
    }

    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  await prisma.$disconnect();
});
