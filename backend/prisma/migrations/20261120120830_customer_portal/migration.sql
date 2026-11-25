-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CustomerPortalAccount" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "verificationTokenHash" TEXT,
    "verificationTokenExpiresAt" TIMESTAMP(3),
    "verificationSentAt" TIMESTAMP(3),
    "passwordResetTokenHash" TEXT,
    "passwordResetExpiresAt" TIMESTAMP(3),
    "passwordResetSentAt" TIMESTAMP(3),
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPortalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNotification" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "receiptId" TEXT,
    "reminderId" TEXT,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" TEXT,

    CONSTRAINT "CustomerNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "customerId" TEXT,
    "invoiceId" TEXT,
    "receiptId" TEXT,
    "purpose" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attemptedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalAccount_customerId_key" ON "CustomerPortalAccount"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalAccount_email_key" ON "CustomerPortalAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalAccount_verificationTokenHash_key" ON "CustomerPortalAccount"("verificationTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalAccount_passwordResetTokenHash_key" ON "CustomerPortalAccount"("passwordResetTokenHash");

-- CreateIndex
CREATE INDEX "CustomerPortalAccount_emailVerifiedAt_idx" ON "CustomerPortalAccount"("emailVerifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerNotification_reminderId_key" ON "CustomerNotification"("reminderId");

-- CreateIndex
CREATE INDEX "CustomerNotification_customerId_organisationId_createdAt_idx" ON "CustomerNotification"("customerId", "organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerNotification_customerId_readAt_createdAt_idx" ON "CustomerNotification"("customerId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "EmailDeliveryAttempt_customerAccountId_purpose_createdAt_idx" ON "EmailDeliveryAttempt"("customerAccountId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "EmailDeliveryAttempt_customerId_createdAt_idx" ON "EmailDeliveryAttempt"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailDeliveryAttempt_status_createdAt_idx" ON "EmailDeliveryAttempt"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerPortalAccount" ADD CONSTRAINT "CustomerPortalAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNotification" ADD CONSTRAINT "CustomerNotification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNotification" ADD CONSTRAINT "CustomerNotification_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNotification" ADD CONSTRAINT "CustomerNotification_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNotification" ADD CONSTRAINT "CustomerNotification_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNotification" ADD CONSTRAINT "CustomerNotification_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNotification" ADD CONSTRAINT "CustomerNotification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerPortalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDeliveryAttempt" ADD CONSTRAINT "EmailDeliveryAttempt_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerPortalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDeliveryAttempt" ADD CONSTRAINT "EmailDeliveryAttempt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDeliveryAttempt" ADD CONSTRAINT "EmailDeliveryAttempt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDeliveryAttempt" ADD CONSTRAINT "EmailDeliveryAttempt_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
