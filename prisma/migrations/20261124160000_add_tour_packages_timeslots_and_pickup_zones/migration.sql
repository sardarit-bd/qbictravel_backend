-- Migration: Add Tour Packages, Departure Time Slots, Pickup Zones, and Booking Snapshots
-- Purely additive: creates new tables, enums, indexes, and adds non-destructive columns to `Service` and `Booking`.

-- CreateEnum
CREATE TYPE "PricingModelType" AS ENUM ('PER_PERSON', 'PER_PACKAGE');

-- CreateEnum
CREATE TYPE "SurchargeUnit" AS ENUM ('PER_BOOKING', 'PER_VEHICLE', 'PER_PERSON');

-- AlterTable Service
ALTER TABLE "Service" ADD COLUMN "pricingType" "PricingModelType" NOT NULL DEFAULT 'PER_PERSON';

-- CreateIndex
CREATE INDEX "Service_pricingType_idx" ON "Service"("pricingType");

-- CreateTable ServicePackage
CREATE TABLE "ServicePackage" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "boatSize" TEXT,
    "minPax" INTEGER NOT NULL DEFAULT 1,
    "maxCapacity" INTEGER NOT NULL DEFAULT 2,
    "sellingPrice" DECIMAL(10,2) NOT NULL,
    "netPrice" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServicePackage_serviceId_idx" ON "ServicePackage"("serviceId");
CREATE INDEX "ServicePackage_isActive_idx" ON "ServicePackage"("isActive");

-- CreateTable ServiceTimeSlot
CREATE TABLE "ServiceTimeSlot" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departureTime" TEXT NOT NULL,
    "capacity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceTimeSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceTimeSlot_serviceId_idx" ON "ServiceTimeSlot"("serviceId");
CREATE INDEX "ServiceTimeSlot_isActive_idx" ON "ServiceTimeSlot"("isActive");

-- CreateTable PickupZone
CREATE TABLE "PickupZone" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT,
    "operatorName" TEXT,
    "zoneName" TEXT NOT NULL,
    "description" TEXT,
    "surchargeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "surchargeUnit" "SurchargeUnit" NOT NULL DEFAULT 'PER_BOOKING',
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupZone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PickupZone_serviceId_idx" ON "PickupZone"("serviceId");
CREATE INDEX "PickupZone_operatorName_idx" ON "PickupZone"("operatorName");
CREATE INDEX "PickupZone_isActive_idx" ON "PickupZone"("isActive");

-- AlterTable Booking
ALTER TABLE "Booking" ADD COLUMN "packageId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "timeSlotId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "pickupZoneId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "departureTime" TEXT;
ALTER TABLE "Booking" ADD COLUMN "pickupLocation" TEXT;
ALTER TABLE "Booking" ADD COLUMN "packagePriceSnapshot" DECIMAL(10,2);
ALTER TABLE "Booking" ADD COLUMN "netPriceSnapshot" DECIMAL(10,2);
ALTER TABLE "Booking" ADD COLUMN "pickupSurcharge" DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "Booking" ADD COLUMN "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- CreateIndex
CREATE INDEX "Booking_packageId_idx" ON "Booking"("packageId");
CREATE INDEX "Booking_timeSlotId_idx" ON "Booking"("timeSlotId");
CREATE INDEX "Booking_pickupZoneId_idx" ON "Booking"("pickupZoneId");

-- AddForeignKey
ALTER TABLE "ServicePackage" ADD CONSTRAINT "ServicePackage_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTimeSlot" ADD CONSTRAINT "ServiceTimeSlot_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupZone" ADD CONSTRAINT "PickupZone_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_timeSlotId_fkey" FOREIGN KEY ("timeSlotId") REFERENCES "ServiceTimeSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_pickupZoneId_fkey" FOREIGN KEY ("pickupZoneId") REFERENCES "PickupZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
