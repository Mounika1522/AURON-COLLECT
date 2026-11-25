-- CreateTable
CREATE TABLE "PromiseToPay" (
    "id" TEXT NOT NULL,
    "promisedAmount" DECIMAL(14,2) NOT NULL,
    "promisedDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROMISED',
    "notes" TEXT,
    "recordedBy" TEXT,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromiseToPay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromiseToPay_organisationId_idx" ON "PromiseToPay"("organisationId");

-- CreateIndex
CREATE INDEX "PromiseToPay_customerId_idx" ON "PromiseToPay"("customerId");

-- CreateIndex
CREATE INDEX "PromiseToPay_invoiceId_idx" ON "PromiseToPay"("invoiceId");

-- CreateIndex
CREATE INDEX "PromiseToPay_promisedDate_idx" ON "PromiseToPay"("promisedDate");

-- CreateIndex
CREATE INDEX "PromiseToPay_status_idx" ON "PromiseToPay"("status");

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
