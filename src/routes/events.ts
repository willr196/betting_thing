import { Router } from 'express';
import { z } from 'zod';
import { EventService } from '../services/events.js';
import { PredictionService } from '../services/predictions.js';
import { optionalAuth, validateQuery, validateParams, idParamSchema } from '../middleware/index.js';
import { asyncHandler, parseLimitOffset, sendSuccess } from '../utils/index.js';
import { OddsApiService } from '../services/oddsApi.js';

const router = Router();

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const listEventsSchema = z.object({
  status: z.enum(['OPEN', 'LOCKED', 'SETTLED', 'CANCELLED']).optional(),
  upcoming: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// ROUTES
// =============================================================================

/**
 * GET /events
 * List events with optional filters.
 */
router.get(
  '/',
  optionalAuth,
  validateQuery(listEventsSchema),
  asyncHandler(async (req, res) => {
    const { status, upcoming, limit, offset } = req.query as unknown as z.infer<typeof listEventsSchema>;

    const result = await EventService.list({
      status,
      upcoming,
      limit,
      offset,
    });

    sendSuccess(res, result);
  })
);

/**
 * GET /events/upcoming
 * Convenience route for upcoming open events.
 */
router.get(
  '/upcoming',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { limit } = parseLimitOffset(req.query as Record<string, unknown>, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const result = await EventService.list({
      upcoming: true,
      limit,
    });

    sendSuccess(res, result);
  })
);

/**
 * GET /events/:id
 * Get a single event by ID.
 */
router.get(
  '/:id',
  optionalAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const event = await EventService.getById(req.params.id as string);
    sendSuccess(res, { event });
  })
);

/**
 * GET /events/:id/stats
 * Get prediction statistics for an event.
 */
router.get(
  '/:id/stats',
  optionalAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const stats = await PredictionService.getEventStats(req.params.id as string);
    sendSuccess(res, { stats });
  })
);

/**
 * GET /events/:id/odds
 * Get live odds for an event and cache them.
 */
router.get(
  '/:id/odds',
  optionalAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const event = await EventService.getById(req.params.id as string);
    if (!event.externalEventId || !event.externalSportKey) {
      return sendSuccess(res, { odds: null });
    }

    const odds = await OddsApiService.getEventOdds(
      event.externalSportKey,
      event.externalEventId
    );

    if (odds) {
      await EventService.updateOdds(event.id, odds);
    }

    sendSuccess(res, { odds });
  })
);

export default router;
