-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'OMISE';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "omiseChargeId" TEXT;

-- CreateIndex
CREATE INDEX "Payment_omiseChargeId_idx" ON "Payment"("omiseChargeId");
