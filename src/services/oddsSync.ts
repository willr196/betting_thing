import { Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { OddsApiService } from './oddsApi.js';

type SyncStatus = {
  lastRunAt?: Date;
  lastError?: string;
  updatedEvents?: number;
};

const status: SyncStatus = {};

export const OddsSyncService = {
  getStatus() {
    return status;
  },

  async runOnce(): Promise<{ updatedEvents: number }> {
    try {
      const activeSportKeys = await prisma.event.findMany({
        where: {
          status: { in: ['OPEN', 'LOCKED'] },
          externalSportKey: { not: null },
          externalEventId: { not: null },
        },
        select: {
          externalSportKey: true,
        },
        distinct: ['externalSportKey'],
      });

      let updatedEvents = 0;

      for (const entry of activeSportKeys) {
        if (!entry.externalSportKey) {
          continue;
        }

        const odds = await OddsApiService.getOddsForSport(entry.externalSportKey);
        const oddsByEvent = new Map(odds.map((item) => [item.id, item]));

        const events = await prisma.event.findMany({
          where: {
            status: { in: ['OPEN', 'LOCKED'] },
            externalSportKey: entry.externalSportKey,
            externalEventId: { not: null },
          },
        });

        for (const event of events) {
          if (!event.externalEventId) {
            continue;
          }

          const match = oddsByEvent.get(event.externalEventId);
          const outcomes = match?.bookmakers?.[0]?.markets?.[0]?.outcomes ?? [];
          if (!match || outcomes.length === 0) {
            continue;
          }

          await prisma.event.update({
            where: { id: event.id },
            data: {
              currentOdds: {
                outcomes,
                updatedAt: new Date().toISOString(),
              } as unknown as Prisma.InputJsonValue,
              oddsUpdatedAt: new Date(),
            },
          });

          updatedEvents++;
        }
      }

      status.lastRunAt = new Date();
      status.lastError = undefined;
      status.updatedEvents = updatedEvents;

      return { updatedEvents };
    } catch (error) {
      status.lastRunAt = new Date();
      status.lastError = error instanceof Error ? error.message : 'Unknown error';
      status.updatedEvents = 0;
      throw error;
    }
  },
};
