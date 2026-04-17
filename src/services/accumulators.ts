import { AccumulatorStatus, Prisma } from '@prisma/client';
import { config } from '../config/index.js';
import { AppError } from '../utils/index.js';
import { prisma } from './database.js';
import { LedgerService } from './ledger.js';
import { PointsLedgerService } from './pointsLedger.js';
import { findOddsOutcome, matchOutcomeExact } from './outcomes.js';
import { TokenAllowanceService } from './tokenAllowance.js';

const MAX_LEGS = 10;
const MAX_COMBINED_ODDS = 5000;

type PlaceAccumulatorInput = {
  userId: string;
  legs: Array<{ eventId: string; predictedOutcome: string }>;
  stakeAmount: number;
};

type LegWithOdds = {
  eventId: string;
  predictedOutcome: string;
  odds: number;
};

export const AccumulatorService = {
  async place(data: PlaceAccumulatorInput) {
    const { userId, legs, stakeAmount } = data;

    if (legs.length < 2) {
      throw AppError.badRequest('Accumulator must have at least 2 selections');
    }

    if (legs.length > MAX_LEGS) {
      throw AppError.badRequest(`Accumulator can have at most ${MAX_LEGS} selections`);
    }

    if (stakeAmount < config.tokens.minStake) {
      throw AppError.badRequest(`Minimum stake is ${config.tokens.minStake} tokens`);
    }

    if (stakeAmount > config.tokens.maxStake) {
      throw AppError.badRequest(`Maximum stake is ${config.tokens.maxStake} tokens`);
    }

    const uniqueEventIds = [...new Set(legs.map((leg) => leg.eventId))];
    if (uniqueEventIds.length !== legs.length) {
      throw AppError.badRequest('Accumulator selections must be from different events');
    }

    const events = await prisma.event.findMany({
      where: { id: { in: uniqueEventIds } },
    });

    const eventMap = new Map(events.map((event) => [event.id, event]));
    const normalizedLegs: LegWithOdds[] = [];

    for (const leg of legs) {
      const event = eventMap.get(leg.eventId);
      if (!event) {
        throw AppError.notFound(`Event ${leg.eventId}`);
      }

      if (event.status !== 'OPEN') {
        throw new AppError('EVENT_NOT_OPEN', `Event "${event.title}" is ${event.status}`, 400);
      }

      if (event.startsAt.getTime() <= Date.now()) {
        throw new AppError('EVENT_ALREADY_STARTED', `Event "${event.title}" has already started`, 400);
      }

      const canonicalOutcome = matchOutcomeExact(event.outcomes, leg.predictedOutcome);
      if (!canonicalOutcome) {
        throw new AppError(
          'INVALID_OUTCOME',
          `"${leg.predictedOutcome}" is not a valid outcome for "${event.title}"`,
          400
        );
      }

      const odds = resolveLegOdds(event, canonicalOutcome);

      normalizedLegs.push({
        eventId: leg.eventId,
        predictedOutcome: canonicalOutcome,
        odds,
      });
    }

    let combinedOdds = normalizedLegs.reduce((acc, leg) => acc * leg.odds, 1);
    combinedOdds = Math.min(combinedOdds, MAX_COMBINED_ODDS);

    const potentialPayout = Math.floor(stakeAmount * combinedOdds);

    return prisma.$transaction(async (tx) => {
      for (const eventId of uniqueEventIds) {
        const [lockedEvent] = await tx.$queryRaw<
          Array<{ id: string; status: string; startsAt: Date }>
        >`SELECT "id", "status", "startsAt" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;

        if (!lockedEvent || lockedEvent.status !== 'OPEN') {
          throw new AppError('EVENT_NOT_OPEN', 'One or more events are no longer open', 400);
        }

        if (lockedEvent.startsAt.getTime() <= Date.now()) {
          throw new AppError('EVENT_ALREADY_STARTED', 'One or more events have already started', 400);
        }
      }

      const accumulator = await tx.accumulator.create({
        data: {
          userId,
          stakeAmount,
          combinedOdds: new Prisma.Decimal(combinedOdds),
          potentialPayout,
          status: 'PENDING',
          legs: {
            create: normalizedLegs.map((leg) => ({
              eventId: leg.eventId,
              predictedOutcome: leg.predictedOutcome,
              odds: new Prisma.Decimal(leg.odds),
            })),
          },
        },
        include: {
          legs: {
            include: {
              event: true,
            },
          },
        },
      });

      await TokenAllowanceService.consumeTokens(
        userId,
        stakeAmount,
        accumulator.id,
        tx,
        {
          referenceType: 'ACCUMULATOR',
          description: `Stake for accumulator ${accumulator.id}`,
        }
      );

      return accumulator;
    });
  },

  async getByUser(
    userId: string,
    options: { status?: AccumulatorStatus; limit?: number; offset?: number } = {}
  ) {
    const { status, limit = 20, offset = 0 } = options;

    const where: Prisma.AccumulatorWhereInput = { userId };
    if (status) {
      where.status = status;
    }

    const [accumulators, total] = await Promise.all([
      prisma.accumulator.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          legs: {
            include: {
              event: true,
            },
          },
        },
      }),
      prisma.accumulator.count({ where }),
    ]);

    return { accumulators, total };
  },

  async getById(accumulatorId: string, userId?: string) {
    const accumulator = await prisma.accumulator.findUnique({
      where: { id: accumulatorId },
      include: {
        legs: {
          include: {
            event: true,
          },
        },
      },
    });

    if (!accumulator) {
      throw AppError.notFound('Accumulator');
    }

    if (userId && accumulator.userId !== userId) {
      throw AppError.forbidden('You can only view your own accumulators');
    }

    return accumulator;
  },

  async settleLegsForEvent(eventId: string, finalOutcome: string, tx: Prisma.TransactionClient) {
    const now = new Date();

    const pendingLegs = await tx.accumulatorLeg.findMany({
      where: {
        eventId,
        status: 'PENDING',
      },
      select: {
        id: true,
        accumulatorId: true,
        predictedOutcome: true,
      },
    });

    if (pendingLegs.length === 0) {
      return;
    }

    const affectedAccumulatorIds = new Set<string>();

    for (const leg of pendingLegs) {
      const isWin =
        leg.predictedOutcome.trim().toLowerCase() === finalOutcome.trim().toLowerCase();

      await tx.accumulatorLeg.updateMany({
        where: { id: leg.id, status: 'PENDING' },
        data: {
          status: isWin ? 'WON' : 'LOST',
          settledAt: now,
        },
      });

      affectedAccumulatorIds.add(leg.accumulatorId);
    }

    for (const accumulatorId of affectedAccumulatorIds) {
      const accumulator = await tx.accumulator.findUnique({
        where: { id: accumulatorId },
        include: { legs: true },
      });

      if (!accumulator || accumulator.status !== 'PENDING') {
        continue;
      }

      const hasLoss = accumulator.legs.some((leg) => leg.status === 'LOST');
      const hasPending = accumulator.legs.some((leg) => leg.status === 'PENDING');
      const allResolvedWithoutLoss = accumulator.legs.every(
        (leg) => leg.status === 'WON' || leg.status === 'REFUNDED'
      );

      if (hasLoss) {
        await tx.accumulator.updateMany({
          where: { id: accumulatorId, status: 'PENDING' },
          data: {
            status: 'LOST',
            payout: 0,
            settledAt: now,
          },
        });
        continue;
      }

      if (hasPending || !allResolvedWithoutLoss) {
        continue;
      }

      const payout = accumulator.potentialPayout;

      const wonUpdate = await tx.accumulator.updateMany({
        where: { id: accumulatorId, status: 'PENDING' },
        data: {
          status: 'WON',
          payout,
          settledAt: now,
        },
      });

      if (wonUpdate.count === 0) {
        continue;
      }

      await PointsLedgerService.credit(
        {
          userId: accumulator.userId,
          amount: payout,
          type: 'PREDICTION_WIN',
          referenceType: 'ACCUMULATOR',
          referenceId: accumulatorId,
          description: `Accumulator win (${accumulator.legs.length} legs, ${accumulator.combinedOdds.toString()}x odds)`,
        },
        tx
      );
    }
  },

  async cancelLegsForEvent(eventId: string, tx: Prisma.TransactionClient) {
    const now = new Date();

    const legs = await tx.accumulatorLeg.findMany({
      where: {
        eventId,
        status: 'PENDING',
      },
      select: {
        accumulatorId: true,
      },
    });

    if (legs.length === 0) {
      return;
    }

    const accumulatorIds = [...new Set(legs.map((leg) => leg.accumulatorId))];

    await tx.accumulatorLeg.updateMany({
      where: {
        eventId,
        status: 'PENDING',
      },
      data: {
        status: 'REFUNDED',
        settledAt: now,
      },
    });

    for (const accumulatorId of accumulatorIds) {
      const accumulator = await tx.accumulator.findUnique({
        where: { id: accumulatorId },
        include: { legs: true },
      });

      if (!accumulator || accumulator.status !== 'PENDING') {
        continue;
      }

      const activeLegs = accumulator.legs.filter((leg) => leg.status !== 'REFUNDED');
      const hasLoss = activeLegs.some((leg) => leg.status === 'LOST');

      if (hasLoss) {
        await tx.accumulator.updateMany({
          where: { id: accumulatorId, status: 'PENDING' },
          data: {
            status: 'LOST',
            payout: 0,
            settledAt: now,
          },
        });
        continue;
      }

      if (activeLegs.length === 0) {
        const cancelledUpdate = await tx.accumulator.updateMany({
          where: { id: accumulatorId, status: 'PENDING' },
          data: {
            status: 'CANCELLED',
            payout: 0,
            settledAt: now,
          },
        });

        if (cancelledUpdate.count === 0) {
          continue;
        }

        await LedgerService.credit(
          {
            userId: accumulator.userId,
            amount: accumulator.stakeAmount,
            type: 'PREDICTION_REFUND',
            referenceType: 'ACCUMULATOR',
            referenceId: accumulatorId,
            description: 'Accumulator refund (all events cancelled)',
          },
          tx
        );

        await TokenAllowanceService.syncToLedgerBalance(accumulator.userId, tx);
        continue;
      }

      const recalculatedOdds = Math.min(
        activeLegs.reduce((product, leg) => product * leg.odds.toNumber(), 1),
        MAX_COMBINED_ODDS
      );
      const newPotentialPayout = Math.floor(accumulator.stakeAmount * recalculatedOdds);
      const hasPending = activeLegs.some((leg) => leg.status === 'PENDING');
      const allWon = activeLegs.every((leg) => leg.status === 'WON');

      if (!hasPending && allWon) {
        const wonUpdate = await tx.accumulator.updateMany({
          where: { id: accumulatorId, status: 'PENDING' },
          data: {
            combinedOdds: new Prisma.Decimal(recalculatedOdds),
            potentialPayout: newPotentialPayout,
            status: 'WON',
            payout: newPotentialPayout,
            settledAt: now,
          },
        });

        if (wonUpdate.count === 0) {
          continue;
        }

        await PointsLedgerService.credit(
          {
            userId: accumulator.userId,
            amount: newPotentialPayout,
            type: 'PREDICTION_WIN',
            referenceType: 'ACCUMULATOR',
            referenceId: accumulatorId,
            description: `Accumulator win (${activeLegs.length} active legs after cancellations)`,
          },
          tx
        );

        continue;
      }

      await tx.accumulator.updateMany({
        where: { id: accumulatorId, status: 'PENDING' },
        data: {
          combinedOdds: new Prisma.Decimal(recalculatedOdds),
          potentialPayout: newPotentialPayout,
        },
      });
    }
  },

  async restoreCancelledLegsForEvent(
    eventId: string,
    tx: Prisma.TransactionClient
  ): Promise<{ restoredLegs: number; restoredAccumulators: number; affectedUserIds: string[] }> {
    const refundedLegs = await tx.accumulatorLeg.findMany({
      where: {
        eventId,
        status: 'REFUNDED',
      },
      select: {
        accumulatorId: true,
      },
    });

    if (refundedLegs.length === 0) {
      return { restoredLegs: 0, restoredAccumulators: 0, affectedUserIds: [] };
    }

    const accumulatorIds = [...new Set(refundedLegs.map((leg) => leg.accumulatorId))];
    const accumulators = await Promise.all(
      accumulatorIds.map((accumulatorId) =>
        tx.accumulator.findUnique({
          where: { id: accumulatorId },
          include: { legs: true },
        })
      )
    );

    for (const accumulator of accumulators) {
      if (!accumulator) {
        continue;
      }

      if (accumulator.status === 'WON') {
        throw AppError.badRequest(
          'Cannot uncancel this event because one or more accumulators were already marked as won after the cancellation'
        );
      }

      if (accumulator.status === 'CASHED_OUT') {
        throw AppError.badRequest(
          'Cannot uncancel this event because one or more related accumulators were already cashed out'
        );
      }
    }

    const restoreLegsResult = await tx.accumulatorLeg.updateMany({
      where: {
        eventId,
        status: 'REFUNDED',
      },
      data: {
        status: 'PENDING',
        settledAt: null,
      },
    });

    const affectedUserIds = new Set<string>();
    let restoredAccumulators = 0;

    for (const accumulator of accumulators) {
      if (!accumulator) {
        continue;
      }

      const recalculatedOdds = calculateActiveCombinedOdds(accumulator.legs, eventId);
      const newPotentialPayout = Math.floor(accumulator.stakeAmount * recalculatedOdds);

      if (accumulator.status === 'CANCELLED') {
        await LedgerService.debit(
          {
            userId: accumulator.userId,
            amount: accumulator.stakeAmount,
            type: 'PREDICTION_STAKE',
            referenceType: 'ACCUMULATOR',
            referenceId: accumulator.id,
            description: `Stake restored after uncancelling event ${eventId}`,
          },
          tx
        );

        await tx.accumulator.update({
          where: { id: accumulator.id },
          data: {
            combinedOdds: new Prisma.Decimal(recalculatedOdds),
            potentialPayout: newPotentialPayout,
            status: 'PENDING',
            payout: null,
            settledAt: null,
          },
        });

        affectedUserIds.add(accumulator.userId);
        restoredAccumulators++;
        continue;
      }

      if (accumulator.status === 'PENDING') {
        await tx.accumulator.update({
          where: { id: accumulator.id },
          data: {
            combinedOdds: new Prisma.Decimal(recalculatedOdds),
            potentialPayout: newPotentialPayout,
          },
        });
      }
    }

    return {
      restoredLegs: restoreLegsResult.count,
      restoredAccumulators,
      affectedUserIds: Array.from(affectedUserIds),
    };
  },
};

function calculateActiveCombinedOdds(
  legs: Array<{ eventId: string; status: string; odds: Prisma.Decimal }>,
  restoringEventId: string
): number {
  const activeLegs = legs.filter(
    (leg) => leg.status !== 'REFUNDED' || leg.eventId === restoringEventId
  );

  return Math.min(
    activeLegs.reduce((product, leg) => product * leg.odds.toNumber(), 1),
    MAX_COMBINED_ODDS
  );
}

function resolveLegOdds(
  event: {
    payoutMultiplier: number;
    currentOdds: Prisma.JsonValue | null;
  },
  canonicalOutcome: string
): number {
  const currentOdds = event.currentOdds;

  if (currentOdds && typeof currentOdds === 'object' && !Array.isArray(currentOdds)) {
    const outcomesCandidate = (currentOdds as { outcomes?: unknown }).outcomes;
    if (Array.isArray(outcomesCandidate)) {
      const normalizedOutcomes = outcomesCandidate
        .map((outcome) => {
          if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) {
            return null;
          }

          const parsed = outcome as { name?: unknown; price?: unknown };
          if (typeof parsed.name !== 'string' || typeof parsed.price !== 'number') {
            return null;
          }

          return { name: parsed.name, price: parsed.price };
        })
        .filter((outcome): outcome is { name: string; price: number } => outcome !== null);

      const matchedOutcome = findOddsOutcome(normalizedOutcomes, canonicalOutcome);
      if (matchedOutcome) {
        return matchedOutcome.price;
      }
    }
  }

  return event.payoutMultiplier;
}
