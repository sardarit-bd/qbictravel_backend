-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "DiscountApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscountAuditAction" AS ENUM ('DISCOUNT_REQUESTED', 'DISCOUNT_APPROVED', 'DISCOUNT_REJECTED', 'DISCOUNT_REQUEST_CANCELLED', 'DISCOUNT_APPROVAL_REVERSED');

-- CreateTable
CREATE TABLE "StaffDiscountRequest" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "originalPrice" DECIMAL(10,2) NOT NULL,
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "proposedFinalPrice" DECIMAL(10,2) NOT NULL,
    "approvedDiscountAmount" DECIMAL(10,2),
    "approvedFinalPrice" DECIMAL(10,2),
    "status" "DiscountApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "adminNotes" TEXT,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffDiscountRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffDiscountAuditEvent" (
    "id" TEXT NOT NULL,
    "discountRequestId" TEXT,
    "bookingId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" "DiscountAuditAction" NOT NULL,
    "previousStatus" "DiscountApprovalStatus",
    "newStatus" "DiscountApprovalStatus",
    "originalPrice" DECIMAL(10,2),
    "discountType" "DiscountType",
    "discountValue" DECIMAL(10,2),
    "requestedDiscountAmount" DECIMAL(10,2),
    "proposedFinalPrice" DECIMAL(10,2),
    "approvedDiscountAmount" DECIMAL(10,2),
    "finalPrice" DECIMAL(10,2),
    "reason" TEXT,
    "rejectionReason" TEXT,
    "adminNotes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffDiscountAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffDiscountRequest_bookingId_idx" ON "StaffDiscountRequest"("bookingId");

-- CreateIndex
CREATE INDEX "StaffDiscountRequest_requestedById_idx" ON "StaffDiscountRequest"("requestedById");

-- CreateIndex
CREATE INDEX "StaffDiscountRequest_reviewedById_idx" ON "StaffDiscountRequest"("reviewedById");

-- CreateIndex
CREATE INDEX "StaffDiscountRequest_status_idx" ON "StaffDiscountRequest"("status");

-- CreateIndex
CREATE INDEX "StaffDiscountRequest_createdAt_idx" ON "StaffDiscountRequest"("createdAt");

-- CreateIndex
CREATE INDEX "StaffDiscountAuditEvent_discountRequestId_idx" ON "StaffDiscountAuditEvent"("discountRequestId");

-- CreateIndex
CREATE INDEX "StaffDiscountAuditEvent_bookingId_idx" ON "StaffDiscountAuditEvent"("bookingId");

-- CreateIndex
CREATE INDEX "StaffDiscountAuditEvent_actorId_idx" ON "StaffDiscountAuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "StaffDiscountAuditEvent_action_idx" ON "StaffDiscountAuditEvent"("action");

-- CreateIndex
CREATE INDEX "StaffDiscountAuditEvent_createdAt_idx" ON "StaffDiscountAuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "StaffDiscountRequest" ADD CONSTRAINT "StaffDiscountRequest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDiscountRequest" ADD CONSTRAINT "StaffDiscountRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDiscountRequest" ADD CONSTRAINT "StaffDiscountRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDiscountAuditEvent" ADD CONSTRAINT "StaffDiscountAuditEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDiscountAuditEvent" ADD CONSTRAINT "StaffDiscountAuditEvent_discountRequestId_fkey" FOREIGN KEY ("discountRequestId") REFERENCES "StaffDiscountRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDiscountAuditEvent" ADD CONSTRAINT "StaffDiscountAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL Append-Only Immutability Trigger Protection for StaffDiscountAuditEvent
CREATE OR REPLACE FUNCTION prevent_staff_discount_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'StaffDiscountAuditEvent records are strictly append-only and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_staff_discount_audit
BEFORE UPDATE OR DELETE ON "StaffDiscountAuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_staff_discount_audit_tampering();
