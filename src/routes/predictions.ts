import { Router } from 'express';
import { z } from 'zod';
import { PredictionService } from '../services/predictions.js';
import { requireAuth, validateBody, validateQuery, validateParams, getAuthUser, idParamSchema, positiveIntSchema } from '../middleware/index.js';
import { asyncHandler, sendSuccess } from '../utils/index.js';

const router = Router();

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const placePredictionSchema = z.object({
  eventId: z.string().min(1, 'Event ID is required'),
  predictedOutcome: z.string().min(1, 'Predicted outcome is required'),
  stakeAmount: positiveIntSchema,
});

const listPredictionsSchema = z.object({
  status: z.enum(['PENDING', 'WON', 'LOST', 'REFUNDED', 'CASHED_OUT']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// ROUTES
// =============================================================================

/**
 * POST /predictions
 * Place a new prediction on an event.
 */
router.post(
  '/',
  requireAuth,
  validateBody(placePredictionSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { eventId, predictedOutcome, stakeAmount } = req.body;

    const prediction = await PredictionService.place({
      userId,
      eventId,
      predictedOutcome,
      stakeAmount,
    });

    sendSuccess(res, { prediction }, 201);
  })
);

/**
 * GET /predictions
 * Get current user's predictions.
 */
router.get(
  '/',
  requireAuth,
  validateQuery(listPredictionsSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { status, limit, offset } = req.query as unknown as z.infer<typeof listPredictionsSchema>;

    const result = await PredictionService.getByUser(userId, {
      status,
      limit,
      offset,
    });

    sendSuccess(res, result);
  })
);

/**
 * GET /predictions/stats
 * Get current user's prediction statistics.
 */
router.get(
  '/stats',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const stats = await PredictionService.getUserStats(userId);
    sendSuccess(res, { stats });
  })
);

/**
 * GET /predictions/:id/cashout-value
 * Get cashout value for a prediction.
 */
router.get(
  '/:id/cashout-value',
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const result = await PredictionService.getCashoutValue(req.params.id as string, userId);
    sendSuccess(res, result);
  })
);

/**
 * POST /predictions/:id/cashout
 * Execute cashout for a prediction.
 */
router.post(
  '/:id/cashout',
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const prediction = await PredictionService.cashout(req.params.id as string, userId);
    sendSuccess(res, { prediction });
  })
);

/**
 * GET /predictions/:id
 * Get a specific prediction.
 */
router.get(
  '/:id',
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const prediction = await PredictionService.getById(req.params.id as string, userId);
    sendSuccess(res, { prediction });
  })
);

export default router;
