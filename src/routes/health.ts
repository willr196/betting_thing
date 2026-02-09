import { Router } from 'express';
import { isDatabaseHealthy } from '../services/database.js';
import { asyncHandler, sendSuccess } from '../utils/index.js';

const router = Router();

/**
 * GET /health
 * Health check endpoint for monitoring.
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const dbHealthy = await isDatabaseHealthy();

    const health = {
      status: dbHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: dbHealthy ? 'ok' : 'error',
      },
    };

    const statusCode = dbHealthy ? 200 : 503;
    sendSuccess(res, health, statusCode);
  })
);

/**
 * GET /health/ready
 * Readiness check - is the service ready to accept traffic?
 */
router.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const dbHealthy = await isDatabaseHealthy();

    if (dbHealthy) {
      sendSuccess(res, { ready: true });
    } else {
      res.status(503).json({ success: false, ready: false });
    }
  })
);

/**
 * GET /health/live
 * Liveness check - is the service alive?
 */
router.get('/live', (_req, res) => {
  sendSuccess(res, { live: true });
});

export default router;
