import { Router } from 'express';
import { z } from 'zod';
import { RewardsService } from '../services/rewards.js';
import { requireAuth, validateBody, validateQuery, validateParams, getAuthUser, idParamSchema } from '../middleware/index.js';
import { sendSuccess } from '../utils/index.js';

const router = Router();

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const listRewardsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const redeemSchema = z.object({
  rewardId: z.string().min(1, 'Reward ID is required'),
});

const listRedemptionsSchema = z.object({
  status: z.enum(['PENDING', 'FULFILLED', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// REWARDS ROUTES
// =============================================================================

/**
 * GET /rewards
 * List all active rewards.
 */
router.get(
  '/',
  validateQuery(listRewardsSchema),
  async (req, res, next) => {
    try {
      const { limit, offset } = req.query as unknown as z.infer<typeof listRewardsSchema>;

      const result = await RewardsService.listRewards({
        activeOnly: true,
        limit,
        offset,
      });

      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// REDEMPTION ROUTES (must be defined BEFORE /:id to avoid route shadowing)
// =============================================================================

/**
 * GET /rewards/redemptions
 * Get current user's redemptions.
 */
router.get(
  '/redemptions',
  requireAuth,
  validateQuery(listRedemptionsSchema),
  async (req, res, next) => {
    try {
      const { userId } = getAuthUser(req);
      const { status, limit, offset } = req.query as unknown as z.infer<typeof listRedemptionsSchema>;

      const result = await RewardsService.getUserRedemptions(userId, {
        status,
        limit,
        offset,
      });

      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /rewards/redemptions/:id
 * Get a specific redemption.
 */
router.get(
  '/redemptions/:id',
  requireAuth,
  validateParams(idParamSchema),
  async (req, res, next) => {
    try {
      const { userId } = getAuthUser(req);
      const redemption = await RewardsService.getRedemptionById(req.params.id as string, userId);
      sendSuccess(res, { redemption });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /rewards/redeem
 * Redeem a reward.
 */
router.post(
  '/redeem',
  requireAuth,
  validateBody(redeemSchema),
  async (req, res, next) => {
    try {
      const { userId } = getAuthUser(req);
      const { rewardId } = req.body;

      const redemption = await RewardsService.redeem(userId, rewardId);

      sendSuccess(res, { redemption }, 201);
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// PARAMETERIZED ROUTES (after static routes)
// =============================================================================

/**
 * GET /rewards/:id
 * Get a specific reward.
 */
router.get(
  '/:id',
  validateParams(idParamSchema),
  async (req, res, next) => {
    try {
      const reward = await RewardsService.getRewardById(req.params.id as string);
      sendSuccess(res, { reward });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /rewards/:id/redeem
 * Redeem a reward by ID.
 */
router.post(
  '/:id/redeem',
  requireAuth,
  validateParams(idParamSchema),
  async (req, res, next) => {
    try {
      const { userId } = getAuthUser(req);
      const redemption = await RewardsService.redeem(userId, req.params.id as string);
      sendSuccess(res, { redemption }, 201);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
