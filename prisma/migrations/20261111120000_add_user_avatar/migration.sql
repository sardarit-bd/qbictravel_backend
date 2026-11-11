-- AlterTable User add avatarUrl and avatarKey
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarKey" TEXT;

