import { prisma } from './database.js';
import { OddsApiService, type OddsScore } from './oddsApi.js';
import { EventService } from './events.js';
import { matchOutcomeByName, matchOutcomeExact, normalizeOutcome } from './outcomes.js';
import { AppError } from '../utils/index.js';
import { logger } from '../logger.js';

type SettlementStatus = {
  lastRunAt?: Date;
  lastError?: string;
  settledEvents?: number;
  failedEvents?: number;
  errors?: Array<{ eventId: string; error: string }>;
};

type StatusStore<T> = {
  get(): T;
  set(next: T): void;
  update(partial: Partial<T>): void;
};

function createInMemoryStatus<T extends object>(initial: T): StatusStore<T> {
  let current = { ...initial };
  return {
    get: () => current,
    set: (next) => {
      current = { ...next };
    },
    update: (partial) => {
      current = { ...current, ...partial };
    },
  };
}

const SETTLEMENT_BATCH_SIZE = 100;

export function createSettlementWorker(
  statusStore: StatusStore<SettlementStatus> = createInMemoryStatus<SettlementStatus>({})
) {
  let isRunning = false;

  return {
    getStatus() {
      return statusStore.get();
    },

    async runOnce(): Promise<{ settledEvents: number; failedEvents: number }> {
      // Prevent overlapping runs if the previous one is still in progress
      if (isRunning) {
        logger.debug('[Settlement] Previous run still in progress, skipping');
        return { settledEvents: 0, failedEvents: 0 };
      }
      isRunning = true;

      try {
        const pendingEvents = await prisma.event.findMany({
          where: {
            status: 'LOCKED',
            externalSportKey: { not: null },
            externalEventId: { not: null },
          },
          // Bound the batch size to avoid unbounded transactions and API load
          take: SETTLEMENT_BATCH_SIZE,
        });

        const eventsBySport = new Map<string, typeof pendingEvents>();
        for (const event of pendingEvents) {
          if (!event.externalSportKey) {
            continue;
          }
          const existing = eventsBySport.get(event.externalSportKey) ?? [];
          existing.push(event);
          eventsBySport.set(event.externalSportKey, existing);
        }

        let settledEvents = 0;
        let failedEvents = 0;
        const errors: Array<{ eventId: string; error: string }> = [];

        for (const [sportKey, events] of eventsBySport.entries()) {
          let scores: OddsScore[];
          try {
            scores = await OddsApiService.getScores(sportKey);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ sportKey, err: error }, '[Settlement] Failed to fetch scores');
            for (const event of events) {
              errors.push({ eventId: event.id, error: `Score fetch failed: ${message}` });
              failedEvents++;
            }
            continue;
          }
          const scoresById = new Map(scores.map((score) => [score.id, score]));

          for (const event of events) {
            if (!event.externalEventId) {
              continue;
            }

            const score = scoresById.get(event.externalEventId);
            if (!score?.completed) {
              continue;
            }

            const outcome = determineOutcome(event.outcomes, score);
            if (!outcome) {
              logger.warn(
                { eventId: event.id, title: event.title },
                '[Settlement] Could not determine outcome for event'
              );
              continue;
            }

            try {
              await EventService.settle(event.id, outcome, 'system');
              settledEvents++;
              logger.info(
                { eventId: event.id, title: event.title, outcome },
                '[Settlement] Event settled'
              );
            } catch (error) {
              // Idempotency: if event was already settled/cancelled, skip.
              if (error instanceof AppError && error.code === 'EVENT_ALREADY_SETTLED') {
                logger.debug(
                  { eventId: event.id },
                  '[Settlement] Event already settled/cancelled, skipping'
                );
                continue;
              }

              const message = error instanceof Error ? error.message : 'Unknown error';
              logger.error({ eventId: event.id, err: error }, '[Settlement] Failed to settle event');
              errors.push({ eventId: event.id, error: message });
              failedEvents++;
            }
          }
        }

        statusStore.update({
          lastRunAt: new Date(),
          lastError: failedEvents > 0 ? `${failedEvents} event(s) failed` : undefined,
          settledEvents,
          failedEvents,
          errors: errors.length > 0 ? errors : undefined,
        });

        return { settledEvents, failedEvents };
      } catch (error) {
        statusStore.update({
          lastRunAt: new Date(),
          lastError: error instanceof Error ? error.message : 'Unknown error',
          settledEvents: 0,
          failedEvents: 0,
          errors: undefined,
        });
        throw error;
      } finally {
        isRunning = false;
      }
    },
  };
}

export const SettlementWorker = createSettlementWorker();

export function determineOutcome(outcomes: string[], score: OddsScore): string | null {
  if (!score.scores || score.scores.length < 2) {
    return null;
  }

  const parsedScores = score.scores.map((entry) => ({
    name: entry.name,
    score: Number(entry.score),
  }));

  if (parsedScores.some((entry) => Number.isNaN(entry.score))) {
    return null;
  }

  const [first, second] = parsedScores;
  if (!first || !second) {
    return null;
  }

  let winnerName: string | null = null;
  if (first.score === second.score) {
    winnerName = 'draw';
  } else {
    winnerName = first.score > second.score ? first.name : second.name;
  }

  if (winnerName === 'draw') {
    const drawOutcome = outcomes.find((outcome) =>
      normalizeOutcome(outcome).includes('draw')
    );
    return drawOutcome ?? null;
  }

  // Try exact (normalised) match first.
  const exactMatch = matchOutcomeExact(outcomes, winnerName);
  if (exactMatch) {
    return exactMatch;
  }

  // Fall back to fuzzy contains-match and log so we can detect misfires.
  const fuzzyMatch = matchOutcomeByName(outcomes, winnerName);
  if (fuzzyMatch) {
    logger.warn(
      { winnerName, matchedOutcome: fuzzyMatch, eventOutcomes: outcomes },
      `Settlement: using fuzzy outcome match for winner "${winnerName}" → "${fuzzyMatch}"`
    );
    return fuzzyMatch;
  }

  logger.error(
    { winnerName, eventOutcomes: outcomes },
    `Settlement: could not match winner "${winnerName}" to any outcome: [${outcomes.join(', ')}]`
  );
  return null;
}
