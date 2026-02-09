// =============================================================================
// PATCHED: SettlementWorker.runOnce()
// =============================================================================
// Changes:
// 1. Per-event try/catch so one failed settlement doesn't block others
// 2. Tracks which events failed and why
// 3. Logs errors instead of throwing on individual event failures
// =============================================================================

// Replace SettlementWorker in src/services/settlementWorker.ts with this:

import { prisma } from './database.js';
import { OddsApiService, type OddsScore } from './oddsApi.js';
import { EventService } from './events.js';

type SettlementStatus = {
  lastRunAt?: Date;
  lastError?: string;
  settledEvents?: number;
  failedEvents?: number;
  errors?: Array<{ eventId: string; error: string }>;
};

const status: SettlementStatus = {};

export const SettlementWorker = {
  getStatus() {
    return status;
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
        if (!event.externalSportKey) continue;
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
          // If we can't fetch scores for a sport, skip all events in that sport
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
          if (!event.externalEventId) continue;

          const score = scoresById.get(event.externalEventId);
          if (!score?.completed) continue;

          const outcome = determineOutcome(event.outcomes, score);
          if (!outcome) {
            console.warn(
              `[Settlement] Could not determine outcome for event ${event.id} (${event.title})`
            );
            continue;
          }

          // ---------------------------------------------------------------
          // Per-event try/catch: one failed settlement doesn't block others
          // ---------------------------------------------------------------
          try {
            await EventService.settle(event.id, outcome, 'system');
            settledEvents++;
            console.log(
              `[Settlement] Settled event ${event.id} (${event.title}) → ${outcome}`
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';

            // If event was already settled (idempotency), that's fine — just skip
            if (message.includes('already been settled') || message.includes('was cancelled')) {
              console.log(`[Settlement] Event ${event.id} already settled/cancelled, skipping`);
              continue;
            }

            console.error(`[Settlement] Failed to settle event ${event.id}:`, message);
            errors.push({ eventId: event.id, error: message });
            failedEvents++;
          }
        }
      }

      status.lastRunAt = new Date();
      status.lastError = failedEvents > 0 ? `${failedEvents} event(s) failed` : undefined;
      status.settledEvents = settledEvents;
      status.failedEvents = failedEvents;
      status.errors = errors.length > 0 ? errors : undefined;

      return { settledEvents, failedEvents };
    } catch (error) {
      status.lastRunAt = new Date();
      status.lastError = error instanceof Error ? error.message : 'Unknown error';
      status.settledEvents = 0;
      status.failedEvents = 0;
      throw error;
    }
  },
};

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

  const normalizedOutcomes = outcomes.map((outcome) => outcome.trim().toLowerCase());
  if (winnerName === 'draw') {
    const drawIndex = normalizedOutcomes.findIndex((outcome) => outcome.includes('draw'));
    return drawIndex >= 0 ? outcomes[drawIndex] ?? null : null;
  }

  const matchIndex = normalizedOutcomes.findIndex(
    (outcome) => outcome === winnerName!.trim().toLowerCase()
  );
  return matchIndex >= 0 ? outcomes[matchIndex] ?? null : null;
}
