-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "riskLevel" TEXT NOT NULL DEFAULT 'LOW';

-- CreateIndex
CREATE INDEX "Customer_riskLevel_idx" ON "Customer"("riskLevel");
