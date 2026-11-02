-- CreateExtension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffPermission_userId_idx" ON "StaffPermission"("userId");

-- CreateIndex
CREATE INDEX "StaffPermission_permissionId_idx" ON "StaffPermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffPermission_userId_permissionId_key" ON "StaffPermission"("userId", "permissionId");

-- AddForeignKey
ALTER TABLE "StaffPermission" ADD CONSTRAINT "StaffPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPermission" ADD CONSTRAINT "StaffPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPermission" ADD CONSTRAINT "StaffPermission_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Recreate pg_trgm GIN search indexes
CREATE INDEX IF NOT EXISTS "Service_name_trgm_idx" ON "Service" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Service_description_trgm_idx" ON "Service" USING gin ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Service_providerName_trgm_idx" ON "Service" USING gin ("providerName" gin_trgm_ops);
