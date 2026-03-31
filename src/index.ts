import { app } from './app.js';
import { config } from './config/index.js';
import { connectDatabase, disconnectDatabase, prisma } from './services/database.js';
import { OddsSyncService } from './services/oddsSync.js';
import { SettlementWorker } from './services/settlementWorker.js';
import { EventImportService } from './services/eventImport.js';
import { EventService } from './services/events.js';
import { OddsApiService } from './services/oddsApi.js';
import { LeagueStandingsService } from './services/leagueStandings.js';
import { logger } from './logger.js';

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function runStartupAutoImport() {
  const openEvents = await prisma.event.count({
    where: { status: 'OPEN' },
  });

  if (openEvents >= 5) {
    logger.info({ openEvents }, '[Startup] Skipping auto-import, sufficient OPEN events');
    return;
  }

  if (OddsApiService.shouldPauseNonEssentialPolling()) {
    const quota = OddsApiService.getQuotaStatus();
    logger.warn(
      {
        openEvents,
        remainingRequests: quota.remainingRequests,
        monthlyQuota: quota.monthlyQuota,
      },
      '[Startup] Skipping auto-import due to low quota'
    );
    return;
  }

  const sports = config.oddsApi.autoImportSports;
  const importResult = await EventImportService.runOnce(sports);

  logger.info(
    { openEvents, sports, ...importResult },
    '[Startup] Auto-imported events'
  );
}

async function start(): Promise<void> {
  try {
    // Connect to database
    await connectDatabase();

    // Start HTTP server
    const server = app.listen(config.server.port, () => {
      logger.info(
        { port: config.server.port, mode: config.isDev ? 'development' : 'production' },
        'Prediction Platform API started'
      );
    });

    let oddsSyncInterval: ReturnType<typeof setInterval> | undefined;
    let settlementInterval: ReturnType<typeof setInterval> | undefined;
    let eventImportInterval: ReturnType<typeof setInterval> | undefined;
    let lastLeagueFullRecalcAt = new Date(0);

    if (!config.isTest) {
      // Auto-lock and cleanup lifecycle on startup.
      EventService.autoLockStartedEvents().then((locked) => {
        if (locked > 0) {
          logger.info({ locked }, '[Startup] Auto-locked started events');
        }
      }).catch((error) => {
        logger.error({ err: error }, '[Startup] Auto-lock failed');
      });

      EventService.cleanupStaleUnpredictedEvents('system').then((cancelled) => {
        if (cancelled > 0) {
          logger.info(
            { cancelled },
            '[Startup] Cancelled stale events with no predictions'
          );
        }
      }).catch((error) => {
        logger.error({ err: error }, '[Startup] Stale-event cleanup failed');
      });

      EventService.deleteOldFinishedEvents().then((deleted) => {
        if (deleted > 0) {
          logger.info({ deleted }, '[Startup] Deleted old finished events (>1 day)');
        }
      }).catch((error) => {
        logger.error({ err: error }, '[Startup] Old-event deletion failed');
      });

      // Auto-import on startup only when OPEN inventory is low and quota allows.
      runStartupAutoImport().catch((error) => {
        logger.error({ err: error }, 'Startup auto-import failed');
      });

      oddsSyncInterval = setInterval(async () => {
        try {
          await OddsSyncService.runOnce();
        } catch (error) {
          logger.error({ err: error }, 'Odds sync failed');
        }
      }, config.oddsApi.syncIntervalSeconds * 1000);

      settlementInterval = setInterval(async () => {
        try {
          await SettlementWorker.runOnce();

          const dayMs = 24 * 60 * 60 * 1000;
          if (Date.now() - lastLeagueFullRecalcAt.getTime() > dayMs) {
            const result = await LeagueStandingsService.recalculateAll();
            lastLeagueFullRecalcAt = new Date();
            if (result.recalculatedLeagues > 0) {
              logger.info(
                { leagues: result.recalculatedLeagues },
                '[Leagues] Daily full standings recalculation complete'
              );
            }
          }
        } catch (error) {
          logger.error({ err: error }, 'Settlement worker failed');
        }
      }, config.oddsApi.settlementIntervalSeconds * 1000);

      // Re-import events from The Odds API on a configurable interval (default 6h)
      eventImportInterval = setInterval(async () => {
        try {
          await EventImportService.runOnce();
        } catch (error) {
          logger.error({ err: error }, 'Scheduled event import failed');
        }
      }, config.oddsApi.importIntervalSeconds * 1000);
    }

    // Graceful shutdown handling
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received signal, starting graceful shutdown');

      if (oddsSyncInterval) clearInterval(oddsSyncInterval);
      if (settlementInterval) clearInterval(settlementInterval);
      if (eventImportInterval) clearInterval(eventImportInterval);

      server.close(async () => {
        logger.info('HTTP server closed');

        await disconnectDatabase();

        logger.info('Shutdown complete');
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled promise rejection');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'Uncaught exception');
  process.exit(1);
});

// Start the server
start();
