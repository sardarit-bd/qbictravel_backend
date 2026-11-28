-- Additive migration for Simple Product Builder Phase 1 Foundation
-- Preserves all existing Service, ServicePackage, PickupZone, and Booking records.

CREATE TYPE "DraftRevisionStatus" AS ENUM ('ACTIVE', 'APPLIED', 'DISCARDED');

ALTER TABLE "Service"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "updatedById" TEXT;

CREATE INDEX "Service_archivedAt_idx" ON "Service"("archivedAt");

CREATE TABLE "ServiceDraftRevision" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "draftData" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "baseServiceVersion" INTEGER NOT NULL DEFAULT 1,
  "status" "DraftRevisionStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ServiceDraftRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceDraftRevision_serviceId_idx" ON "ServiceDraftRevision"("serviceId");
CREATE INDEX "ServiceDraftRevision_status_idx" ON "ServiceDraftRevision"("status");
CREATE INDEX "ServiceDraftRevision_serviceId_status_idx" ON "ServiceDraftRevision"("serviceId", "status");

ALTER TABLE "ServiceDraftRevision"
  ADD CONSTRAINT "ServiceDraftRevision_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ServicePickupZoneAssignment" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "pickupZoneId" TEXT NOT NULL,
  "morningPickupTimeOverride" TEXT,
  "afternoonPickupTimeOverride" TEXT,
  "surchargeOverride" DECIMAL(10, 2),
  "privateTransferChargeOverride" DECIMAL(10, 2),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ServicePickupZoneAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServicePickupZoneAssignment_serviceId_pickupZoneId_key"
  ON "ServicePickupZoneAssignment"("serviceId", "pickupZoneId");
CREATE INDEX "ServicePickupZoneAssignment_serviceId_idx"
  ON "ServicePickupZoneAssignment"("serviceId");
CREATE INDEX "ServicePickupZoneAssignment_pickupZoneId_idx"
  ON "ServicePickupZoneAssignment"("pickupZoneId");

ALTER TABLE "ServicePickupZoneAssignment"
  ADD CONSTRAINT "ServicePickupZoneAssignment_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServicePickupZoneAssignment"
  ADD CONSTRAINT "ServicePickupZoneAssignment_pickupZoneId_fkey"
  FOREIGN KEY ("pickupZoneId") REFERENCES "PickupZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
