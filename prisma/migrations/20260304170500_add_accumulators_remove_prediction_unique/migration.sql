-- CreateEnum
CREATE TYPE "AccumulatorStatus" AS ENUM ('PENDING', 'WON', 'LOST', 'CANCELLED', 'CASHED_OUT');

-- DropIndex
DROP INDEX "Prediction_userId_eventId_key";

-- CreateTable
CREATE TABLE "Accumulator" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stakeAmount" INTEGER NOT NULL,
    "combinedOdds" DECIMAL(10,4) NOT NULL,
    "potentialPayout" INTEGER NOT NULL,
    "status" "AccumulatorStatus" NOT NULL DEFAULT 'PENDING',
    "payout" INTEGER,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Accumulator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccumulatorLeg" (
    "id" TEXT NOT NULL,
    "accumulatorId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "predictedOutcome" TEXT NOT NULL,
    "odds" DECIMAL(10,4) NOT NULL,
    "status" "PredictionStatus" NOT NULL DEFAULT 'PENDING',
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccumulatorLeg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Accumulator_userId_status_idx" ON "Accumulator"("userId", "status");

-- CreateIndex
CREATE INDEX "Accumulator_status_idx" ON "Accumulator"("status");

-- CreateIndex
CREATE INDEX "Accumulator_userId_createdAt_idx" ON "Accumulator"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AccumulatorLeg_accumulatorId_idx" ON "AccumulatorLeg"("accumulatorId");

-- CreateIndex
CREATE INDEX "AccumulatorLeg_eventId_status_idx" ON "AccumulatorLeg"("eventId", "status");

-- AddForeignKey
ALTER TABLE "Accumulator" ADD CONSTRAINT "Accumulator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccumulatorLeg" ADD CONSTRAINT "AccumulatorLeg_accumulatorId_fkey" FOREIGN KEY ("accumulatorId") REFERENCES "Accumulator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccumulatorLeg" ADD CONSTRAINT "AccumulatorLeg_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
