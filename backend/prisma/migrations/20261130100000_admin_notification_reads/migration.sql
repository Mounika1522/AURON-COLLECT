-- CreateTable
CREATE TABLE "AdminNotificationRead" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNotificationRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminNotificationRead_organisationId_userId_sourceKey_key"
ON "AdminNotificationRead"("organisationId", "userId", "sourceKey");

-- CreateIndex
CREATE INDEX "AdminNotificationRead_organisationId_userId_readAt_idx"
ON "AdminNotificationRead"("organisationId", "userId", "readAt");

-- AddForeignKey
ALTER TABLE "AdminNotificationRead"
ADD CONSTRAINT "AdminNotificationRead_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotificationRead"
ADD CONSTRAINT "AdminNotificationRead_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
