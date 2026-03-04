-- CreateEnum
CREATE TYPE "LeagueRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "LeaguePeriod" AS ENUM ('WEEKLY', 'ALL_TIME');

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(200),
    "inviteCode" VARCHAR(8) NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "maxMembers" INTEGER NOT NULL DEFAULT 50,
    "emoji" TEXT NOT NULL DEFAULT '⚽',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueMembership" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "LeagueRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LeagueMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueStanding" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" "LeaguePeriod" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "predictionsWon" INTEGER NOT NULL DEFAULT 0,
    "predictionsLost" INTEGER NOT NULL DEFAULT 0,
    "totalPredictions" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueStanding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");

-- CreateIndex
CREATE INDEX "League_inviteCode_idx" ON "League"("inviteCode");

-- CreateIndex
CREATE INDEX "League_ownerId_idx" ON "League"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMembership_leagueId_userId_key" ON "LeagueMembership"("leagueId", "userId");

-- CreateIndex
CREATE INDEX "LeagueMembership_userId_idx" ON "LeagueMembership"("userId");

-- CreateIndex
CREATE INDEX "LeagueMembership_leagueId_idx" ON "LeagueMembership"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueMembership_leagueId_isActive_idx" ON "LeagueMembership"("leagueId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueStanding_leagueId_userId_period_periodKey_key" ON "LeagueStanding"("leagueId", "userId", "period", "periodKey");

-- CreateIndex
CREATE INDEX "LeagueStanding_leagueId_period_periodKey_rank_idx" ON "LeagueStanding"("leagueId", "period", "periodKey", "rank");

-- CreateIndex
CREATE INDEX "LeagueStanding_userId_idx" ON "LeagueStanding"("userId");

-- AddForeignKey
ALTER TABLE "League" ADD CONSTRAINT "League_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMembership" ADD CONSTRAINT "LeagueMembership_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMembership" ADD CONSTRAINT "LeagueMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueStanding" ADD CONSTRAINT "LeagueStanding_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueStanding" ADD CONSTRAINT "LeagueStanding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
