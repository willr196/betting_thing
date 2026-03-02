import { app } from './app.js';
import { config } from './config/index.js';
import { connectDatabase, disconnectDatabase } from './services/database.js';
import { OddsSyncService } from './services/oddsSync.js';
import { SettlementWorker } from './services/settlementWorker.js';
import { EventImportService } from './services/eventImport.js';
import { EventService } from './services/events.js';
import { logger } from './logger.js';

// =============================================================================
// SERVER STARTUP
// =============================================================================

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
    let autoLockInterval: ReturnType<typeof setInterval> | undefined;
    let eventImportInterval: ReturnType<typeof setInterval> | undefined;

    if (!config.isTest) {
      // Run initial event import on startup (non-blocking)
      EventImportService.runOnce().catch((error) => {
        logger.error({ err: error }, 'Initial event import failed');
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
        } catch (error) {
          logger.error({ err: error }, 'Settlement worker failed');
        }
      }, config.oddsApi.settlementIntervalSeconds * 1000);

      // Auto-lock events that have started (check every minute)
      autoLockInterval = setInterval(async () => {
        try {
          const count = await EventService.autoLockStartedEvents();
          if (count > 0) {
            logger.info({ count }, 'Auto-locked started events');
          }
        } catch (error) {
          logger.error({ err: error }, 'Auto-lock failed');
        }
      }, 60_000);

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
      if (autoLockInterval) clearInterval(autoLockInterval);
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
