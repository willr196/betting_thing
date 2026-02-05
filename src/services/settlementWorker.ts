import { prisma } from './database.js';
import { OddsApiService, type OddsScore } from './oddsApi.js';
import { EventService } from './events.js';

type SettlementStatus = {
  lastRunAt?: Date;
  lastError?: string;
  settledEvents?: number;
};

const status: SettlementStatus = {};

export const SettlementWorker = {
  getStatus() {
    return status;
  },

  async runOnce(): Promise<{ settledEvents: number }> {
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

      for (const [sportKey, events] of eventsBySport.entries()) {
        const scores = await OddsApiService.getScores(sportKey);
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
            continue;
          }

          await EventService.settle(event.id, outcome, 'system');
          settledEvents++;
        }
      }

      status.lastRunAt = new Date();
      status.lastError = undefined;
      status.settledEvents = settledEvents;

      return { settledEvents };
    } catch (error) {
      status.lastRunAt = new Date();
      status.lastError = error instanceof Error ? error.message : 'Unknown error';
      status.settledEvents = 0;
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

  const normalizedWinner = winnerName.toLowerCase();

  // Prefer exact match first
  let winnerIndex = normalizedOutcomes.findIndex(
    (outcome) => outcome === normalizedWinner
  );

  // Fallback: check if outcome contains the winner name (e.g. "Team A Wins" contains "team a")
  if (winnerIndex < 0) {
    winnerIndex = normalizedOutcomes.findIndex(
      (outcome) => outcome.includes(normalizedWinner)
    );
  }

  return winnerIndex >= 0 ? outcomes[winnerIndex] ?? null : null;
}
