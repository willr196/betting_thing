import { prisma } from './database.js';
import { OddsApiService, type OddsScore } from './oddsApi.js';
import { EventService } from './events.js';
import { matchOutcomeByName, normalizeOutcome } from './outcomes.js';
import { AppError } from '../utils/index.js';

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

export function createSettlementWorker(
  statusStore: StatusStore<SettlementStatus> = createInMemoryStatus<SettlementStatus>({})
) {
  return {
    getStatus() {
      return statusStore.get();
    },

    async runOnce(): Promise<{ settledEvents: number; failedEvents: number }> {
      try {
        const pendingEvents = await prisma.event.findMany({
          where: {
            status: 'LOCKED',
            externalSportKey: { not: null },
            externalEventId: { not: null },
          },
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
            console.error(`[Settlement] Failed to fetch scores for ${sportKey}:`, message);
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
              console.warn(
                `[Settlement] Could not determine outcome for event ${event.id} (${event.title})`
              );
              continue;
            }

            try {
              await EventService.settle(event.id, outcome, 'system');
              settledEvents++;
              console.log(
                `[Settlement] Settled event ${event.id} (${event.title}) -> ${outcome}`
              );
            } catch (error) {
              // Idempotency: if event was already settled/cancelled, skip.
              if (error instanceof AppError && error.code === 'EVENT_ALREADY_SETTLED') {
                console.log(
                  `[Settlement] Event ${event.id} already settled/cancelled, skipping`
                );
                continue;
              }

              const message = error instanceof Error ? error.message : 'Unknown error';
              console.error(`[Settlement] Failed to settle event ${event.id}:`, message);
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
      }
    },
  };
}

export const SettlementWorker = createSettlementWorker();

function determineOutcome(outcomes: string[], score: OddsScore): string | null {
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

  return matchOutcomeByName(outcomes, winnerName);
}
