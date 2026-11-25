DROP INDEX IF EXISTS "CustomerPortalAccount_verificationTokenHash_key";

ALTER TABLE "CustomerPortalAccount"
DROP COLUMN IF EXISTS "verificationTokenHash",
DROP COLUMN IF EXISTS "verificationTokenExpiresAt";

ALTER TABLE "CustomerPortalAccount"
RENAME COLUMN "verificationSentAt" TO "verificationOtpSentAt";

ALTER TABLE "CustomerPortalAccount"
ADD COLUMN "verificationOtpHash" TEXT,
ADD COLUMN "verificationOtpExpiresAt" TIMESTAMP(3),
ADD COLUMN "verificationOtpAttemptCount" INTEGER NOT NULL DEFAULT 0;
