-- Migration: Add Guest Checkout, Access, Claiming, Email Verification, and Invoice Foundation
-- Purely additive: creates new tables, enums, indexes, and adds non-destructive `isGuest` column to `Booking`.

-- CreateEnum
CREATE TYPE "GuestTokenPurpose" AS ENUM ('ACCESS_ONLY', 'ACCESS_AND_CLAIM');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('TAX_INVOICE', 'PAYMENT_RECEIPT', 'INTERIM_STATEMENT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'VOID', 'REFUNDED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "isGuest" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestBookingSnapshot" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "guestPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestBookingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestBookingToken" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" "GuestTokenPurpose" NOT NULL DEFAULT 'ACCESS_AND_CLAIM',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestBookingToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingClaimAudit" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "previousUserId" TEXT NOT NULL,
    "newUserId" TEXT NOT NULL,
    "claimedByEmail" TEXT NOT NULL,
    "claimMethod" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingClaimAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "paymentId" TEXT,
    "type" "InvoiceType" NOT NULL DEFAULT 'TAX_INVOICE',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "currency" TEXT NOT NULL,
    "subtotalAmount" DECIMAL(10,2) NOT NULL,
    "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "paidAmount" DECIMAL(10,2) NOT NULL,
    "dueAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdfUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_tokenHash_idx" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_email_idx" ON "EmailVerificationToken"("email");

-- CreateIndex
CREATE UNIQUE INDEX "GuestBookingSnapshot_bookingId_key" ON "GuestBookingSnapshot"("bookingId");

-- CreateIndex
CREATE INDEX "GuestBookingSnapshot_guestEmail_idx" ON "GuestBookingSnapshot"("guestEmail");

-- CreateIndex
CREATE UNIQUE INDEX "GuestBookingToken_tokenHash_key" ON "GuestBookingToken"("tokenHash");

-- CreateIndex
CREATE INDEX "GuestBookingToken_tokenHash_idx" ON "GuestBookingToken"("tokenHash");

-- CreateIndex
CREATE INDEX "GuestBookingToken_bookingId_idx" ON "GuestBookingToken"("bookingId");

-- CreateIndex
CREATE INDEX "GuestBookingToken_email_idx" ON "GuestBookingToken"("email");

-- CreateIndex
CREATE INDEX "BookingClaimAudit_bookingId_idx" ON "BookingClaimAudit"("bookingId");

-- CreateIndex
CREATE INDEX "BookingClaimAudit_newUserId_idx" ON "BookingClaimAudit"("newUserId");

-- CreateIndex
CREATE INDEX "BookingClaimAudit_previousUserId_idx" ON "BookingClaimAudit"("previousUserId");

-- CreateIndex
CREATE INDEX "BookingClaimAudit_claimedByEmail_idx" ON "BookingClaimAudit"("claimedByEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_bookingId_idx" ON "Invoice"("bookingId");

-- CreateIndex
CREATE INDEX "Invoice_paymentId_idx" ON "Invoice"("paymentId");

-- CreateIndex
CREATE INDEX "Invoice_invoiceNumber_idx" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_issuedAt_idx" ON "Invoice"("issuedAt");

-- CreateIndex
CREATE INDEX "Booking_isGuest_idx" ON "Booking"("isGuest");

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestBookingSnapshot" ADD CONSTRAINT "GuestBookingSnapshot_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestBookingToken" ADD CONSTRAINT "GuestBookingToken_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingClaimAudit" ADD CONSTRAINT "BookingClaimAudit_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingClaimAudit" ADD CONSTRAINT "BookingClaimAudit_previousUserId_fkey" FOREIGN KEY ("previousUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingClaimAudit" ADD CONSTRAINT "BookingClaimAudit_newUserId_fkey" FOREIGN KEY ("newUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Immutability Protection for BookingClaimAudit (Audit logs are append-only)
CREATE OR REPLACE FUNCTION prevent_booking_claim_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'BookingClaimAudit records are strictly append-only and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_booking_claim_audit
BEFORE UPDATE OR DELETE ON "BookingClaimAudit"
FOR EACH ROW EXECUTE FUNCTION prevent_booking_claim_audit_tampering();
