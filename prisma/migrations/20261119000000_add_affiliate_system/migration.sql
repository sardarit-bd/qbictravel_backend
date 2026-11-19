-- Additive-only migration: PhuketTours Affiliate System
-- Adds 'affiliate' to UserRole and creates affiliate tables without modifying existing tables/data.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'affiliate';

CREATE TYPE "AffiliateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "AffiliateCommissionEntryType" AS ENUM ('EARNED', 'REVERSAL', 'ADJUSTMENT');
CREATE TYPE "AffiliateCommissionStatus" AS ENUM ('PENDING', 'AVAILABLE', 'PAID', 'REVERSED');
CREATE TYPE "AffiliatePayoutStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');
CREATE TYPE "AffiliateEligibleAmountPolicy" AS ENUM ('NET_AFTER_DISCOUNTS', 'GROSS');
CREATE TYPE "AffiliateAuditEntityType" AS ENUM ('AFFILIATE', 'COMMISSION', 'PAYOUT', 'SETTINGS');

CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "AffiliateStatus" NOT NULL DEFAULT 'PENDING',
    "commissionRateOverride" DECIMAL(5,2),
    "payoutMethod" TEXT,
    "payoutDetails" JSONB,
    "websiteUrl" TEXT,
    "promotionChannels" TEXT,
    "rejectionReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliateLink" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "label" TEXT,
    "tourId" TEXT,
    "targetPath" TEXT NOT NULL DEFAULT '/',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AffiliateLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliateClick" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "affiliateLinkId" TEXT,
    "referralCode" TEXT NOT NULL,
    "visitorToken" TEXT NOT NULL,
    "landingUrl" TEXT NOT NULL,
    "referrer" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliateBookingAttribution" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "affiliateClickId" TEXT,
    "referralCode" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateBookingAttribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliateCommission" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "paymentId" TEXT,
    "entryType" "AffiliateCommissionEntryType" NOT NULL DEFAULT 'EARNED',
    "eligibleAmount" DECIMAL(10,2) NOT NULL,
    "commissionRate" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "status" "AffiliateCommissionStatus" NOT NULL DEFAULT 'AVAILABLE',
    "idempotencyKey" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliatePayout" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "status" "AffiliatePayoutStatus" NOT NULL DEFAULT 'PENDING',
    "payoutMethod" TEXT NOT NULL,
    "payoutDetailsSnapshot" JSONB,
    "rejectionReason" TEXT,
    "transactionReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "processedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AffiliatePayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliateSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "globalCommissionRate" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    "attributionWindowDays" INTEGER NOT NULL DEFAULT 30,
    "minimumPayoutAmount" DECIMAL(10,2) NOT NULL DEFAULT 50.00,
    "eligibleAmountPolicy" "AffiliateEligibleAmountPolicy" NOT NULL DEFAULT 'NET_AFTER_DISCOUNTS',
    "isProgramActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AffiliateSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliateAuditEvent" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT,
    "entityType" "AffiliateAuditEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateAuditEvent_pkey" PRIMARY KEY ("id")
);

-- Indexes & Unique Constraints
CREATE UNIQUE INDEX "Affiliate_userId_key" ON "Affiliate"("userId");
CREATE UNIQUE INDEX "Affiliate_code_key" ON "Affiliate"("code");
CREATE INDEX "Affiliate_status_idx" ON "Affiliate"("status");
CREATE INDEX "Affiliate_code_idx" ON "Affiliate"("code");

CREATE INDEX "AffiliateLink_affiliateId_idx" ON "AffiliateLink"("affiliateId");
CREATE INDEX "AffiliateLink_tourId_idx" ON "AffiliateLink"("tourId");

CREATE INDEX "AffiliateClick_affiliateId_createdAt_idx" ON "AffiliateClick"("affiliateId", "createdAt");
CREATE INDEX "AffiliateClick_visitorToken_idx" ON "AffiliateClick"("visitorToken");
CREATE INDEX "AffiliateClick_referralCode_idx" ON "AffiliateClick"("referralCode");

CREATE UNIQUE INDEX "AffiliateBookingAttribution_bookingId_key" ON "AffiliateBookingAttribution"("bookingId");
CREATE INDEX "AffiliateBookingAttribution_affiliateId_idx" ON "AffiliateBookingAttribution"("affiliateId");

CREATE UNIQUE INDEX "AffiliateCommission_idempotencyKey_key" ON "AffiliateCommission"("idempotencyKey");
CREATE INDEX "AffiliateCommission_affiliateId_status_idx" ON "AffiliateCommission"("affiliateId", "status");
CREATE INDEX "AffiliateCommission_bookingId_idx" ON "AffiliateCommission"("bookingId");
CREATE INDEX "AffiliateCommission_paymentId_idx" ON "AffiliateCommission"("paymentId");

CREATE INDEX "AffiliatePayout_affiliateId_status_idx" ON "AffiliatePayout"("affiliateId", "status");
CREATE INDEX "AffiliatePayout_status_requestedAt_idx" ON "AffiliatePayout"("status", "requestedAt");

CREATE INDEX "AffiliateAuditEvent_affiliateId_createdAt_idx" ON "AffiliateAuditEvent"("affiliateId", "createdAt");
CREATE INDEX "AffiliateAuditEvent_entityType_entityId_idx" ON "AffiliateAuditEvent"("entityType", "entityId");

-- Foreign Keys
ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_affiliateLinkId_fkey" FOREIGN KEY ("affiliateLinkId") REFERENCES "AffiliateLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AffiliateBookingAttribution" ADD CONSTRAINT "AffiliateBookingAttribution_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AffiliateBookingAttribution" ADD CONSTRAINT "AffiliateBookingAttribution_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateBookingAttribution" ADD CONSTRAINT "AffiliateBookingAttribution_affiliateClickId_fkey" FOREIGN KEY ("affiliateClickId") REFERENCES "AffiliateClick"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AffiliateSettings" ADD CONSTRAINT "AffiliateSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AffiliateAuditEvent" ADD CONSTRAINT "AffiliateAuditEvent_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AffiliateAuditEvent" ADD CONSTRAINT "AffiliateAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
