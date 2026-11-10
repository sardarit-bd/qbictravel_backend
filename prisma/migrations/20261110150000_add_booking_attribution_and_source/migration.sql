-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('AGENT', 'ADMIN', 'CUSTOMER', 'DIRECT');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "createdById" TEXT,
ADD COLUMN "source" "BookingSource" NOT NULL DEFAULT 'DIRECT';

-- CreateIndex
CREATE INDEX "Booking_agentId_idx" ON "Booking"("agentId");

-- CreateIndex
CREATE INDEX "Booking_createdById_idx" ON "Booking"("createdById");

-- CreateIndex
CREATE INDEX "Booking_source_idx" ON "Booking"("source");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill existing bookings with established attribution
-- 1. If agentId is set, mark source as AGENT and createdById as agentId
UPDATE "Booking"
SET "source" = 'AGENT', "createdById" = "agentId"
WHERE "agentId" IS NOT NULL;

-- 2. For historical bookings without agentId, check booking history for creation actor
UPDATE "Booking" b
SET "createdById" = bh."actorId",
    "source" = CASE 
      WHEN bh."actorRole" = 'admin' THEN 'ADMIN'::"BookingSource"
      WHEN bh."actorRole" = 'agent' THEN 'AGENT'::"BookingSource"
      WHEN bh."actorRole" = 'customer' THEN 'CUSTOMER'::"BookingSource"
      ELSE 'DIRECT'::"BookingSource"
    END
FROM (
  SELECT DISTINCT ON ("bookingId") "bookingId", "actorId", "actorRole"
  FROM "BookingHistory"
  WHERE "action" = 'BOOKING_CREATED'
  ORDER BY "bookingId", "createdAt" ASC
) bh
WHERE b.id = bh."bookingId" AND b."createdById" IS NULL;

