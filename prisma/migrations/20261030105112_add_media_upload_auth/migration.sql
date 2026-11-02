-- CreateTable
CREATE TABLE "MediaUploadAuth" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaUploadAuth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaUploadAuth_tokenHash_key" ON "MediaUploadAuth"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "MediaUploadAuth_publicId_key" ON "MediaUploadAuth"("publicId");

-- CreateIndex
CREATE INDEX "MediaUploadAuth_adminId_idx" ON "MediaUploadAuth"("adminId");

-- CreateIndex
CREATE INDEX "MediaUploadAuth_publicId_idx" ON "MediaUploadAuth"("publicId");

-- CreateIndex
CREATE INDEX "MediaUploadAuth_expiresAt_idx" ON "MediaUploadAuth"("expiresAt");

-- AddForeignKey
ALTER TABLE "MediaUploadAuth" ADD CONSTRAINT "MediaUploadAuth_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
