import { Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { OddsApiService } from './oddsApi.js';
import { logger } from '../logger.js';

const ALLOWED_SPORT_KEYS = ['soccer_epl'];

type SyncStatus = {
  lastRunAt?: Date;
  lastError?: string;
  updatedEvents?: number;
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

export function createOddsSyncService(
  statusStore: StatusStore<SyncStatus> = createInMemoryStatus<SyncStatus>({})
) {
  let isRunning = false;

  return {
    getStatus() {
      return statusStore.get();
    },

    async runOnce(): Promise<{ updatedEvents: number }> {
      if (isRunning) {
        logger.debug('[OddsSync] Previous run still in progress, skipping');
        return { updatedEvents: 0 };
      }
      isRunning = true;

      try {
        let updatedEvents = 0;

        for (const sportKey of ALLOWED_SPORT_KEYS) {
          const activeEventsCount = await prisma.event.count({
            where: {
              status: { in: ['OPEN', 'LOCKED'] },
              externalSportKey: sportKey,
              externalEventId: { not: null },
            },
          });

          if (activeEventsCount === 0) {
            logger.info({ sportKey }, '[OddsSync] No active events for sport key, skipping');
            continue;
          }

          const odds = await OddsApiService.getOddsForSport(sportKey);
          const oddsByEvent = new Map(odds.map((item) => [item.id, item]));

          const events = await prisma.event.findMany({
            where: {
              status: { in: ['OPEN', 'LOCKED'] },
              externalSportKey: sportKey,
              externalEventId: { not: null },
            },
          });

          let updatedForSport = 0;
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
            updatedForSport++;
          }

          logger.info(
            { sportKey, updatedForSport, activeEventsCount },
            '[OddsSync] Completed sport sync cycle'
          );
        }

        statusStore.update({
          lastRunAt: new Date(),
          lastError: undefined,
          updatedEvents,
        });

        console.log(`[OddsSync] Updated ${updatedEvents} events this cycle`);

        return { updatedEvents };
      } catch (error) {
        statusStore.update({
          lastRunAt: new Date(),
          lastError: error instanceof Error ? error.message : 'Unknown error',
          updatedEvents: 0,
        });
        throw error;
      } finally {
        isRunning = false;
      }
    },
  };
}

export const OddsSyncService = createOddsSyncService();
