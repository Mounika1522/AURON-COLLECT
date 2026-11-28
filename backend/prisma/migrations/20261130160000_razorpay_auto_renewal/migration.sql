ALTER TABLE "Subscription"
  ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoRenewRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "razorpaySubscriptionId" TEXT,
  ADD COLUMN "razorpayCustomerId" TEXT,
  ADD COLUMN "razorpayTokenId" TEXT,
  ADD COLUMN "paymentMethod" TEXT,
  ADD COLUMN "nextRenewalDate" TIMESTAMP(3),
  ADD COLUMN "lastRenewalStatus" TEXT NOT NULL DEFAULT 'NOT_SCHEDULED',
  ADD COLUMN "renewalAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "BillingPayment"
  ADD COLUMN "autoRenewRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "razorpayCustomerId" TEXT,
  ADD COLUMN "razorpayTokenId" TEXT,
  ADD COLUMN "paymentMethod" TEXT,
  ADD COLUMN "renewalSourceSubscriptionId" TEXT;

ALTER TABLE "CustomerSubscription"
  ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoRenewRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "razorpaySubscriptionId" TEXT,
  ADD COLUMN "razorpayCustomerId" TEXT,
  ADD COLUMN "razorpayTokenId" TEXT,
  ADD COLUMN "paymentMethod" TEXT,
  ADD COLUMN "nextRenewalDate" TIMESTAMP(3),
  ADD COLUMN "lastRenewalStatus" TEXT NOT NULL DEFAULT 'NOT_SCHEDULED',
  ADD COLUMN "renewalAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CustomerSubscriptionPayment"
  ADD COLUMN "autoRenewRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "razorpayCustomerId" TEXT,
  ADD COLUMN "razorpayTokenId" TEXT,
  ADD COLUMN "renewalSourceSubscriptionId" TEXT;

CREATE INDEX "Subscription_autoRenew_nextRenewalDate_idx"
  ON "Subscription"("autoRenew", "nextRenewalDate");
CREATE INDEX "Subscription_razorpayCustomerId_idx"
  ON "Subscription"("razorpayCustomerId");
CREATE INDEX "CustomerSubscription_autoRenew_nextRenewalDate_idx"
  ON "CustomerSubscription"("autoRenew", "nextRenewalDate");
CREATE INDEX "CustomerSubscription_razorpayCustomerId_idx"
  ON "CustomerSubscription"("razorpayCustomerId");
