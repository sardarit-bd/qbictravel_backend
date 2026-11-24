-- AlterTable PickupZone: Add structured schedule and private transfer fields
ALTER TABLE "PickupZone" ADD COLUMN "morningPickupTime" TEXT;
ALTER TABLE "PickupZone" ADD COLUMN "afternoonPickupTime" TEXT;
ALTER TABLE "PickupZone" ADD COLUMN "hasPrivateTransfer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PickupZone" ADD COLUMN "privateTransferCharge" DECIMAL(10,2);
ALTER TABLE "PickupZone" ADD COLUMN "morningPierArrival" TEXT DEFAULT '08:30 AM';
ALTER TABLE "PickupZone" ADD COLUMN "afternoonPierArrival" TEXT DEFAULT '12:30 PM';
