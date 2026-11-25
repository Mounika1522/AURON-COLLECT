CREATE TABLE "CustomerSubscriptionPlan" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "proposedMonthlyPrice" DECIMAL(14,2),
    "proposedYearlyPrice" DECIMAL(14,2),
    "monthlyPrice" DECIMAL(14,2),
    "yearlyPrice" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "pricingStatus" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "pricingProposalStatus" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "pricingApprovedAt" TIMESTAMP(3),
    "pricingApprovedBy" TEXT,
    "proposedTaxTerms" TEXT,
    "taxTerms" TEXT,
    "taxTermsStatus" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "taxProposalStatus" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "taxApprovedAt" TIMESTAMP(3),
    "taxApprovedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerSubscriptionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerSubscription" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "replacesSubscriptionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "billingCycle" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "renewalAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerSubscriptionPayment" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "taxTerms" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATING',
    "idempotencyKey" TEXT NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerSubscriptionPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerSubscriptionInvoice" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "taxTerms" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerSubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerSubscriptionReceipt" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerSubscriptionReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerSubscriptionWebhookEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "customerId" TEXT,
    "paymentId" TEXT,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    CONSTRAINT "CustomerSubscriptionWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerSubscriptionPlan_organisationId_code_key"
    ON "CustomerSubscriptionPlan"("organisationId", "code");
CREATE INDEX "CustomerSubscriptionPlan_organisationId_isActive_idx"
    ON "CustomerSubscriptionPlan"("organisationId", "isActive");

CREATE INDEX "CustomerSubscription_org_customer_status_idx"
    ON "CustomerSubscription"("organisationId", "customerId", "status");
CREATE INDEX "CustomerSubscription_planId_idx"
    ON "CustomerSubscription"("planId");
CREATE INDEX "CustomerSubscription_startsAt_endsAt_idx"
    ON "CustomerSubscription"("startsAt", "endsAt");

CREATE UNIQUE INDEX "CustomerSubscriptionPayment_subscriptionId_key"
    ON "CustomerSubscriptionPayment"("subscriptionId");
CREATE UNIQUE INDEX "CustomerSubscriptionPayment_razorpayOrderId_key"
    ON "CustomerSubscriptionPayment"("razorpayOrderId");
CREATE UNIQUE INDEX "CustomerSubscriptionPayment_razorpayPaymentId_key"
    ON "CustomerSubscriptionPayment"("razorpayPaymentId");
CREATE UNIQUE INDEX "CustomerSubscriptionPayment_org_customer_idem_key"
    ON "CustomerSubscriptionPayment"("organisationId", "customerId", "idempotencyKey");
CREATE INDEX "CustomerSubscriptionPayment_org_customer_status_idx"
    ON "CustomerSubscriptionPayment"("organisationId", "customerId", "status", "createdAt");
CREATE INDEX "CustomerSubscriptionPayment_periodStart_periodEnd_idx"
    ON "CustomerSubscriptionPayment"("periodStart", "periodEnd");

CREATE UNIQUE INDEX "CustomerSubscriptionInvoice_org_invoice_key"
    ON "CustomerSubscriptionInvoice"("organisationId", "invoiceNumber");
CREATE UNIQUE INDEX "CustomerSubscriptionInvoice_paymentId_key"
    ON "CustomerSubscriptionInvoice"("paymentId");
CREATE INDEX "CustomerSubscriptionInvoice_org_customer_created_idx"
    ON "CustomerSubscriptionInvoice"("organisationId", "customerId", "createdAt");

CREATE UNIQUE INDEX "CustomerSubscriptionReceipt_org_receipt_key"
    ON "CustomerSubscriptionReceipt"("organisationId", "receiptNumber");
CREATE UNIQUE INDEX "CustomerSubscriptionReceipt_paymentId_key"
    ON "CustomerSubscriptionReceipt"("paymentId");
CREATE INDEX "CustomerSubscriptionReceipt_org_customer_created_idx"
    ON "CustomerSubscriptionReceipt"("organisationId", "customerId", "createdAt");

CREATE UNIQUE INDEX "CustomerSubscriptionWebhookEvent_providerEventId_key"
    ON "CustomerSubscriptionWebhookEvent"("providerEventId");
CREATE INDEX "CustomerSubscriptionWebhookEvent_status_receivedAt_idx"
    ON "CustomerSubscriptionWebhookEvent"("status", "receivedAt");
CREATE INDEX "CustomerSubscriptionWebhookEvent_paymentId_idx"
    ON "CustomerSubscriptionWebhookEvent"("paymentId");

ALTER TABLE "CustomerSubscriptionPlan"
    ADD CONSTRAINT "CustomerSubscriptionPlan_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerSubscription"
    ADD CONSTRAINT "CustomerSubscription_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CustomerSubscription_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CustomerSubscription_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "CustomerSubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CustomerSubscription_replacesSubscriptionId_fkey"
    FOREIGN KEY ("replacesSubscriptionId") REFERENCES "CustomerSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerSubscriptionPayment"
    ADD CONSTRAINT "CustomerSubscriptionPayment_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CustomerSubscriptionPayment_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CustomerSubscriptionPayment_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "CustomerSubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CustomerSubscriptionPayment_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "CustomerSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerSubscriptionInvoice"
    ADD CONSTRAINT "CustomerSubscriptionInvoice_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CustomerSubscriptionInvoice_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CustomerSubscriptionInvoice_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "CustomerSubscriptionPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerSubscriptionReceipt"
    ADD CONSTRAINT "CustomerSubscriptionReceipt_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CustomerSubscriptionReceipt_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CustomerSubscriptionReceipt_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "CustomerSubscriptionPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerSubscriptionWebhookEvent"
    ADD CONSTRAINT "CustomerSubscriptionWebhookEvent_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "CustomerSubscriptionWebhookEvent_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "CustomerSubscriptionWebhookEvent_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "CustomerSubscriptionPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
