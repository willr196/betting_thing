import { app } from './app.js';
import { config } from './config/index.js';
import { connectDatabase, disconnectDatabase } from './services/database.js';
import { OddsSyncService } from './services/oddsSync.js';
import { SettlementWorker } from './services/settlementWorker.js';

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function start(): Promise<void> {
  try {
    // Connect to database
    await connectDatabase();

    // Start HTTP server
    const server = app.listen(config.server.port, () => {
      console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎯 Prediction Platform API                              ║
║                                                           ║
║   Server:  http://localhost:${config.server.port}                       ║
║   Health:  http://localhost:${config.server.port}/api/health            ║
║   Mode:    ${config.isDev ? 'Development' : 'Production'}                                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
      `);
    });

    let oddsSyncInterval: ReturnType<typeof setInterval> | undefined;
    let settlementInterval: ReturnType<typeof setInterval> | undefined;

    if (!config.isTest) {
      oddsSyncInterval = setInterval(async () => {
        try {
          await OddsSyncService.runOnce();
        } catch (error) {
          console.error('Odds sync failed:', error);
        }
      }, config.oddsApi.syncIntervalSeconds * 1000);

      settlementInterval = setInterval(async () => {
        try {
          await SettlementWorker.runOnce();
        } catch (error) {
          console.error('Settlement worker failed:', error);
        }
      }, config.oddsApi.settlementIntervalSeconds * 1000);
    }

    // Graceful shutdown handling
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received. Starting graceful shutdown...`);

      if (oddsSyncInterval) clearInterval(oddsSyncInterval);
      if (settlementInterval) clearInterval(settlementInterval);

      server.close(async () => {
        console.log('HTTP server closed');

        await disconnectDatabase();
        
        console.log('Shutdown complete');
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the server
start();
