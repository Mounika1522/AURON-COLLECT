ALTER TABLE "CustomerSubscriptionReceipt"
ADD COLUMN "transactionId" TEXT,
ADD COLUMN "customerName" TEXT,
ADD COLUMN "customerEmail" TEXT,
ADD COLUMN "paymentMethod" TEXT,
ADD COLUMN "verificationTokenHash" TEXT,
ADD COLUMN "pdfBytes" BYTEA,
ADD COLUMN "pdfSha256" TEXT;

UPDATE "CustomerSubscriptionReceipt" AS receipt
SET
    "transactionId" = payment."razorpayPaymentId",
    "customerName" = customer."name",
    "customerEmail" = COALESCE(account."email", customer."email"),
    "paymentMethod" = payment."paymentMethod"
FROM "CustomerSubscriptionPayment" AS payment
JOIN "Customer" AS customer ON customer."id" = payment."customerId"
LEFT JOIN "CustomerPortalAccount" AS account ON account."customerId" = customer."id"
WHERE payment."id" = receipt."paymentId"
  AND customer."id" = receipt."customerId";

CREATE UNIQUE INDEX "CustomerSubscriptionReceipt_transactionId_key"
ON "CustomerSubscriptionReceipt"("transactionId");

CREATE UNIQUE INDEX "CustomerSubscriptionReceipt_verificationTokenHash_key"
ON "CustomerSubscriptionReceipt"("verificationTokenHash");

ALTER TABLE "EmailDeliveryAttempt"
ADD COLUMN "customerSubscriptionReceiptId" TEXT;

CREATE UNIQUE INDEX "EmailAttempt_subReceipt_purpose_key"
ON "EmailDeliveryAttempt"("customerSubscriptionReceiptId", "purpose");

ALTER TABLE "EmailDeliveryAttempt"
ADD CONSTRAINT "EmailDeliveryAttempt_customerSubscriptionReceiptId_fkey"
FOREIGN KEY ("customerSubscriptionReceiptId")
REFERENCES "CustomerSubscriptionReceipt"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
