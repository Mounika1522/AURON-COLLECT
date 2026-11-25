CREATE TABLE "CustomerAssistantMessage" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerAssistantMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerAssistantMessage_organisationId_customerId_createdAt_idx"
    ON "CustomerAssistantMessage"("organisationId", "customerId", "createdAt");

ALTER TABLE "CustomerAssistantMessage"
    ADD CONSTRAINT "CustomerAssistantMessage_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "CustomerAssistantMessage_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
