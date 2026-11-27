import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";
import customerAuthRoutes from "../routes/customer-auth.routes.js";
import customerPortalRoutes from "../routes/customer-portal.routes.js";
import customerRoutes from "../routes/customer.routes.js";
import { hashCustomerEmailOtp } from "../services/customer-email-otp.js";
import {
  notifyCustomerInvoice,
  notifyCustomerReminder
} from "../services/customer-portal-notification.service.js";

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const app = express();
app.use(express.json());
app.use("/api/customer-auth", customerAuthRoutes);
app.use("/api/customer-portal", customerPortalRoutes);
app.use("/api/customers", customerRoutes);
app.use((req, res) => res.status(404).json({ success: false }));

test("customer portal registration, verification, isolation, password reset, and logout", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDeliveryMode = process.env.NOTIFICATION_DELIVERY_MODE;
  const originalAuthEmailSetting = process.env.AUTH_EMAIL_DELIVERY_ENABLED;
  const originalSchedulerMode = process.env.REMINDER_SCHEDULER_ENABLED;
  process.env.NODE_ENV = "test";
  process.env.NOTIFICATION_DELIVERY_MODE = "disabled";
  process.env.AUTH_EMAIL_DELIVERY_ENABLED = "false";
  process.env.REMINDER_SCHEDULER_ENABLED = "false";

  const database = new URL(process.env.DATABASE_URL || "");
  const databaseName = decodeURIComponent(database.pathname.replace(/^\/+/, ""));
  assert.equal(databaseName, "auron_collect_app_dev", "integration tests require the development database");

  let server;
  let organisation;
  let customer;
  let otherCustomer;
  let invoice;
  let otherInvoice;
  const customerPlans = [];
  const suffix = crypto.randomUUID();
  const email = `portal-test-${suffix}@example.invalid`;
  const phone = `+1555${suffix.replace(/\D/g, "").slice(0, 10).padEnd(10, "7")}`;
  const originalPassword = "Portal-Test-Password-94!";
  const newPassword = "Portal-Test-Password-95!";

  try {
    organisation = await prisma.organisation.create({
      data: { name: `Portal Integration ${suffix}` }
    });
    customer = await prisma.customer.create({
      data: {
        customerCode: `PORTAL-${suffix}`,
        name: "Portal Integration Customer",
        contactPerson: "Portal Test",
        email,
        phone,
        status: "ACTIVE",
        organisationId: organisation.id
      }
    });
    otherCustomer = await prisma.customer.create({
      data: {
        customerCode: `PORTAL-OTHER-${suffix}`,
        name: "Other Portal Test Customer",
        email: `other-${suffix}@example.invalid`,
        phone: `+1555${suffix.replace(/\D/g, "").slice(0, 10).padEnd(10, "8")}`,
        status: "ACTIVE",
        organisationId: organisation.id
      }
    });

    const listener = await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve(server));
    });
    const baseUrl = `http://127.0.0.1:${listener.address().port}`;
    const post = (path, body, token) =>
      fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
      });

    const noMatch = await post("/api/customer-auth/register", {
      fullName: "Portal Test",
      email: `missing-${suffix}@example.invalid`,
      phone,
      password: originalPassword,
      confirmPassword: originalPassword
    });
    assert.equal(noMatch.status, 202);
    const genericRegistrationResponse = await noMatch.json();
    assert.deepEqual(Object.keys(genericRegistrationResponse), ["message"]);

    const clientIds = await post("/api/customer-auth/register", {
      fullName: "Portal Test",
      email,
      phone,
      password: originalPassword,
      confirmPassword: originalPassword,
      customerId: customer.id,
      organisationId: organisation.id
    });
    assert.equal(clientIds.status, 400);

    const ambiguousCustomer = await prisma.customer.create({
      data: {
        customerCode: `PORTAL-DUP-${suffix}`,
        name: "Ambiguous Portal Test",
        email,
        phone,
        status: "ACTIVE",
        organisationId: organisation.id
      }
    });
    const ambiguous = await post("/api/customer-auth/register", {
      fullName: "Portal Test",
      email,
      phone,
      password: originalPassword,
      confirmPassword: originalPassword
    });
    assert.equal(ambiguous.status, 202);
    assert.deepEqual(await ambiguous.json(), genericRegistrationResponse);
    await prisma.customer.delete({ where: { id: ambiguousCustomer.id } });

    const registration = await post("/api/customer-auth/register", {
      fullName: "Portal Test",
      email: email.toUpperCase(),
      phone: phone.replace("+1", "1 "),
      password: originalPassword,
      confirmPassword: originalPassword
    });
    assert.equal(registration.status, 202);
    const registrationData = await registration.json();
    assert.deepEqual(registrationData, genericRegistrationResponse);
    assert.doesNotMatch(JSON.stringify(registrationData), /\b\d{6}\b/);
    const portalAccount = await prisma.customerPortalAccount.findUnique({
      where: { customerId: customer.id }
    });
    assert.notEqual(portalAccount.passwordHash, originalPassword);
    assert.equal(portalAccount.emailVerifiedAt, null);
    assert.match(portalAccount.verificationOtpHash, /^[a-f0-9]{64}$/);
    assert.equal(portalAccount.verificationOtpAttemptCount, 0);
    assert.ok(portalAccount.verificationOtpExpiresAt > new Date());

    const duplicate = await post("/api/customer-auth/register", {
      fullName: "Portal Test",
      email,
      phone,
      password: originalPassword,
      confirmPassword: originalPassword
    });
    assert.equal(duplicate.status, 202);
    assert.deepEqual(await duplicate.json(), genericRegistrationResponse);

    const unverifiedLogin = await post("/api/customer-auth/login", {
      email,
      password: originalPassword
    });
    assert.equal(unverifiedLogin.status, 403);

    const registrationOtpHash = portalAccount.verificationOtpHash;
    const immediateResend = await post("/api/customer-auth/resend-verification", { email });
    assert.equal(immediateResend.status, 202);
    const accountAfterCooldownRequest = await prisma.customerPortalAccount.findUnique({
      where: { customerId: customer.id }
    });
    assert.equal(accountAfterCooldownRequest.verificationOtpHash, registrationOtpHash);

    const expiredOtp = "123456";
    await prisma.customerPortalAccount.update({
      where: { customerId: customer.id },
      data: {
        verificationOtpHash: hashCustomerEmailOtp(expiredOtp),
        verificationOtpExpiresAt: new Date(Date.now() - 1000),
        verificationOtpAttemptCount: 0
      }
    });
    const expiredVerification = await post("/api/customer-auth/verify-email", {
      email,
      otp: expiredOtp
    });
    assert.equal(expiredVerification.status, 400);

    await prisma.customerPortalAccount.update({
      where: { customerId: customer.id },
      data: { verificationOtpSentAt: new Date(Date.now() - 61_000) }
    });
    const resend = await post("/api/customer-auth/resend-verification", { email });
    assert.equal(resend.status, 202);
    const accountAfterResend = await prisma.customerPortalAccount.findUnique({
      where: { customerId: customer.id }
    });
    assert.match(accountAfterResend.verificationOtpHash, /^[a-f0-9]{64}$/);
    assert.equal(accountAfterResend.verificationOtpAttemptCount, 0);
    assert.ok(accountAfterResend.verificationOtpExpiresAt > new Date());

    const immediateSecondResend = await post("/api/customer-auth/resend-verification", { email });
    assert.equal(immediateSecondResend.status, 202);
    assert.equal(
      await prisma.emailDeliveryAttempt.count({
        where: { customerId: customer.id, purpose: "EMAIL_VERIFICATION" }
      }),
      2
    );
    const verificationAttempts = await prisma.emailDeliveryAttempt.findMany({
      where: { customerId: customer.id, purpose: "EMAIL_VERIFICATION" },
      select: { recipient: true },
      orderBy: { createdAt: "asc" }
    });
    assert.deepEqual(
      verificationAttempts.map((attempt) => attempt.recipient),
      [email, email]
    );

    const correctOtp = "654321";
    await prisma.customerPortalAccount.update({
      where: { customerId: customer.id },
      data: {
        verificationOtpHash: hashCustomerEmailOtp(correctOtp),
        verificationOtpExpiresAt: new Date(Date.now() + 60_000),
        verificationOtpAttemptCount: 0
      }
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const incorrectVerification = await post("/api/customer-auth/verify-email", {
        email,
        otp: "000000"
      });
      assert.equal(incorrectVerification.status, 400);
    }
    const exhaustedAccount = await prisma.customerPortalAccount.findUnique({
      where: { customerId: customer.id }
    });
    assert.equal(exhaustedAccount.verificationOtpAttemptCount, 5);
    const exhaustedVerification = await post("/api/customer-auth/verify-email", {
      email,
      otp: correctOtp
    });
    assert.equal(exhaustedVerification.status, 400);

    await prisma.customerPortalAccount.update({
      where: { customerId: customer.id },
      data: { verificationOtpAttemptCount: 0 }
    });
    const verification = await post("/api/customer-auth/verify-email", {
      email,
      otp: correctOtp
    });
    assert.equal(verification.status, 200);
    const reusedVerification = await post("/api/customer-auth/verify-email", {
      email,
      otp: correctOtp
    });
    assert.equal(reusedVerification.status, 400);

    invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `PORTAL-INV-${suffix}`,
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 10 * 86_400_000),
        subtotal: new Prisma.Decimal("125.50"),
        tax: new Prisma.Decimal("0"),
        discount: new Prisma.Decimal("0"),
        total: new Prisma.Decimal("125.50"),
        status: "ISSUED",
        customerId: customer.id,
        organisationId: organisation.id
      }
    });
    otherInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `OTHER-INV-${suffix}`,
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 10 * 86_400_000),
        subtotal: new Prisma.Decimal("999.99"),
        tax: new Prisma.Decimal("0"),
        discount: new Prisma.Decimal("0"),
        total: new Prisma.Decimal("999.99"),
        status: "ISSUED",
        customerId: otherCustomer.id,
        organisationId: organisation.id
      }
    });
    const otherNotification = await prisma.customerNotification.create({
      data: {
        customerId: otherCustomer.id,
        organisationId: organisation.id,
        eventType: "PAYMENT_RECEIVED",
        title: "Other customer's notification",
        message: "Must not be visible to this customer."
      }
    });

    const notificationResult = await notifyCustomerInvoice(invoice);
    assert.equal(notificationResult.emailStatus, "DISABLED");
    const disabledEmailAttempt = await prisma.emailDeliveryAttempt.findFirst({
      where: { customerId: customer.id, purpose: "INVOICE_GENERATED" }
    });
    assert.equal(disabledEmailAttempt.status, "DISABLED");
    assert.equal(disabledEmailAttempt.acceptedAt, null);

    const login = await post("/api/customer-auth/login", {
      email,
      password: originalPassword
    });
    assert.equal(login.status, 200);
    const { token, user } = await login.json();
    assert.equal(user.customerId, customer.id);

    customerPlans.push(
      await prisma.customerSubscriptionPlan.create({
        data: {
          organisationId: organisation.id,
          code: `business-${suffix}`,
          name: "Business Customer Plan",
          monthlyPrice: new Prisma.Decimal("100.00"),
          quarterlyPrice: new Prisma.Decimal("275.00"),
          halfYearlyPrice: new Prisma.Decimal("525.00"),
          yearlyPrice: new Prisma.Decimal("1000.00"),
          currency: "INR",
          features: ["Business support"],
          usageLimits: { seats: 5 },
          eligibleCustomerTypes: ["BUSINESS"],
          pricingStatus: "APPROVED",
          pricingProposalStatus: "APPROVED",
          taxTerms: "GST as applicable",
          taxTermsStatus: "APPROVED",
          taxProposalStatus: "APPROVED",
          isActive: true
        }
      }),
      await prisma.customerSubscriptionPlan.create({
        data: {
          organisationId: organisation.id,
          code: `individual-${suffix}`,
          name: "Individual Customer Plan",
          monthlyPrice: new Prisma.Decimal("50.00"),
          currency: "INR",
          eligibleCustomerTypes: ["INDIVIDUAL"],
          pricingStatus: "APPROVED",
          pricingProposalStatus: "APPROVED",
          taxTerms: "GST as applicable",
          taxTermsStatus: "APPROVED",
          taxProposalStatus: "APPROVED",
          isActive: true
        }
      })
    );

    const get = (path, authToken = token) =>
      fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
    const profile = await get("/api/customer-portal/profile");
    assert.equal(profile.status, 200);
    const profileData = await profile.json();
    assert.equal(profileData.profile.customer.id, customer.id);
    assert.equal(profileData.profile.timeZone, "Asia/Kolkata");

    const subscriptionPlans = await get("/api/customer-portal/subscriptions");
    const subscriptionPlanData = await subscriptionPlans.json();
    assert.deepEqual(subscriptionPlanData.plans.map((plan) => plan.id), [customerPlans[0].id]);
    assert.equal(subscriptionPlanData.plans[0].quarterlyPrice, 275);
    assert.deepEqual(subscriptionPlanData.plans[0].features, ["Business support"]);
    assert.deepEqual(subscriptionPlanData.plans[0].usageLimits, { seats: 5 });

    const dashboard = await get("/api/customer-portal/dashboard");
    const dashboardData = await dashboard.json();
    assert.equal(dashboardData.dashboard.totalInvoices, 1);
    assert.equal(dashboardData.dashboard.outstandingAmount, 125.5);
    assert.deepEqual(dashboardData.dashboard.recentTransactions, []);

    const invoiceList = await get("/api/customer-portal/invoices?customerId=" + encodeURIComponent(otherCustomer.id));
    const invoiceData = await invoiceList.json();
    assert.deepEqual(invoiceData.invoices.map((item) => item.id), [invoice.id]);

    const ownPdf = await get(`/api/customer-portal/invoices/${invoice.id}/pdf`);
    assert.equal(ownPdf.status, 200);
    assert.match(ownPdf.headers.get("content-type"), /application\/pdf/);
    assert.equal((await ownPdf.arrayBuffer()).byteLength > 100, true);

    const otherPdf = await get(`/api/customer-portal/invoices/${otherInvoice.id}/pdf`);
    assert.equal(otherPdf.status, 404);
    const paymentHistory = await get("/api/customer-portal/receipts");
    assert.deepEqual((await paymentHistory.json()).receipts, []);

    const assistantAnswer = await post(
      "/api/customer-portal/assistant/chat",
      { message: "What is my outstanding balance?" },
      token
    );
    assert.equal(assistantAnswer.status, 200);
    const assistantAnswerData = await assistantAnswer.json();
    assert.match(assistantAnswerData.reply, /125\.50/);
    assert.doesNotMatch(assistantAnswerData.reply, /999\.99/);
    const assistantHistory = await get("/api/customer-portal/assistant/history");
    const assistantMessages = (await assistantHistory.json()).messages;
    assert.deepEqual(assistantMessages.map((item) => item.role), ["user", "assistant"]);
    assert.doesNotMatch(assistantMessages[1].content, /999\.99/);

    const notificationList = await get("/api/customer-portal/notifications");
    const notifications = (await notificationList.json()).notifications;
    assert.equal(notifications.some((item) => item.id === otherNotification.id), false);
    const foreignRead = await fetch(
      `${baseUrl}/api/customer-portal/notifications/${otherNotification.id}/read`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({})
      }
    );
    assert.equal(foreignRead.status, 404);
    const ownNotification = notifications.find(
      (item) => item.eventType === "ACCOUNT_VERIFIED"
    );
    const ownRead = await fetch(
      `${baseUrl}/api/customer-portal/notifications/${ownNotification.id}/read`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({})
      }
    );
    assert.equal(ownRead.status, 200);

    const profileUpdate = await fetch(`${baseUrl}/api/customer-portal/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        fullName: "Updated Portal Test",
        timeZone: "America/New_York"
      })
    });
    assert.equal(profileUpdate.status, 200);
    const updatedProfile = await get("/api/customer-portal/profile");
    const updatedProfileData = await updatedProfile.json();
    assert.equal(updatedProfileData.profile.fullName, "Updated Portal Test");
    assert.equal(updatedProfileData.profile.timeZone, "America/New_York");
    const customerReminders = await prisma.reminder.findMany({
      where: { invoiceId: invoice.id, organisationId: organisation.id }
    });
    assert.equal(customerReminders.length, 3);
    for (const reminder of customerReminders) {
      const localHour = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        hourCycle: "h23"
      }).format(reminder.scheduledFor);
      assert.equal(localHour, "09");
    }

    const invalidTimeZoneUpdate = await fetch(`${baseUrl}/api/customer-portal/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ timeZone: "not/a-time-zone" })
    });
    assert.equal(invalidTimeZoneUpdate.status, 400);

    await prisma.customer.update({
      where: { id: customer.id },
      data: { email: `crm-unverified-${suffix}@example.invalid` }
    });
    const reminder = await prisma.reminder.create({
      data: {
        scheduledFor: new Date(Date.now() + 60_000),
        channel: "EMAIL",
        subject: "Payment due",
        message: "Reminder message",
        dedupeKey: `invoice:${invoice.id}:test:${suffix}:EMAIL`,
        organisationId: organisation.id,
        customerId: customer.id,
        invoiceId: invoice.id
      },
      include: { customer: true, invoice: true }
    });
    const reminderResult = await notifyCustomerReminder({
      ...reminder,
      outstanding: 125.5
    });
    assert.equal(reminderResult.emailStatus, "DISABLED");
    const reminderAttempt = await prisma.emailDeliveryAttempt.findUnique({
      where: { reminderId: reminder.id }
    });
    assert.equal(reminderAttempt.recipient, email);
    assert.equal(reminderAttempt.status, "DISABLED");

    const adminApi = await get("/api/customers");
    assert.equal(adminApi.status, 401);

    const forgot = await post("/api/customer-auth/password/forgot", { email });
    assert.equal(forgot.status, 202);
    const resetToken = crypto.randomBytes(32).toString("base64url");
    await prisma.customerPortalAccount.update({
      where: { customerId: customer.id },
      data: {
        passwordResetTokenHash: hashToken(resetToken),
        passwordResetExpiresAt: new Date(Date.now() + 60_000)
      }
    });
    const reset = await post("/api/customer-auth/password/reset", {
      token: resetToken,
      password: newPassword,
      confirmPassword: newPassword
    });
    assert.equal(reset.status, 200);
    const oldTokenProfile = await get("/api/customer-portal/profile", token);
    assert.equal(oldTokenProfile.status, 401);

    const oldPasswordLogin = await post("/api/customer-auth/login", {
      email,
      password: originalPassword
    });
    assert.equal(oldPasswordLogin.status, 401);
    const newPasswordLogin = await post("/api/customer-auth/login", {
      email,
      password: newPassword
    });
    assert.equal(newPasswordLogin.status, 200);
    const newSession = await newPasswordLogin.json();
    const logout = await post("/api/customer-auth/logout", {}, newSession.token);
    assert.equal(logout.status, 200);
    const loggedOutProfile = await get("/api/customer-portal/profile", newSession.token);
    assert.equal(loggedOutProfile.status, 401);
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (organisation) {
      await prisma.emailDeliveryAttempt.deleteMany({
        where: { customerId: { in: [customer?.id, otherCustomer?.id].filter(Boolean) } }
      });
      await prisma.customerNotification.deleteMany({
        where: { organisationId: organisation.id }
      });
      await prisma.reminder.deleteMany({
        where: { organisationId: organisation.id }
      });
      await prisma.invoice.deleteMany({
        where: { organisationId: organisation.id }
      });
      await prisma.customerSubscriptionPlan.deleteMany({
        where: { organisationId: organisation.id }
      });
      await prisma.customer.deleteMany({
        where: { organisationId: organisation.id }
      });
      await prisma.organisation.delete({ where: { id: organisation.id } });
    }
    await prisma.$disconnect();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalDeliveryMode === undefined) delete process.env.NOTIFICATION_DELIVERY_MODE;
    else process.env.NOTIFICATION_DELIVERY_MODE = originalDeliveryMode;
    if (originalAuthEmailSetting === undefined) delete process.env.AUTH_EMAIL_DELIVERY_ENABLED;
    else process.env.AUTH_EMAIL_DELIVERY_ENABLED = originalAuthEmailSetting;
    if (originalSchedulerMode === undefined) delete process.env.REMINDER_SCHEDULER_ENABLED;
    else process.env.REMINDER_SCHEDULER_ENABLED = originalSchedulerMode;
  }
});
