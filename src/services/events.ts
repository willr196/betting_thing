import { EventStatus, Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { LedgerService } from './ledger.js';
import { PointsLedgerService } from './pointsLedger.js';
import { TokenAllowanceService } from './tokenAllowance.js';
import { AchievementService } from './achievements.js';
import { LeaderboardService } from './leaderboard.js';
import { LeagueStandingsService } from './leagueStandings.js';
import { AccumulatorService } from './accumulators.js';
import { matchOutcomeExact, normalizeOutcome } from './outcomes.js';
import { AppError } from '../utils/index.js';
import type { SettlementResult } from '../types/index.js';
import type { NormalizedOdds } from './oddsApi.js';
import { logger } from '../logger.js';

type EditableOddsOutcome = {
  name: string;
  price: number;
};

// =============================================================================
// EVENT SERVICE
// =============================================================================

export const EventService = {
  /**
   * Create a new event.
   */
  async create(data: {
    title: string;
    description?: string;
    startsAt: Date;
    outcomes: string[];
    payoutMultiplier?: number;
    odds?: EditableOddsOutcome[];
    createdBy: string;
    externalEventId?: string;
    externalSportKey?: string;
    detachFromExternalSource?: boolean;
  }) {
    if (data.startsAt.getTime() <= Date.now()) {
      throw AppError.badRequest('Event start time must be in the future');
    }

    const outcomes = sanitizeOutcomeNames(data.outcomes);
    const payoutMultiplier = data.payoutMultiplier ?? 2.0;
    const hasAnyExternalMapping = Boolean(data.externalEventId || data.externalSportKey);
    const hasFullExternalMapping = Boolean(data.externalEventId && data.externalSportKey);
    const localOnly =
      data.detachFromExternalSource === true || !hasFullExternalMapping;

    if (!data.detachFromExternalSource && hasAnyExternalMapping && !hasFullExternalMapping) {
      throw AppError.badRequest(
        'External event ID and sport key must be provided together'
      );
    }

    const odds = data.odds
      ? buildOddsSnapshot(outcomes, data.odds)
      : buildDefaultOddsSnapshot(outcomes, payoutMultiplier);

    return prisma.event.create({
      data: {
        title: data.title,
        description: data.description,
        startsAt: data.startsAt,
        outcomes,
        payoutMultiplier,
        createdBy: data.createdBy,
        status: 'OPEN',
        externalEventId: localOnly ? null : data.externalEventId,
        externalSportKey: localOnly ? null : data.externalSportKey,
        currentOdds: odds as unknown as Prisma.InputJsonValue,
        oddsUpdatedAt: new Date(odds.updatedAt),
      },
    });
  },

  async update(
    eventId: string,
    data: {
      title?: string;
      description?: string | null;
      startsAt?: Date;
      outcomes?: string[];
      payoutMultiplier?: number;
      odds?: EditableOddsOutcome[];
      detachFromExternalSource?: boolean;
    }
  ) {
    return prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({
        where: { id: eventId },
        include: {
          _count: {
            select: { predictions: true },
          },
        },
      });

      if (!event) {
        throw AppError.notFound('Event');
      }

      if (event.status === 'SETTLED' || event.status === 'CANCELLED') {
        throw AppError.badRequest('Only OPEN or LOCKED events can be edited');
      }

      if (data.startsAt) {
        if (event.status !== 'OPEN') {
          throw AppError.badRequest('Only OPEN events can change start time');
        }

        if (data.startsAt.getTime() <= Date.now()) {
          throw AppError.badRequest('Event start time must be in the future');
        }
      }

      const nextOutcomes = data.outcomes
        ? sanitizeOutcomeNames(data.outcomes)
        : event.outcomes;

      if (
        event._count.predictions > 0 &&
        !haveSameOutcomeSet(event.outcomes, nextOutcomes)
      ) {
        throw AppError.badRequest(
          'Cannot change event outcomes after predictions have been placed'
        );
      }

      const nextPayoutMultiplier = data.payoutMultiplier ?? event.payoutMultiplier;
      const currentOdds = getStoredOddsSnapshot(event.currentOdds);
      let nextOdds: NormalizedOdds | undefined;

      if (data.odds) {
        nextOdds = buildOddsSnapshot(nextOutcomes, data.odds);
      } else if (data.outcomes || !currentOdds) {
        nextOdds = buildOddsSnapshotFromExisting(
          nextOutcomes,
          currentOdds,
          nextPayoutMultiplier
        );
      }

      const nextTitle = data.title?.trim();
      const nextDescription =
        data.description === undefined ? event.description : data.description?.trim() || null;

      return tx.event.update({
        where: { id: eventId },
        data: {
          title: nextTitle && nextTitle.length > 0 ? nextTitle : event.title,
          description: nextDescription,
          startsAt: data.startsAt ?? event.startsAt,
          outcomes: nextOutcomes,
          payoutMultiplier: nextPayoutMultiplier,
          ...(nextOdds
            ? {
                currentOdds: nextOdds as unknown as Prisma.InputJsonValue,
                oddsUpdatedAt: new Date(nextOdds.updatedAt),
              }
            : {}),
          ...(data.detachFromExternalSource
            ? {
                externalEventId: null,
                externalSportKey: null,
              }
            : {}),
        },
      });
    });
  },

  /**
   * Get event by ID.
   */
  async getById(eventId: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        _count: {
          select: { predictions: true },
        },
      },
    });

    if (!event) {
      throw AppError.notFound('Event');
    }

    return event;
  },

  /**
   * List events with optional filters.
   */
  async list(options: {
    status?: EventStatus;
    limit?: number;
    offset?: number;
    upcoming?: boolean;
    sportKey?: string;
    sportKeyPrefix?: string;
  } = {}) {
    const {
      status,
      limit = 20,
      offset = 0,
      upcoming,
      sportKey,
      sportKeyPrefix,
    } = options;

    const where: Prisma.EventWhereInput = {};
    
    if (status) {
      where.status = status;
    }
    
    if (upcoming) {
      where.startsAt = { gt: new Date() };
      where.status = 'OPEN';
    }

    if (sportKey) {
      where.externalSportKey = sportKey;
    } else if (sportKeyPrefix) {
      where.externalSportKey = { startsWith: sportKeyPrefix };
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy: { startsAt: 'asc' },
        take: limit,
        skip: offset,
        include: {
          _count: {
            select: { predictions: true },
          },
        },
      }),
      prisma.event.count({ where }),
    ]);

    return { events, total };
  },

  /**
   * Lock an event (no more predictions allowed).
   * Usually called when event starts.
   */
  async lock(eventId: string) {
    const event = await this.getById(eventId);

    if (event.status !== 'OPEN') {
      throw new AppError('EVENT_NOT_OPEN', `Event is ${event.status}, cannot lock`, 400);
    }

    return prisma.event.update({
      where: { id: eventId },
      data: { status: 'LOCKED' },
    });
  },

  /**
   * Settle an event with a final outcome.
   * This is the CRITICAL operation that must be atomic.
   * 
   * Steps:
   * 1. Lock the event (if not already)
   * 2. Set final outcome
   * 3. Process all predictions (winners get paid, losers marked)
   * 4. Mark event as settled
   */
  async settle(
    eventId: string,
    finalOutcome: string,
    settledBy: string
  ): Promise<SettlementResult> {
    const { settlement, affectedUserIds } = await prisma.$transaction(
      async (tx) => {
        const settledAt = new Date();

        // Lock the event row and verify status inside the transaction.
        const [lockedEvent] = await tx.$queryRaw<
          Array<{
            id: string;
            status: string;
            outcomes: string[];
            payoutMultiplier: number;
          }>
        >`SELECT "id", "status", "outcomes", "payoutMultiplier"
          FROM "Event"
          WHERE "id" = ${eventId}
          FOR UPDATE`;

        if (!lockedEvent) {
          throw AppError.notFound('Event');
        }

        if (lockedEvent.status === 'SETTLED') {
          throw new AppError('EVENT_ALREADY_SETTLED', 'Event has already been settled', 400);
        }

        if (lockedEvent.status === 'CANCELLED') {
          throw new AppError('EVENT_ALREADY_SETTLED', 'Event was cancelled', 400);
        }

        // Validate outcome against event's possible outcomes.
        if (!lockedEvent.outcomes.includes(finalOutcome)) {
          throw new AppError(
            'INVALID_OUTCOME',
            `Invalid outcome. Must be one of: ${lockedEvent.outcomes.join(', ')}`,
            400
          );
        }

        // Lock all PENDING predictions for this event with FOR UPDATE.
        // This prevents double-settlement if two transactions somehow run concurrently
        // (belt-and-suspenders alongside the event-level lock above).
        const predictions = await tx.$queryRaw<
          Array<{
            id: string;
            userId: string;
            predictedOutcome: string;
            stakeAmount: number;
            originalOdds: Prisma.Decimal | null;
            status: string;
          }>
        >`SELECT "id", "userId", "predictedOutcome", "stakeAmount", "originalOdds", "status"
          FROM "Prediction"
          WHERE "eventId" = ${eventId} AND "status" = 'PENDING'
          FOR UPDATE`;

        let winners = 0;
        let losers = 0;
        let totalPayout = 0;

        for (const prediction of predictions) {
          // Idempotency guard: skip if already settled (stale read protection)
          if (prediction.status !== 'PENDING') continue;

          const isWinner = prediction.predictedOutcome === finalOutcome;

          if (isWinner) {
            const rawOdds = prediction.originalOdds;
            const odds =
              rawOdds != null
                ? (typeof rawOdds === 'object' && 'toNumber' in rawOdds
                    ? (rawOdds as Prisma.Decimal).toNumber()
                    : Number(rawOdds))
                : lockedEvent.payoutMultiplier;
            const payout = calculatePayout(prediction.stakeAmount, odds);

            const wonUpdate = await tx.prediction.updateMany({
              where: {
                id: prediction.id,
                status: 'PENDING',
              },
              data: {
                status: 'WON',
                payout,
                settledAt,
              },
            });

            if (wonUpdate.count === 0) {
              continue;
            }

            await PointsLedgerService.credit(
              {
                userId: prediction.userId,
                amount: payout,
                type: 'PREDICTION_WIN',
                referenceType: 'PREDICTION',
                referenceId: prediction.id,
                description: `Winnings for prediction ${prediction.id}`,
              },
              tx
            );
            await LeaderboardService.updateAfterSettlement(prediction.userId, true, payout, tx);
            await AchievementService.checkAndAward(prediction.userId, tx);

            winners++;
            totalPayout += payout;
          } else {
            const lostUpdate = await tx.prediction.updateMany({
              where: {
                id: prediction.id,
                status: 'PENDING',
              },
              data: {
                status: 'LOST',
                payout: 0,
                settledAt,
              },
            });

            if (lostUpdate.count === 0) {
              continue;
            }

            await LeaderboardService.updateAfterSettlement(prediction.userId, false, 0, tx);
            await AchievementService.checkAndAward(prediction.userId, tx);
            losers++;
          }
        }

        await AccumulatorService.settleLegsForEvent(eventId, finalOutcome, tx);

        await tx.event.update({
          where: { id: eventId },
          data: {
            status: 'SETTLED',
            finalOutcome,
            settledBy,
            settledAt,
          },
        });

        return {
          settlement: {
            eventId,
            finalOutcome,
            totalPredictions: predictions.length,
            winners,
            losers,
            totalPayout,
            settledAt,
          },
          affectedUserIds: Array.from(new Set(predictions.map((prediction) => prediction.userId))),
        };
      },
      {
        // Safety: avoid holding row locks indefinitely if something goes wrong.
        timeout: 30000,
      }
    );

    if (affectedUserIds.length > 0) {
      try {
        await LeagueStandingsService.recalculateForUsers(affectedUserIds);
      } catch (error) {
        logger.error(
          { err: error, eventId, affectedUsers: affectedUserIds.length },
          '[Leagues] Failed to refresh standings after event settlement'
        );
      }
    }

    return settlement;
  },

  /**
   * Cancel an event and refund all stakes.
   */
  async cancel(eventId: string, cancelledBy: string): Promise<{ refunded: number }> {
    return prisma.$transaction(
      async (tx) => {
        const cancelledAt = new Date();

        const [lockedEvent] = await tx.$queryRaw<
          Array<{ id: string; status: string }>
        >`SELECT "id", "status"
          FROM "Event"
          WHERE "id" = ${eventId}
          FOR UPDATE`;

        if (!lockedEvent) {
          throw AppError.notFound('Event');
        }

        if (lockedEvent.status === 'CANCELLED') {
          throw new AppError(
            'ALREADY_CANCELLED' as never,
            'Event has already been cancelled',
            409
          );
        }

        if (lockedEvent.status === 'SETTLED') {
          throw new AppError('EVENT_ALREADY_SETTLED', 'Cannot cancel a settled event', 400);
        }

        if (lockedEvent.status !== 'OPEN' && lockedEvent.status !== 'LOCKED') {
          throw AppError.badRequest(`Cannot cancel event with status ${lockedEvent.status}`);
        }

        await tx.event.update({
          where: { id: eventId },
          data: {
            status: 'CANCELLED',
            settledBy: cancelledBy,
            settledAt: cancelledAt,
          },
        });

        // Lock PENDING predictions inside the same transaction to avoid stale reads
        // and protect against concurrent cashouts/settlements.
        const predictions = await tx.$queryRaw<
          Array<{
            id: string;
            userId: string;
            stakeAmount: number;
            status: string;
          }>
        >`SELECT "id", "userId", "stakeAmount", "status"
          FROM "Prediction"
          WHERE "eventId" = ${eventId} AND "status" = 'PENDING'
          FOR UPDATE`;

        let refunded = 0;

        for (const prediction of predictions) {
          if (prediction.status !== 'PENDING') {
            continue;
          }

          const refundedUpdate = await tx.prediction.updateMany({
            where: {
              id: prediction.id,
              status: 'PENDING',
            },
            data: {
              status: 'REFUNDED',
              payout: 0,
              settledAt: cancelledAt,
            },
          });

          if (refundedUpdate.count === 0) {
            continue;
          }

          await LedgerService.refundPrediction(
            prediction.userId,
            prediction.stakeAmount,
            prediction.id,
            tx
          );
          await TokenAllowanceService.syncToLedgerBalance(prediction.userId, tx);

          refunded++;
        }

        await AccumulatorService.cancelLegsForEvent(eventId, tx);

        return { refunded };
      },
      {
        timeout: 30000,
      }
    );
  },

  /**
   * Auto-lock events that have started.
   * Can be run periodically by a cron job.
   */
  async autoLockStartedEvents(): Promise<number> {
    const result = await prisma.event.updateMany({
      where: {
        status: 'OPEN',
        startsAt: { lte: new Date() },
      },
      data: {
        status: 'LOCKED',
      },
    });

    return result.count;
  },

  /**
   * Find LOCKED events that started more than `thresholdHours` ago and
   * have not been settled. These may need manual review or cancellation.
   */
  async findStaleLockedEvents(thresholdHours = 24) {
    const threshold = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);
    return prisma.event.findMany({
      where: {
        status: 'LOCKED',
        startsAt: { lt: threshold },
      },
      orderBy: { startsAt: 'asc' },
      include: {
        _count: { select: { predictions: true } },
      },
    });
  },

  async cleanupStaleUnpredictedEvents(
    cancelledBy = 'system',
    thresholdHours = 24
  ): Promise<number> {
    const threshold = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);
    const staleEvents = await prisma.event.findMany({
      where: {
        status: { in: ['OPEN', 'LOCKED'] },
        startsAt: { lt: threshold },
        predictions: { none: {} },
      },
      select: { id: true },
    });

    let cancelled = 0;
    for (const event of staleEvents) {
      try {
        await this.cancel(event.id, cancelledBy);
        cancelled++;
      } catch (error) {
        if (error instanceof AppError && error.code === 'EVENT_ALREADY_SETTLED') {
          continue;
        }
        if (error instanceof AppError && String(error.code) === 'ALREADY_CANCELLED') {
          continue;
        }
        throw error;
      }
    }

    return cancelled;
  },

  /**
   * Delete SETTLED and CANCELLED events older than `thresholdDays` days.
   * Cleans up related predictions and accumulator legs in the same transaction.
   * Ledger records (TokenTransaction, PointsTransaction) are preserved — they
   * use soft references (referenceType/referenceId) so no FK constraint breaks.
   */
  async deleteOldFinishedEvents(thresholdDays = 1): Promise<number> {
    const threshold = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

    const oldEvents = await prisma.event.findMany({
      where: {
        status: { in: ['SETTLED', 'CANCELLED'] },
        settledAt: { lt: threshold },
      },
      select: { id: true },
    });

    if (oldEvents.length === 0) return 0;

    const eventIds = oldEvents.map((e) => e.id);

    await prisma.$transaction(async (tx) => {
      // Remove legs first; accumulator header rows remain but are orphaned below
      await tx.accumulatorLeg.deleteMany({ where: { eventId: { in: eventIds } } });

      // Delete accumulators that now have no legs at all
      await tx.accumulator.deleteMany({ where: { legs: { none: {} } } });

      await tx.prediction.deleteMany({ where: { eventId: { in: eventIds } } });

      await tx.event.deleteMany({ where: { id: { in: eventIds } } });
    });

    return eventIds.length;
  },

  async updateOdds(eventId: string, odds: NormalizedOdds) {
    return prisma.event.update({
      where: { id: eventId },
      data: {
        currentOdds: odds as unknown as Prisma.InputJsonValue,
        oddsUpdatedAt: new Date(odds.updatedAt),
      },
    });
  },
};

