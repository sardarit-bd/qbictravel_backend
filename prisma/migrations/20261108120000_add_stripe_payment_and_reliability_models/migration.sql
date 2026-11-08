-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'STRIPE';

-- AlterEnum
ALTER TYPE "PaymentRecordStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "PaymentRecordStatus" ADD VALUE 'FAILED';
ALTER TYPE "PaymentRecordStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "PaymentRecordStatus" ADD VALUE 'REQUIRES_ACTION';
ALTER TYPE "PaymentRecordStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "PaymentRecordStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "PaymentRecordStatus" ADD VALUE 'DISPUTED';

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "OutboxTopic" AS ENUM ('CALCULATE_COMMISSION', 'SEND_BOOKING_VOUCHER_EMAIL', 'SEND_ADMIN_PAYMENT_ALERT', 'RECONCILE_PAYMENT');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterTable Booking: Add nullable currency first for historical backfill
ALTER TABLE "Booking" ADD COLUMN "currency" TEXT;

-- Safe Historical Currency Backfill:
-- Only backfill when exactly ONE unique ServicePricing tier was valid at booking creation time
UPDATE "Booking" b
SET "currency" = (
  SELECT sp."currency"
  FROM "ServicePricing" sp
  WHERE sp."serviceId" = b."serviceId"
    AND (sp."validFrom" IS NULL OR sp."validFrom" <= b."createdAt")
    AND (sp."validTo" IS NULL OR sp."validTo" >= b."createdAt")
)
WHERE b."currency" IS NULL
  AND (
    SELECT COUNT(*)
    FROM "ServicePricing" sp
    WHERE sp."serviceId" = b."serviceId"
      AND (sp."validFrom" IS NULL OR sp."validFrom" <= b."createdAt")
      AND (sp."validTo" IS NULL OR sp."validTo" >= b."createdAt")
  ) = 1;

-- Verification Check 1: Halt migration immediately if any historical booking cannot be uniquely matched
DO $$
DECLARE
  unresolved_bookings INTEGER;
  ambiguous_bookings INTEGER;
BEGIN
  SELECT COUNT(*) INTO ambiguous_bookings
  FROM "Booking" b
  WHERE b."currency" IS NULL
    AND (
      SELECT COUNT(*)
      FROM "ServicePricing" sp
      WHERE sp."serviceId" = b."serviceId"
        AND (sp."validFrom" IS NULL OR sp."validFrom" <= b."createdAt")
        AND (sp."validTo" IS NULL OR sp."validTo" >= b."createdAt")
    ) > 1;

  IF ambiguous_bookings > 0 THEN
    RAISE EXCEPTION 'Migration halted: % historical booking(s) have multiple pricing tiers valid at creation time. Ambiguous currency requires manual audit.', ambiguous_bookings;
  END IF;

  SELECT COUNT(*) INTO unresolved_bookings
  FROM "Booking"
  WHERE "currency" IS NULL;

  IF unresolved_bookings > 0 THEN
    RAISE EXCEPTION 'Migration halted: % historical booking(s) could not be resolved to a unique pricing record. Manual currency audit required.', unresolved_bookings;
  END IF;
END $$;

-- Enforce NOT NULL on Booking.currency
ALTER TABLE "Booking" ALTER COLUMN "currency" SET NOT NULL;

-- AlterTable Payment: Add nullable currency and Stripe tracking fields
ALTER TABLE "Payment" ADD COLUMN "currency" TEXT;
ALTER TABLE "Payment" ADD COLUMN "stripeSessionId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "stripePaymentIntentId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "failureReason" TEXT;

-- Backfill Payment.currency strictly from its parent Booking
UPDATE "Payment" p
SET "currency" = b."currency"
FROM "Booking" b
WHERE p."bookingId" = b."id"
  AND p."currency" IS NULL;

-- Verification Check 2: Halt migration if any payment currency could not be resolved
DO $$
DECLARE
  unresolved_payments INTEGER;
BEGIN
  SELECT COUNT(*) INTO unresolved_payments
  FROM "Payment"
  WHERE "currency" IS NULL;

  IF unresolved_payments > 0 THEN
    RAISE EXCEPTION 'Migration halted: % payment(s) could not be resolved from parent booking. Manual audit required.', unresolved_payments;
  END IF;
END $$;

-- Enforce NOT NULL on Payment.currency
ALTER TABLE "Payment" ALTER COLUMN "currency" SET NOT NULL;

-- CreateTable StripeWebhookEvent
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "bookingId" TEXT,
    "paymentId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable OutboxMessage
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "topic" "OutboxTopic" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable PaymentRefund
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "stripeRefundId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "failureReason" TEXT,
    "initiatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes on Payment
CREATE INDEX "Payment_stripeSessionId_idx" ON "Payment"("stripeSessionId");
CREATE INDEX "Payment_stripePaymentIntentId_idx" ON "Payment"("stripePaymentIntentId");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndexes on StripeWebhookEvent
CREATE INDEX "StripeWebhookEvent_status_idx" ON "StripeWebhookEvent"("status");
CREATE INDEX "StripeWebhookEvent_bookingId_idx" ON "StripeWebhookEvent"("bookingId");
CREATE INDEX "StripeWebhookEvent_paymentId_idx" ON "StripeWebhookEvent"("paymentId");
CREATE INDEX "StripeWebhookEvent_type_idx" ON "StripeWebhookEvent"("type");
CREATE INDEX "StripeWebhookEvent_lockedAt_idx" ON "StripeWebhookEvent"("lockedAt");

-- CreateIndexes on OutboxMessage
CREATE INDEX "OutboxMessage_status_scheduledAt_idx" ON "OutboxMessage"("status", "scheduledAt");
CREATE INDEX "OutboxMessage_lockedAt_idx" ON "OutboxMessage"("lockedAt");

-- CreateIndexes on PaymentRefund
CREATE UNIQUE INDEX "PaymentRefund_stripeRefundId_key" ON "PaymentRefund"("stripeRefundId");
CREATE INDEX "PaymentRefund_paymentId_idx" ON "PaymentRefund"("paymentId");
CREATE INDEX "PaymentRefund_status_idx" ON "PaymentRefund"("status");

-- AddForeignKeys
ALTER TABLE "StripeWebhookEvent" ADD CONSTRAINT "StripeWebhookEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StripeWebhookEvent" ADD CONSTRAINT "StripeWebhookEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

