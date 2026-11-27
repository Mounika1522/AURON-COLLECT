ALTER TABLE "CustomerPortalAccount"
ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

ALTER TABLE "EmailDeliveryAttempt"
ADD COLUMN "reminderId" TEXT;

CREATE UNIQUE INDEX "EmailDeliveryAttempt_reminderId_key"
ON "EmailDeliveryAttempt"("reminderId");

ALTER TABLE "EmailDeliveryAttempt"
ADD CONSTRAINT "EmailDeliveryAttempt_reminderId_fkey"
FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