export function calculatePayout(stakeAmount: number, odds: number): number {
  return Math.floor(stakeAmount * odds);
}

function sanitizeOutcomeNames(outcomes: string[]): string[] {
  if (outcomes.length < 2) {
    throw AppError.badRequest('Event must have at least 2 possible outcomes');
  }

  const normalizedSeen = new Set<string>();
  const sanitized = outcomes.map((outcome) => {
    const trimmed = outcome.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      throw AppError.badRequest('Event outcomes cannot be empty');
    }

    const normalized = normalizeOutcome(trimmed);
    if (normalizedSeen.has(normalized)) {
      throw AppError.badRequest('Event outcomes must be unique');
    }
    normalizedSeen.add(normalized);

    return trimmed;
  });

  return sanitized;
}

function buildOddsSnapshot(
  outcomes: string[],
  odds: EditableOddsOutcome[],
  updatedAt = new Date().toISOString()
): NormalizedOdds {
  if (odds.length < 2) {
    throw AppError.badRequest('Odds must be provided for at least 2 outcomes');
  }

  const matchedOutcomes = outcomes.map((outcome) => {
    const matchingOdds = odds.find(
      (candidate) => matchOutcomeExact([outcome], candidate.name) === outcome
    );

    if (!matchingOdds) {
      throw AppError.badRequest(
        `Missing odds for outcome "${outcome}"`
      );
    }

    if (!Number.isFinite(matchingOdds.price) || matchingOdds.price <= 1) {
      throw AppError.badRequest(
        `Odds for "${outcome}" must be greater than 1`
      );
    }

    return {
      name: outcome,
      price: matchingOdds.price,
    };
  });

  if (matchedOutcomes.length !== odds.length) {
    throw AppError.badRequest('Odds entries must match the event outcomes exactly');
  }

  return {
    outcomes: matchedOutcomes,
    updatedAt,
  };
}

function buildDefaultOddsSnapshot(
  outcomes: string[],
  payoutMultiplier: number
): NormalizedOdds {
  return {
    outcomes: outcomes.map((outcome) => ({
      name: outcome,
      price: payoutMultiplier,
    })),
    updatedAt: new Date().toISOString(),
  };
}

function buildOddsSnapshotFromExisting(
  outcomes: string[],
  existingOdds: NormalizedOdds | null,
  payoutMultiplier: number
): NormalizedOdds {
  if (!existingOdds) {
    return buildDefaultOddsSnapshot(outcomes, payoutMultiplier);
  }

  return {
    outcomes: outcomes.map((outcome) => ({
      name: outcome,
      price:
        existingOdds.outcomes.find(
          (candidate) => matchOutcomeExact([outcome], candidate.name) === outcome
        )?.price ?? payoutMultiplier,
    })),
    updatedAt: new Date().toISOString(),
  };
}

function getStoredOddsSnapshot(currentOdds: unknown): NormalizedOdds | null {
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

function haveSameOutcomeSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right.map((outcome) => normalizeOutcome(outcome)));
  return left.every((outcome) => rightSet.has(normalizeOutcome(outcome)));
}
