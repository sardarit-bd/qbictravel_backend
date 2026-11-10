-- CreateEnum
CREATE TYPE "CommissionPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "CommissionRule" ADD COLUMN     "status" "CommissionPolicyStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "isActive" SET DEFAULT false;

-- Backfill existing rules: if isActive is true -> ACTIVE, else -> INACTIVE
UPDATE "CommissionRule" SET "status" = 'ACTIVE' WHERE "isActive" = true;
UPDATE "CommissionRule" SET "status" = 'INACTIVE' WHERE "isActive" = false;

-- CreateTable
CREATE TABLE "CommissionRuleAuditLog" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousValues" JSONB,
    "newValues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionRuleAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionRuleAuditLog_ruleId_idx" ON "CommissionRuleAuditLog"("ruleId");

-- CreateIndex
CREATE INDEX "CommissionRuleAuditLog_adminId_idx" ON "CommissionRuleAuditLog"("adminId");

-- CreateIndex
CREATE INDEX "CommissionRuleAuditLog_createdAt_idx" ON "CommissionRuleAuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "CommissionRule_status_idx" ON "CommissionRule"("status");

-- CreateIndex
CREATE INDEX "CommissionRule_isActive_idx" ON "CommissionRule"("isActive");

-- AddForeignKey
ALTER TABLE "CommissionRuleAuditLog" ADD CONSTRAINT "CommissionRuleAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRuleAuditLog" ADD CONSTRAINT "CommissionRuleAuditLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CommissionRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

