-- AlterTable
ALTER TABLE "User"
ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loginLockoutUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_loginLockoutUntil_idx" ON "User"("loginLockoutUntil");
