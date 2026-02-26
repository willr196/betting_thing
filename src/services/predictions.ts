import { PredictionStatus, Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/index.js';
import { TokenAllowanceService } from './tokenAllowance.js';
import { OddsApiService } from './oddsApi.js';
import { PointsLedgerService } from './pointsLedger.js';
import { matchOutcomeExact, findOddsOutcome } from './outcomes.js';

// =============================================================================
// PREDICTION SERVICE
// =============================================================================

const CASHOUT_ODDS_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export const PredictionService = {
  /**
   * Place a prediction on an event.
   * This is a critical operation that must be atomic:
   * 1. Validate event is open
   * 2. Validate stake amount
   * 3. Validate outcome is valid
   * 4. Check user hasn't already predicted
   * 5. Debit tokens
   * 6. Create prediction record
   */
  async place(data: {
    userId: string;
    eventId: string;
    predictedOutcome: string;
    stakeAmount: number;
  }) {
    const { userId, eventId, predictedOutcome, stakeAmount } = data;

    // Validate stake amount
    if (stakeAmount < config.tokens.minStake) {
      throw AppError.badRequest(`Minimum stake is ${config.tokens.minStake} tokens`);
    }

    if (stakeAmount > config.tokens.maxStake) {
      throw AppError.badRequest(`Maximum stake is ${config.tokens.maxStake} tokens`);
    }

    // Pre-fetch event for basic validation and odds (outside transaction for performance)
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw AppError.notFound('Event');
    }

    if (!event.externalEventId || !event.externalSportKey) {
      throw AppError.badRequest('Event is missing external odds mapping');
    }

    // Validate outcome against event's possible outcomes
    const canonicalOutcome = matchOutcomeExact(event.outcomes, predictedOutcome);
    if (!canonicalOutcome) {
      throw new AppError(
        'INVALID_OUTCOME',
        `Invalid outcome. Must be one of: ${event.outcomes.join(', ')}`,
        400
      );
    }

    // Fetch live odds before the transaction (external API call)
    const odds = await OddsApiService.getEventOdds(
      event.externalSportKey,
      event.externalEventId
    );

    if (!odds) {
      throw new AppError('INVALID_OUTCOME', 'Unable to fetch live odds for this event', 400);
    }

    const outcomeOdds = findOddsOutcome(odds.outcomes, canonicalOutcome);

    if (!outcomeOdds) {
      throw new AppError(
        'INVALID_OUTCOME',
        `Invalid outcome. Must be one of: ${event.outcomes.join(', ')}`,
        400
      );
    }

    // Execute prediction placement atomically — re-check event status and duplicates inside transaction
    const prediction = await prisma.$transaction(async (tx) => {
      // Re-fetch event with FOR UPDATE lock to prevent race conditions
      const lockedEvent = await lockEventForPrediction(tx, eventId);

      if (!lockedEvent) {
        throw AppError.notFound('Event');
      }

      if (lockedEvent.status !== 'OPEN') {
        throw new AppError(
          'EVENT_NOT_OPEN',
          `Event is ${lockedEvent.status}. Predictions are only accepted for OPEN events.`,
          400
        );
      }

      if (new Date(lockedEvent.startsAt).getTime() <= Date.now()) {
        throw new AppError(
          'EVENT_ALREADY_STARTED',
          'Event has already started. No more predictions allowed.',
          400
        );
      }

      // Check for existing prediction inside the transaction
      const existingPrediction = await tx.prediction.findUnique({
        where: {
          userId_eventId: { userId, eventId },
        },
      });

      if (existingPrediction) {
        throw new AppError(
          'ALREADY_PREDICTED',
          'You have already placed a prediction on this event',
          409
        );
      }

      // Create prediction
      const newPrediction = await tx.prediction.create({
        data: {
          userId,
          eventId,
          predictedOutcome: canonicalOutcome,
          stakeAmount,
          status: 'PENDING',
          originalOdds: new Prisma.Decimal(outcomeOdds.price),
        },
      });

      await TokenAllowanceService.consumeTokens(userId, stakeAmount, newPrediction.id, tx);

      // Return prediction with event details
      return tx.prediction.findUniqueOrThrow({
        where: { id: newPrediction.id },
        include: { event: true },
      });
    });

    return prediction;
  },

  /**
   * Get a prediction by ID.
   */
  async getById(predictionId: string, userId?: string) {
    const where: Prisma.PredictionWhereUniqueInput = { id: predictionId };

    const prediction = await prisma.prediction.findUnique({
      where,
      include: { event: true },
    });

    if (!prediction) {
      throw AppError.notFound('Prediction');
    }

    // If userId provided, verify ownership
    if (userId && prediction.userId !== userId) {
      throw AppError.forbidden('You can only view your own predictions');
    }

    return prediction;
  },

  /**
   * Get all predictions for a user.
   */
  async getByUser(
    userId: string,
    options: {
      status?: PredictionStatus;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const { status, limit = 20, offset = 0 } = options;

    const where: Prisma.PredictionWhereInput = { userId };
    
    if (status) {
      where.status = status;
    }

    const [predictions, total] = await Promise.all([
      prisma.prediction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { event: true },
      }),
      prisma.prediction.count({ where }),
    ]);

    return { predictions, total };
  },

  /**
   * Get all predictions for an event.
   */
  async getByEvent(
    eventId: string,
    options: {
      status?: PredictionStatus;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const { status, limit = 100, offset = 0 } = options;

    const where: Prisma.PredictionWhereInput = { eventId };
    
    if (status) {
      where.status = status;
    }

    const [predictions, total] = await Promise.all([
      prisma.prediction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.prediction.count({ where }),
    ]);

    return { predictions, total };
  },

  /**
   * Get event statistics (prediction counts per outcome).
   */
  async getEventStats(eventId: string) {
    const predictions = await prisma.prediction.groupBy({
      by: ['predictedOutcome'],
      where: { eventId },
      _count: { id: true },
      _sum: { stakeAmount: true },
    });

    const stats = predictions.map((p) => ({
      outcome: p.predictedOutcome,
      count: p._count.id,
      totalStaked: p._sum.stakeAmount ?? 0,
    }));

    const totalPredictions = stats.reduce((sum, s) => sum + s.count, 0);
    const totalStaked = stats.reduce((sum, s) => sum + s.totalStaked, 0);

    return {
      eventId,
      outcomes: stats,
      totalPredictions,
      totalStaked,
    };
  },

  /**
   * Get user's prediction stats.
   */
  async getUserStats(userId: string) {
    const [total, won, lost, pending, cashedOut] = await Promise.all([
      prisma.prediction.count({ where: { userId } }),
      prisma.prediction.count({ where: { userId, status: 'WON' } }),
      prisma.prediction.count({ where: { userId, status: 'LOST' } }),
      prisma.prediction.count({ where: { userId, status: 'PENDING' } }),
      prisma.prediction.count({ where: { userId, status: 'CASHED_OUT' } }),
    ]);

    const winnings = await prisma.prediction.aggregate({
      where: { userId, status: 'WON' },
      _sum: { payout: true },
    });

    const stakes = await prisma.prediction.aggregate({
      where: { userId },
      _sum: { stakeAmount: true },
    });

    return {
      total,
      won,
      lost,
      pending,
      cashedOut,
      winRate: (won + lost) > 0 ? (won / (won + lost)) * 100 : 0,
      totalWinnings: winnings._sum.payout ?? 0,
      totalStaked: stakes._sum.stakeAmount ?? 0,
    };
  },

  /**
   * Calculate current cashout value for a prediction.
   */
  async getCashoutValue(predictionId: string, userId: string) {
    const prediction = await prisma.prediction.findUnique({
      where: { id: predictionId },
      include: { event: true },
    });

    if (!prediction) {
      throw AppError.notFound('Prediction');
    }

    if (prediction.userId !== userId) {
      throw AppError.forbidden('You can only cash out your own predictions');
    }

    if (prediction.status !== 'PENDING' || prediction.cashedOutAt) {
      throw new AppError('CASHOUT_UNAVAILABLE', 'Prediction is not eligible for cashout', 409);
    }

    if (prediction.event.status === 'SETTLED' || prediction.event.status === 'CANCELLED') {
      throw new AppError('CASHOUT_UNAVAILABLE', 'Event is already settled', 409);
    }

    if (!prediction.event.externalEventId || !prediction.event.externalSportKey) {
      throw new AppError('CASHOUT_UNAVAILABLE', 'Event is missing odds mapping', 409);
    }

    const odds = await OddsApiService.getEventOdds(
      prediction.event.externalSportKey,
      prediction.event.externalEventId
    );

    if (!odds) {
      throw new AppError('CASHOUT_UNAVAILABLE', 'Unable to fetch live odds', 409);
    }

    const oddsUpdatedAtMs = new Date(odds.updatedAt).getTime();
    const oddsAgeMs = Date.now() - oddsUpdatedAtMs;
    if (!Number.isFinite(oddsAgeMs) || oddsAgeMs > CASHOUT_ODDS_MAX_AGE_MS) {
      throw new AppError(
        'CASHOUT_UNAVAILABLE',
        'Odds data is too stale for cashout. Please try again in a moment.',
        409
      );
    }

    const outcomeOdds = findOddsOutcome(odds.outcomes, prediction.predictedOutcome);

    if (!outcomeOdds) {
      throw new AppError('CASHOUT_UNAVAILABLE', 'Outcome not found in live odds', 409);
    }

    const originalOdds = prediction.originalOdds?.toNumber();
    if (!originalOdds) {
      throw new AppError('CASHOUT_UNAVAILABLE', 'Original odds not available', 409);
    }

    const eventStarted = prediction.event.startsAt.getTime() <= Date.now();
    const cashoutValue = calculateCashoutValue(
      prediction.stakeAmount,
      originalOdds,
      outcomeOdds.price,
      eventStarted
    );

    return {
      predictionId,
      cashoutValue,
      currentOdds: outcomeOdds.price,
      originalOdds,
      eventStarted,
      oddsAge: Math.round(oddsAgeMs / 1000), // seconds
      updatedAt: odds.updatedAt,
    };
  },

  /**
   * Execute cashout for a prediction.
   */
  async cashout(predictionId: string, userId: string) {
    const cashout = await this.getCashoutValue(predictionId, userId);

    if (cashout.cashoutValue <= 0) {
      throw new AppError('CASHOUT_UNAVAILABLE', 'Cashout value is zero', 409);
    }

    return prisma.$transaction(async (tx) => {
      // Lock the prediction row to prevent double cashout
      const prediction = await lockPredictionForCashout(tx, predictionId);

      if (!prediction || prediction.userId !== userId) {
        throw AppError.notFound('Prediction');
      }

      if (prediction.status !== 'PENDING' || prediction.cashedOutAt) {
        throw new AppError('CASHOUT_UNAVAILABLE', 'Prediction is not eligible for cashout', 409);
      }

      await PointsLedgerService.credit(
        {
          userId,
          amount: cashout.cashoutValue,
          type: 'CASHOUT',
          referenceType: 'PREDICTION',
          referenceId: predictionId,
          description: `Cashout for prediction ${predictionId}`,
        },
        tx
      );

      return tx.prediction.update({
        where: { id: predictionId },
        data: {
          status: 'CASHED_OUT',
          cashedOutAt: new Date(),
          cashoutAmount: cashout.cashoutValue,
          payout: cashout.cashoutValue,
        },
      });
    });
  },
};

