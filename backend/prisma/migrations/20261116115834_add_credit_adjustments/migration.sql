-- CreateTable
CREATE TABLE "CreditAdjustment" (
    "id" TEXT NOT NULL,
    "adjustmentNumber" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "invoiceId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditAdjustment_organisationId_idx" ON "CreditAdjustment"("organisationId");

-- CreateIndex
CREATE INDEX "CreditAdjustment_invoiceId_idx" ON "CreditAdjustment"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditAdjustment_status_idx" ON "CreditAdjustment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CreditAdjustment_adjustmentNumber_organisationId_key" ON "CreditAdjustment"("adjustmentNumber", "organisationId");

-- AddForeignKey
ALTER TABLE "CreditAdjustment" ADD CONSTRAINT "CreditAdjustment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditAdjustment" ADD CONSTRAINT "CreditAdjustment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
