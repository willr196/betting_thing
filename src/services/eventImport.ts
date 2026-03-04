import { Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { OddsApiService } from './oddsApi.js';
import { logger } from '../logger.js';

// =============================================================================
// EVENT IMPORT SERVICE
// =============================================================================
// Imports upcoming events from The Odds API and upserts them into the DB.
// New events are created; existing events (matched by externalEventId) have
// their odds refreshed.

const ALL_SPORTS = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_uefa_champs_league',
] as const;

const SPORT_NAMES: Record<string, string> = {
  soccer_epl: 'Premier League',
  soccer_spain_la_liga: 'La Liga',
  soccer_italy_serie_a: 'Serie A',
  soccer_germany_bundesliga: 'Bundesliga',
  soccer_france_ligue_one: 'Ligue 1',
  soccer_uefa_champs_league: 'Champions League',
};

type ImportStatus = {
  lastRunAt?: Date;
  lastError?: string;
  imported?: number;
  updated?: number;
  skipped?: number;
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
    set: (next) => { current = { ...next }; },
    update: (partial) => { current = { ...current, ...partial }; },
  };
}

export function createEventImportService(
  statusStore: StatusStore<ImportStatus> = createInMemoryStatus<ImportStatus>({})
) {
  let isRunning = false;

  return {
    getStatus() {
      return statusStore.get();
    },

    async runOnce(
      sports: string[] = [...ALL_SPORTS]
    ): Promise<{ imported: number; updated: number; skipped: number }> {
      if (isRunning) {
        logger.debug('[EventImport] Previous run still in progress, skipping');
        return { imported: 0, updated: 0, skipped: 0 };
      }

      if (OddsApiService.shouldPauseNonEssentialPolling()) {
        const quota = OddsApiService.getQuotaStatus();
        logger.warn(
          {
            remainingRequests: quota.remainingRequests,
            monthlyQuota: quota.monthlyQuota,
          },
          '[EventImport] Skipping import - quota below 10%'
        );
        return { imported: 0, updated: 0, skipped: 0 };
      }

      isRunning = true;

      let totalImported = 0;
      let totalUpdated = 0;
      let totalSkipped = 0;

      try {
        for (const sportKey of sports) {
          let apiEvents: Awaited<ReturnType<typeof OddsApiService.getOddsForSport>>;
          try {
            apiEvents = await OddsApiService.getOddsForSport(sportKey);
          } catch (error) {
            logger.error({ sportKey, err: error }, '[EventImport] Failed to fetch odds for sport');
            continue;
          }

          for (const apiEvent of apiEvents) {
            const startsAt = new Date(apiEvent.commence_time);
            if (startsAt.getTime() <= Date.now()) {
              totalSkipped++;
              continue;
            }

            const outcomes = apiEvent.bookmakers?.[0]?.markets?.[0]?.outcomes ?? [];

            const existing = await prisma.event.findFirst({
              where: { externalEventId: apiEvent.id },
            });

            if (existing) {
              // Update odds on existing event if we have outcome data
              if (outcomes.length > 0) {
                await prisma.event.update({
                  where: { id: existing.id },
                  data: {
                    currentOdds: {
                      outcomes,
                      updatedAt: new Date().toISOString(),
                    } as unknown as Prisma.InputJsonValue,
                    oddsUpdatedAt: new Date(),
                  },
                });
                totalUpdated++;
              } else {
                totalSkipped++;
              }
              continue;
            }

            if (outcomes.length < 2) {
              totalSkipped++;
              continue;
            }

            const outcomeNames = outcomes.map((o) => o.name);
            const title =
              apiEvent.home_team && apiEvent.away_team
                ? `${apiEvent.home_team} vs ${apiEvent.away_team}`
                : outcomeNames.filter((n) => n.toLowerCase() !== 'draw').join(' vs ');

            await prisma.event.create({
              data: {
                title,
                description: SPORT_NAMES[sportKey] ?? sportKey,
                startsAt,
                outcomes: outcomeNames,
                payoutMultiplier: 2.0,
                status: 'OPEN',
                externalEventId: apiEvent.id,
                externalSportKey: sportKey,
                currentOdds: {
                  outcomes,
                  updatedAt: new Date().toISOString(),
                } as unknown as Prisma.InputJsonValue,
                oddsUpdatedAt: new Date(),
              },
            });

            logger.info({ title, sportKey }, '[EventImport] Created event');
            totalImported++;
          }
        }

        statusStore.update({
          lastRunAt: new Date(),
          lastError: undefined,
          imported: totalImported,
          updated: totalUpdated,
          skipped: totalSkipped,
        });

        logger.info(
          { imported: totalImported, updated: totalUpdated, skipped: totalSkipped },
          '[EventImport] Completed'
        );

        return { imported: totalImported, updated: totalUpdated, skipped: totalSkipped };
      } catch (error) {
        statusStore.update({
          lastRunAt: new Date(),
          lastError: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      } finally {
        isRunning = false;
      }
    },
  };
}

export const EventImportService = createEventImportService();
