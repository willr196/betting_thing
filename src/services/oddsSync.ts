import { Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { OddsApiService } from './oddsApi.js';
import { logger } from '../logger.js';
import { config } from '../config/index.js';

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
        if (OddsApiService.shouldPauseNonEssentialPolling()) {
          const quota = OddsApiService.getQuotaStatus();
          logger.warn(
            { remainingRequests: quota.remainingRequests, monthlyQuota: quota.monthlyQuota },
            '[OddsSync] Skipping sync - quota below 10%'
          );
          statusStore.update({
            lastRunAt: new Date(),
            lastError: undefined,
            updatedEvents: 0,
          });
          return { updatedEvents: 0 };
        }

        let updatedEvents = 0;
        const now = new Date();
        const lookaheadEnd = new Date(
          now.getTime() + config.oddsApi.syncLookaheadHours * 60 * 60 * 1000
        );
        const eligibleEvents = await prisma.event.findMany({
          where: {
            status: { in: ['OPEN', 'LOCKED'] },
            externalSportKey: { not: null },
            externalEventId: { not: null },
            startsAt: {
              gte: now,
              lte: lookaheadEnd,
            },
          },
        });

        if (eligibleEvents.length === 0) {
          logger.info('[OddsSync] No active mapped events in lookahead window, skipping');
          statusStore.update({
            lastRunAt: new Date(),
            lastError: undefined,
            updatedEvents: 0,
          });
          return { updatedEvents: 0 };
        }

        const eventsBySport = new Map<string, typeof eligibleEvents>();
        for (const event of eligibleEvents) {
          if (!event.externalSportKey) {
            continue;
          }
          const list = eventsBySport.get(event.externalSportKey) ?? [];
          list.push(event);
          eventsBySport.set(event.externalSportKey, list);
        }

        for (const [sportKey, events] of eventsBySport.entries()) {
          const odds = await OddsApiService.getOddsForSport(sportKey);
          const oddsByEvent = new Map(odds.map((item) => [item.id, item]));

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
            { sportKey, updatedForSport, eligibleEvents: events.length },
            '[OddsSync] Completed sport sync cycle'
          );
        }

        const quota = OddsApiService.getQuotaStatus();
        logger.info(
          {
            remainingRequests: quota.remainingRequests,
            remainingPercent: quota.remainingPercent,
            monthlyQuota: quota.monthlyQuota,
          },
          '[OddsSync] Quota status after sync'
        );

        statusStore.update({
          lastRunAt: new Date(),
          lastError: undefined,
          updatedEvents,
        });

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
