ALTER TABLE "CustomerSubscriptionPlan"
    ADD COLUMN "proposedQuarterlyPrice" DECIMAL(14,2),
    ADD COLUMN "proposedHalfYearlyPrice" DECIMAL(14,2),
    ADD COLUMN "quarterlyPrice" DECIMAL(14,2),
    ADD COLUMN "halfYearlyPrice" DECIMAL(14,2),
    ADD COLUMN "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "usageLimits" JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN "eligibleCustomerTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
