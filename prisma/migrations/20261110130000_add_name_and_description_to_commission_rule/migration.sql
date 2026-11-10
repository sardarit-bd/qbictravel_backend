-- AlterTable
ALTER TABLE "CommissionRule" ADD COLUMN "name" TEXT,
ADD COLUMN "description" TEXT;

-- Backfill existing rules with friendly names if null
UPDATE "CommissionRule" 
SET "name" = CASE 
  WHEN "rateType" = 'PERCENTAGE' THEN CONCAT("rateValue"::TEXT, '% Standard Commission')
  ELSE CONCAT('฿', "rateValue"::TEXT, ' Fixed Commission')
END
WHERE "name" IS NULL;

