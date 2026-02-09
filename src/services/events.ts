import { EventStatus, Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { LedgerService } from './ledger.js';
import { PointsLedgerService } from './pointsLedger.js';
import { AppError } from '../utils/index.js';
import type { SettlementResult } from '../types/index.js';
import type { NormalizedOdds } from './oddsApi.js';

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
    createdBy: string;
    externalEventId?: string;
    externalSportKey?: string;
  }) {
    if (data.outcomes.length < 2) {
      throw AppError.badRequest('Event must have at least 2 possible outcomes');
    }

    if (data.startsAt.getTime() <= Date.now()) {
      throw AppError.badRequest('Event start time must be in the future');
    }

    return prisma.event.create({
      data: {
        title: data.title,
        description: data.description,
        startsAt: data.startsAt,
        outcomes: data.outcomes,
        payoutMultiplier: data.payoutMultiplier ?? 2.0,
        createdBy: data.createdBy,
        status: 'OPEN',
        externalEventId: data.externalEventId,
        externalSportKey: data.externalSportKey,
      },
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
  } = {}) {
    const { status, limit = 20, offset = 0, upcoming } = options;

    const where: Prisma.EventWhereInput = {};
    
    if (status) {
      where.status = status;
    }
    
    if (upcoming) {
      where.startsAt = { gt: new Date() };
      where.status = 'OPEN';
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
    // Get event with all predictions
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        predictions: {
          where: { status: 'PENDING' },
          include: { user: true },
        },
      },
    });

    if (!event) {
      throw AppError.notFound('Event');
    }

    if (event.status === 'SETTLED') {
      throw new AppError('EVENT_ALREADY_SETTLED', 'Event has already been settled', 400);
    }

    if (event.status === 'CANCELLED') {
      throw new AppError('EVENT_ALREADY_SETTLED', 'Event was cancelled', 400);
    }

    // Validate outcome
    if (!event.outcomes.includes(finalOutcome)) {
      throw new AppError(
        'INVALID_OUTCOME',
        `Invalid outcome. Must be one of: ${event.outcomes.join(', ')}`,
        400
      );
    }

    // Execute settlement in a transaction
    const result = await prisma.$transaction(async (tx) => {
      let winners = 0;
      let losers = 0;
      let totalPayout = 0;

      // Process each prediction
      for (const prediction of event.predictions) {
        const isWinner = prediction.predictedOutcome === finalOutcome;

        if (isWinner) {
          const odds = prediction.originalOdds?.toNumber() ?? event.payoutMultiplier;
          const payout = calculatePayout(prediction.stakeAmount, odds);

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

          // Update prediction
          await tx.prediction.update({
            where: { id: prediction.id },
            data: {
              status: 'WON',
              payout,
              settledAt: new Date(),
            },
          });

          winners++;
          totalPayout += payout;
        } else {
          // Mark as lost (tokens already deducted at stake time)
          await tx.prediction.update({
            where: { id: prediction.id },
            data: {
              status: 'LOST',
              payout: 0,
              settledAt: new Date(),
            },
          });

          losers++;
        }
      }

      // Update event
      await tx.event.update({
        where: { id: eventId },
        data: {
          status: 'SETTLED',
          finalOutcome,
          settledBy,
          settledAt: new Date(),
        },
      });

      return {
        eventId,
        finalOutcome,
        totalPredictions: event.predictions.length,
        winners,
        losers,
        totalPayout,
        settledAt: new Date(),
      };
    });

    return result;
  },

  /**
   * Cancel an event and refund all stakes.
   */
  async cancel(eventId: string, cancelledBy: string): Promise<{ refunded: number }> {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        predictions: {
          where: { status: 'PENDING' },
        },
      },
    });

    if (!event) {
      throw AppError.notFound('Event');
    }

    if (event.status === 'SETTLED') {
      throw new AppError('EVENT_ALREADY_SETTLED', 'Cannot cancel a settled event', 400);
    }

    if (event.status === 'CANCELLED') {
      throw new AppError('EVENT_ALREADY_SETTLED', 'Event is already cancelled', 400);
    }

    // Execute cancellation in a transaction
    const result = await prisma.$transaction(async (tx) => {
      let refunded = 0;

      // Refund all pending predictions
      for (const prediction of event.predictions) {
        // Refund stake
        await LedgerService.refundPrediction(
          prediction.userId,
          prediction.stakeAmount,
          prediction.id,
          tx
        );

        // Update prediction status
        await tx.prediction.update({
          where: { id: prediction.id },
          data: {
            status: 'REFUNDED',
            settledAt: new Date(),
          },
        });

        refunded++;
      }

      // Update event
      await tx.event.update({
        where: { id: eventId },
        data: {
          status: 'CANCELLED',
          settledBy: cancelledBy,
          settledAt: new Date(),
        },
      });

      return { refunded };
    });

    return result;
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

function calculatePayout(stakeAmount: number, odds: number): number {
  return Math.floor(stakeAmount * odds);
}