export function calculateCashoutValue(
  originalStakeTokens: number,
  originalOdds: number,
  currentOdds: number,
  eventStarted: boolean
): number {
  // Standard cashout formula: stake * (originalOdds / currentOdds) * margin
  const margin = eventStarted ? 0.9 : 0.95;
  const cashoutValue = Math.floor(originalStakeTokens * (originalOdds / currentOdds) * margin);

  return Math.max(0, cashoutValue);
}

async function lockEventForPrediction(
  tx: Prisma.TransactionClient,
  eventId: string
): Promise<{ id: string; status: string; startsAt: Date } | null> {
  const [lockedEvent] = await tx.$queryRaw<
    Array<{ id: string; status: string; startsAt: Date }>
  >`SELECT "id", "status", "startsAt" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
  return lockedEvent ?? null;
}

async function lockPredictionForCashout(
  tx: Prisma.TransactionClient,
  predictionId: string
): Promise<{
  id: string;
  userId: string;
  status: string;
  cashedOutAt: Date | null;
  stakeAmount: number;
} | null> {
  const [prediction] = await tx.$queryRaw<
    Array<{
      id: string;
      userId: string;
      status: string;
      cashedOutAt: Date | null;
      stakeAmount: number;
    }>
  >`SELECT "id", "userId", "status", "cashedOutAt", "stakeAmount" FROM "Prediction" WHERE "id" = ${predictionId} FOR UPDATE`;
  return prediction ?? null;
}
