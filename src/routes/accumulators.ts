import { Router } from 'express';
import { z } from 'zod';
import { AccumulatorService } from '../services/accumulators.js';
import {
  getAuthUser,
  idParamSchema,
  requireAuth,
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/index.js';
import { asyncHandler, sendSuccess } from '../utils/index.js';

const router = Router();

const placeAccumulatorSchema = z.object({
  legs: z
    .array(
      z.object({
        eventId: z.string().min(1, 'Event ID is required'),
        predictedOutcome: z.string().min(1, 'Predicted outcome is required'),
      })
    )
    .min(2)
    .max(10),
  stakeAmount: z.coerce.number().int().min(1).max(35),
});

const listAccumulatorsSchema = z.object({
  status: z.enum(['PENDING', 'WON', 'LOST', 'CANCELLED', 'CASHED_OUT']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

router.post(
  '/',
  requireAuth,
  validateBody(placeAccumulatorSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { legs, stakeAmount } = req.body;

    const accumulator = await AccumulatorService.place({
      userId,
      legs,
      stakeAmount,
    });

    sendSuccess(res, { accumulator }, 201);
  })
);

router.get(
  '/',
  requireAuth,
  validateQuery(listAccumulatorsSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { status, limit, offset } = req.query as unknown as z.infer<typeof listAccumulatorsSchema>;

    const result = await AccumulatorService.getByUser(userId, {
      status,
      limit,
      offset,
    });

    sendSuccess(res, result);
  })
);

router.get(
  '/:id',
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const accumulator = await AccumulatorService.getById(req.params.id as string, userId);

    sendSuccess(res, { accumulator });
  })
);

export default router;
