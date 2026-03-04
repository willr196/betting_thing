import { PredictionStatus, Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/index.js';
import { TokenAllowanceService } from './tokenAllowance.js';
import { OddsApiService, type NormalizedOdds } from './oddsApi.js';
import { PointsLedgerService } from './pointsLedger.js';
import { matchOutcomeExact, findOddsOutcome } from './outcomes.js';
import { logger } from '../logger.js';

// =============================================================================
// PREDICTION SERVICE
// =============================================================================

const ODDS_STALENESS_THRESHOLD_MS = config.oddsApi.stalenessThresholdMs;

type OddsPolicy = {
  unavailableCode: string;
  unavailableMessage: string;
  unavailableStatus: number;
  staleCode: string;
  staleMessage: string;
  staleStatus: number;
};

const PLACE_ODDS_POLICY: OddsPolicy = {
  unavailableCode: 'ODDS_UNAVAILABLE',
  unavailableMessage: 'Odds not yet available for this event. Please try again shortly.',
  unavailableStatus: 503,
  staleCode: 'ODDS_STALE',
  staleMessage: 'Odds data is being refreshed. Please try again in a moment.',
  staleStatus: 503,
};

const CASHOUT_ODDS_POLICY: OddsPolicy = {
  unavailableCode: 'CASHOUT_UNAVAILABLE',
  unavailableMessage: 'Odds data is unavailable for cashout. Please try again shortly.',
  unavailableStatus: 409,
  staleCode: 'ODDS_STALE',
  staleMessage: 'Odds data is too old to cashout safely. Please try again.',
  staleStatus: 409,
};

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

    // Validate outcome against event's possible outcomes
    const canonicalOutcome = matchOutcomeExact(event.outcomes, predictedOutcome);
    if (!canonicalOutcome) {
      throw new AppError(
        'INVALID_OUTCOME',
        `Invalid outcome. Must be one of: ${event.outcomes.join(', ')}`,
        400
      );
    }

    const oddsResult = await resolveEventOddsWithFallback(event, PLACE_ODDS_POLICY);

    const outcomeOdds = findOddsOutcome(oddsResult.odds.outcomes, canonicalOutcome);

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

    const oddsResult = await resolveEventOddsWithFallback(prediction.event, CASHOUT_ODDS_POLICY);
    const oddsAgeMs = Date.now() - oddsResult.updatedAtMs;

    const outcomeOdds = findOddsOutcome(oddsResult.odds.outcomes, prediction.predictedOutcome);

    if (!outcomeOdds) {
      throw new AppError('CASHOUT_UNAVAILABLE', 'Outcome not found in cached odds', 409);
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
      updatedAt: new Date(oddsResult.updatedAtMs).toISOString(),
    };
  },

  /**
   * Execute cashout for a prediction.
   */
  async cashout(predictionId: string, userId: string) {
    const cashoutPreview = await this.getCashoutValue(predictionId, userId);

    if (cashoutPreview.cashoutValue <= 0) {
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

      const event = await lockEventForCashout(tx, prediction.eventId);
      if (!event) {
        throw AppError.notFound('Event');
      }

      if (event.status === 'SETTLED' || event.status === 'CANCELLED') {
        throw new AppError('CASHOUT_UNAVAILABLE', 'Event is already settled', 409);
      }

      const refreshedOdds = await resolveEventOddsWithFallback(
        event,
        CASHOUT_ODDS_POLICY,
        { forceRefresh: true, tx }
      );

      const refreshedOutcomeOdds = findOddsOutcome(
        refreshedOdds.odds.outcomes,
        prediction.predictedOutcome
      );
      if (!refreshedOutcomeOdds) {
        throw new AppError('CASHOUT_UNAVAILABLE', 'Outcome not found in cached odds', 409);
      }

      const oddsDriftPercent = calculateOddsDriftPercent(
        cashoutPreview.currentOdds,
        refreshedOutcomeOdds.price
      );
      if (oddsDriftPercent > config.cashout.oddsDriftThresholdPercent) {
        throw new AppError(
          'CASHOUT_ODDS_CHANGED' as never,
          'Cashout odds changed materially. Please refresh and try again.',
          409,
          {
            requestedOdds: cashoutPreview.currentOdds,
            latestOdds: refreshedOutcomeOdds.price,
            driftPercent: Math.round(oddsDriftPercent * 100) / 100,
            maxAllowedPercent: config.cashout.oddsDriftThresholdPercent,
          }
        );
      }

      const originalOdds = prediction.originalOdds?.toNumber();
      if (!originalOdds) {
        throw new AppError('CASHOUT_UNAVAILABLE', 'Original odds not available', 409);
      }

      const eventStarted = event.startsAt.getTime() <= Date.now();
      const finalCashoutValue = calculateCashoutValue(
        prediction.stakeAmount,
        originalOdds,
        refreshedOutcomeOdds.price,
        eventStarted
      );

      if (finalCashoutValue <= 0) {
        throw new AppError('CASHOUT_UNAVAILABLE', 'Cashout value is zero', 409);
      }

      await PointsLedgerService.credit(
        {
          userId,
          amount: finalCashoutValue,
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
          cashoutAmount: finalCashoutValue,
          payout: finalCashoutValue,
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

type EventOddsSnapshot = {
  id: string;
  externalSportKey: string | null;
  externalEventId: string | null;
  currentOdds: unknown;
  oddsUpdatedAt: Date | null;
};

async function resolveEventOddsWithFallback(
  event: EventOddsSnapshot,
  policy: OddsPolicy,
  options: { forceRefresh?: boolean; tx?: Prisma.TransactionClient } = {}
): Promise<{ odds: NormalizedOdds; updatedAtMs: number }> {
  const { forceRefresh = false, tx } = options;

  if (event.externalSportKey && event.externalEventId) {
    try {
      const liveOdds = await OddsApiService.getEventOdds(
        event.externalSportKey,
        event.externalEventId,
        { forceRefresh }
      );

      if (liveOdds) {
        await persistEventOdds(event.id, liveOdds, tx);
        return {
          odds: liveOdds,
          updatedAtMs: new Date(liveOdds.updatedAt).getTime(),
        };
      }
    } catch (error) {
      logger.warn(
        {
          eventId: event.id,
          externalSportKey: event.externalSportKey,
          externalEventId: event.externalEventId,
          err: error,
        },
        '[Prediction] Live odds fetch failed, attempting cached DB odds fallback'
      );
    }
  }

  const cachedOdds = getCachedOdds(event.currentOdds);
  if (!cachedOdds) {
    throw new AppError(
      policy.unavailableCode as never,
      policy.unavailableMessage,
      policy.unavailableStatus
    );
  }

  const updatedAtMs = getOddsUpdatedAtMs(event.oddsUpdatedAt, cachedOdds.updatedAt);
  const oddsAgeMs = Date.now() - updatedAtMs;
  if (!Number.isFinite(oddsAgeMs) || oddsAgeMs > ODDS_STALENESS_THRESHOLD_MS) {
    throw new AppError(
      policy.staleCode as never,
      policy.staleMessage,
      policy.staleStatus,
      {
        maxAgeMinutes: Math.round(ODDS_STALENESS_THRESHOLD_MS / 60_000),
      }
    );
  }

  return {
    odds: cachedOdds,
    updatedAtMs,
  };
}

function getOddsUpdatedAtMs(oddsUpdatedAt: Date | null, fallbackUpdatedAt: string) {
  if (oddsUpdatedAt) {
    return oddsUpdatedAt.getTime();
  }

  return new Date(fallbackUpdatedAt).getTime();
}

async function persistEventOdds(
  eventId: string,
  odds: NormalizedOdds,
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? prisma;

  try {
    await client.event.update({
      where: { id: eventId },
      data: {
        currentOdds: odds as unknown as Prisma.InputJsonValue,
        oddsUpdatedAt: new Date(odds.updatedAt),
      },
    });
  } catch (error) {
    logger.warn({ eventId, err: error }, '[Prediction] Failed to persist refreshed event odds');
  }
}

function calculateOddsDriftPercent(previousOdds: number, latestOdds: number): number {
  if (previousOdds <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(((latestOdds - previousOdds) / previousOdds) * 100);
}

function getCachedOdds(currentOdds: unknown): NormalizedOdds | null {
  if (!currentOdds || typeof currentOdds !== 'object' || Array.isArray(currentOdds)) {
    return null;
  }

  const candidate = currentOdds as {
    outcomes?: unknown;
    updatedAt?: unknown;
  };

  if (!Array.isArray(candidate.outcomes) || typeof candidate.updatedAt !== 'string') {
    return null;
  }

  const updatedAtMs = new Date(candidate.updatedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) {
    return null;
  }

  const outcomes = candidate.outcomes.map((outcome) => {
    if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) {
      return null;
    }

    const parsed = outcome as { name?: unknown; price?: unknown };
    if (typeof parsed.name !== 'string' || typeof parsed.price !== 'number') {
      return null;
    }

    if (!Number.isFinite(parsed.price)) {
      return null;
    }

    return {
      name: parsed.name,
      price: parsed.price,
    };
  });

  if (outcomes.some((outcome) => outcome === null)) {
    return null;
  }

  return {
    outcomes: outcomes as NormalizedOdds['outcomes'],
    updatedAt: candidate.updatedAt,
  };
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
  eventId: string;
  predictedOutcome: string;
  status: string;
  cashedOutAt: Date | null;
  stakeAmount: number;
  originalOdds: Prisma.Decimal | null;
} | null> {
  const [prediction] = await tx.$queryRaw<
    Array<{
      id: string;
      userId: string;
      eventId: string;
      predictedOutcome: string;
      status: string;
      cashedOutAt: Date | null;
      stakeAmount: number;
      originalOdds: Prisma.Decimal | null;
    }>
  >`SELECT "id", "userId", "eventId", "predictedOutcome", "status", "cashedOutAt", "stakeAmount", "originalOdds"
    FROM "Prediction"
    WHERE "id" = ${predictionId}
    FOR UPDATE`;
  return prediction ?? null;
}

async function lockEventForCashout(
  tx: Prisma.TransactionClient,
  eventId: string
): Promise<{
  id: string;
  status: string;
  startsAt: Date;
  externalSportKey: string | null;
  externalEventId: string | null;
  currentOdds: unknown;
  oddsUpdatedAt: Date | null;
} | null> {
  const [event] = await tx.$queryRaw<
    Array<{
      id: string;
      status: string;
      startsAt: Date;
      externalSportKey: string | null;
      externalEventId: string | null;
      currentOdds: unknown;
      oddsUpdatedAt: Date | null;
    }>
  >`SELECT "id", "status", "startsAt", "externalSportKey", "externalEventId", "currentOdds", "oddsUpdatedAt"
    FROM "Event"
    WHERE "id" = ${eventId}
    FOR UPDATE`;

  return event ?? null;
}

export function calculateOddsDriftPercentForTest(previousOdds: number, latestOdds: number): number {
  return calculateOddsDriftPercent(previousOdds, latestOdds);
}
