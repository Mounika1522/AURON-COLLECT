ALTER TABLE "BillingPayment"
  ADD COLUMN "customerId" TEXT;

ALTER TABLE "EmailDeliveryAttempt"
  ADD COLUMN "billingPaymentId" TEXT;

CREATE TABLE "BillingPaymentReceipt" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "pdfBytes" BYTEA NOT NULL,
  "pdfSha256" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingPaymentReceipt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BillingPayment_customerId_idx"
  ON "BillingPayment"("customerId");

CREATE UNIQUE INDEX "EmailDeliveryAttempt_billingPaymentId_key"
  ON "EmailDeliveryAttempt"("billingPaymentId");

CREATE UNIQUE INDEX "BillingPaymentReceipt_paymentId_key"
  ON "BillingPaymentReceipt"("paymentId");

CREATE UNIQUE INDEX "BillingPaymentReceipt_organisationId_receiptNumber_key"
  ON "BillingPaymentReceipt"("organisationId", "receiptNumber");

CREATE INDEX "BillingPaymentReceipt_organisationId_createdAt_idx"
  ON "BillingPaymentReceipt"("organisationId", "createdAt");

ALTER TABLE "BillingPayment"
  ADD CONSTRAINT "BillingPayment_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmailDeliveryAttempt"
  ADD CONSTRAINT "EmailDeliveryAttempt_billingPaymentId_fkey"
  FOREIGN KEY ("billingPaymentId") REFERENCES "BillingPayment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BillingPaymentReceipt"
  ADD CONSTRAINT "BillingPaymentReceipt_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingPaymentReceipt"
  ADD CONSTRAINT "BillingPaymentReceipt_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "BillingPayment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
