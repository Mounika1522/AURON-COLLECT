ALTER TABLE "SubscriptionPlan"
  ADD COLUMN "proposedMonthlyPrice" DECIMAL(14,2),
  ADD COLUMN "proposedYearlyPrice" DECIMAL(14,2),
  ADD COLUMN "pricingStatus" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  ADD COLUMN "pricingApprovedAt" TIMESTAMP(3),
  ADD COLUMN "pricingApprovedBy" TEXT,
  ADD COLUMN "proposedMaxUsers" INTEGER,
  ADD COLUMN "proposedMaxCustomers" INTEGER,
  ADD COLUMN "proposedMaxInvoicesPerMonth" INTEGER,
  ADD COLUMN "limitsStatus" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  ADD COLUMN "limitsApprovedAt" TIMESTAMP(3),
  ADD COLUMN "limitsApprovedBy" TEXT;

UPDATE "SubscriptionPlan"
SET "proposedMonthlyPrice" = "monthlyPrice",
    "proposedYearlyPrice" = "yearlyPrice",
    "monthlyPrice" = NULL,
    "yearlyPrice" = NULL,
    "isActive" = false;

ALTER TABLE "SubscriptionPlan" ALTER COLUMN "isActive" SET DEFAULT false;

ALTER TABLE "Subscription"
  ADD COLUMN "billingAmount" DECIMAL(14,2),
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';

CREATE TABLE "BillingPayment" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "billingCycle" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'CREATING',
  "idempotencyKey" TEXT NOT NULL,
  "razorpayOrderId" TEXT,
  "razorpayPaymentId" TEXT,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "periodEndsAt" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingInvoice" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "planName" TEXT NOT NULL,
  "billingCycle" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RazorpayWebhookEvent" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT,
  "billingPaymentId" TEXT,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  CONSTRAINT "RazorpayWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingPayment_subscriptionId_key" ON "BillingPayment"("subscriptionId");
CREATE UNIQUE INDEX "BillingPayment_razorpayOrderId_key" ON "BillingPayment"("razorpayOrderId");
CREATE UNIQUE INDEX "BillingPayment_razorpayPaymentId_key" ON "BillingPayment"("razorpayPaymentId");
CREATE UNIQUE INDEX "BillingPayment_organisationId_idempotencyKey_key" ON "BillingPayment"("organisationId", "idempotencyKey");
CREATE INDEX "BillingPayment_organisationId_status_createdAt_idx" ON "BillingPayment"("organisationId", "status", "createdAt");
CREATE INDEX "BillingPayment_effectiveAt_idx" ON "BillingPayment"("effectiveAt");

CREATE UNIQUE INDEX "BillingInvoice_paymentId_key" ON "BillingInvoice"("paymentId");
CREATE UNIQUE INDEX "BillingInvoice_organisationId_invoiceNumber_key" ON "BillingInvoice"("organisationId", "invoiceNumber");
CREATE INDEX "BillingInvoice_organisationId_createdAt_idx" ON "BillingInvoice"("organisationId", "createdAt");

CREATE UNIQUE INDEX "RazorpayWebhookEvent_providerEventId_key" ON "RazorpayWebhookEvent"("providerEventId");
CREATE INDEX "RazorpayWebhookEvent_status_receivedAt_idx" ON "RazorpayWebhookEvent"("status", "receivedAt");
CREATE INDEX "RazorpayWebhookEvent_billingPaymentId_idx" ON "RazorpayWebhookEvent"("billingPaymentId");

CREATE INDEX "AuditLog_organisationId_createdAt_idx" ON "AuditLog"("organisationId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "BillingPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RazorpayWebhookEvent" ADD CONSTRAINT "RazorpayWebhookEvent_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RazorpayWebhookEvent" ADD CONSTRAINT "RazorpayWebhookEvent_billingPaymentId_fkey"
  FOREIGN KEY ("billingPaymentId") REFERENCES "BillingPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
