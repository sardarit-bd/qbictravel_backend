-- CreateExtension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Service_name_trgm_idx" ON "Service" USING gin ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Service_description_trgm_idx" ON "Service" USING gin ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Service_providerName_trgm_idx" ON "Service" USING gin ("providerName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Service_status_idx" ON "Service"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Service_type_idx" ON "Service"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Service_updatedAt_idx" ON "Service"("updatedAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Service_createdAt_idx" ON "Service"("createdAt" DESC);
