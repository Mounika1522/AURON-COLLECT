-- CreateTable
CREATE TABLE "Communication" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "outcome" TEXT,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'RECORDED',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerStage" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "organisationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Communication_organisationId_idx" ON "Communication"("organisationId");

-- CreateIndex
CREATE INDEX "Communication_customerId_idx" ON "Communication"("customerId");

-- CreateIndex
CREATE INDEX "Communication_invoiceId_idx" ON "Communication"("invoiceId");

-- CreateIndex
CREATE INDEX "Communication_channel_idx" ON "Communication"("channel");

-- CreateIndex
CREATE INDEX "Communication_occurredAt_idx" ON "Communication"("occurredAt");

-- CreateIndex
CREATE INDEX "ReminderTemplate_organisationId_idx" ON "ReminderTemplate"("organisationId");

-- CreateIndex
CREATE INDEX "ReminderTemplate_triggerStage_idx" ON "ReminderTemplate"("triggerStage");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderTemplate_name_organisationId_key" ON "ReminderTemplate"("name", "organisationId");

-- CreateIndex
CREATE INDEX "Reminder_organisationId_idx" ON "Reminder"("organisationId");

-- CreateIndex
CREATE INDEX "Reminder_customerId_idx" ON "Reminder"("customerId");

-- CreateIndex
CREATE INDEX "Reminder_invoiceId_idx" ON "Reminder"("invoiceId");

-- CreateIndex
CREATE INDEX "Reminder_scheduledFor_idx" ON "Reminder"("scheduledFor");

-- CreateIndex
CREATE INDEX "Reminder_status_idx" ON "Reminder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_organisationId_dedupeKey_key" ON "Reminder"("organisationId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderTemplate" ADD CONSTRAINT "ReminderTemplate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ReminderTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
