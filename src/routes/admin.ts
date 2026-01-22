import { Router } from 'express';
import { z } from 'zod';
import { EventService } from '../services/events.js';
import { RewardsService } from '../services/rewards.js';
import { LedgerService } from '../services/ledger.js';
import { prisma } from '../services/database.js';
import { SettlementWorker } from '../services/settlementWorker.js';
import { OddsSyncService } from '../services/oddsSync.js';
import { requireAuth, requireAdmin, validateBody, validateQuery, validateParams, getAuthUser, idParamSchema, positiveIntSchema, futureDateSchema } from '../middleware/index.js';
import { sendSuccess } from '../utils/index.js';

const router = Router();

// All admin routes require auth + admin
router.use(requireAuth, requireAdmin);

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const createEventSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional(),
  startsAt: futureDateSchema,
  outcomes: z.array(z.string().min(1)).min(2, 'At least 2 outcomes required'),
  payoutMultiplier: z.number().min(1).max(10).default(2.0),
  externalEventId: z.string().min(1).optional(),
  externalSportKey: z.string().min(1).optional(),
});

const settleEventSchema = z.object({
  finalOutcome: z.string().min(1, 'Final outcome is required'),
});

const createRewardSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(2000).optional(),
  pointsCost: positiveIntSchema,
  stockLimit: z.number().int().min(1).optional(),
  imageUrl: z.string().url().optional(),
});

const updateRewardSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  pointsCost: positiveIntSchema.optional(),
  stockLimit: z.number().int().min(1).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
});

const fulfilRedemptionSchema = z.object({
  fulfilmentNote: z.string().max(1000).optional(),
});

const adminCreditSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  amount: positiveIntSchema,
  description: z.string().max(500).optional(),
});

// =============================================================================
// EVENT MANAGEMENT
// =============================================================================

/**
 * POST /admin/events
 * Create a new event.
 */
router.post(
  '/events',
  validateBody(createEventSchema),
  async (req, res, next) => {
    try {
      const { userId } = getAuthUser(req);
      const {
        title,
        description,
        startsAt,
        outcomes,
        payoutMultiplier,
        externalEventId,
        externalSportKey,
      } = req.body;

      const event = await EventService.create({
        title,
        description,
        startsAt: new Date(startsAt),
        outcomes,
        payoutMultiplier,
        createdBy: userId,
        externalEventId,
        externalSportKey,
      });

      sendSuccess(res, { event }, 201);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/events/:id/lock
 * Lock an event (stop accepting predictions).
 */
router.post(
  '/events/:id/lock',
  validateParams(idParamSchema),
  async (req, res, next) => {
    try {
      const event = await EventService.lock(req.params.id);
      sendSuccess(res, { event });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/events/:id/settle
 * Settle an event with a final outcome.
 */
router.post(
  '/events/:id/settle',
  validateParams(idParamSchema),
  validateBody(settleEventSchema),
  async (req, res, next) => {
    try {
      const { userId } = getAuthUser(req);
      const { finalOutcome } = req.body;

      const result = await EventService.settle(
        req.params.id,
        finalOutcome,
        userId
      );

      sendSuccess(res, { settlement: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/events/:id/cancel
 * Cancel an event and refund all stakes.
 */
router.post(
  '/events/:id/cancel',
  validateParams(idParamSchema),
  async (req, res, next) => {
    try {
      const { userId } = getAuthUser(req);
      const result = await EventService.cancel(req.params.id, userId);
      sendSuccess(res, { cancellation: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/events/auto-lock
 * Auto-lock all events that have started.
 */
router.post(
  '/events/auto-lock',
  async (req, res, next) => {
    try {
      const count = await EventService.autoLockStartedEvents();
      sendSuccess(res, { locked: count });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/odds/sync
 * Trigger odds sync from external provider.
 */
router.post(
  '/odds/sync',
  async (_req, res, next) => {
    try {
      const result = await OddsSyncService.runOnce();
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// REWARD MANAGEMENT
// =============================================================================

/**
 * POST /admin/rewards
 * Create a new reward.
 */
router.post(
  '/rewards',
  validateBody(createRewardSchema),
  async (req, res, next) => {
    try {
      const reward = await RewardsService.createReward(req.body);
      sendSuccess(res, { reward }, 201);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /admin/rewards/:id
 * Update a reward.
 */
router.patch(
  '/rewards/:id',
  validateParams(idParamSchema),
  validateBody(updateRewardSchema),
  async (req, res, next) => {
    try {
      const reward = await RewardsService.updateReward(req.params.id, req.body);
      sendSuccess(res, { reward });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/rewards
 * List all rewards (including inactive).
 */
router.get(
  '/rewards',
  async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await RewardsService.listRewards({
        activeOnly: false,
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
// REDEMPTION MANAGEMENT
// =============================================================================

/**
 * GET /admin/redemptions
 * List all redemptions.
 */
router.get(
  '/redemptions',
  async (req, res, next) => {
    try {
      const status = req.query.status as 'PENDING' | 'FULFILLED' | 'CANCELLED' | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await RewardsService.listRedemptions({
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
 * POST /admin/redemptions/:id/fulfil
 * Mark a redemption as fulfilled.
 */
router.post(
  '/redemptions/:id/fulfil',
  validateParams(idParamSchema),
  validateBody(fulfilRedemptionSchema),
  async (req, res, next) => {
    try {
      const { userId } = getAuthUser(req);
      const { fulfilmentNote } = req.body;

      const redemption = await RewardsService.fulfil(
        req.params.id,
        userId,
        fulfilmentNote
      );

      sendSuccess(res, { redemption });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/redemptions/:id/cancel
 * Cancel a redemption and refund tokens.
 */
router.post(
  '/redemptions/:id/cancel',
  validateParams(idParamSchema),
  async (req, res, next) => {
    try {
      const { userId } = getAuthUser(req);
      const redemption = await RewardsService.cancel(req.params.id, userId);
      sendSuccess(res, { redemption });
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// USER MANAGEMENT
// =============================================================================

/**
 * GET /admin/users
 * List all users.
 */
router.get(
  '/users',
  async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          select: {
            id: true,
            email: true,
            tokenBalance: true,
            isAdmin: true,
            isVerified: true,
            createdAt: true,
            _count: {
              select: { predictions: true, redemptions: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.user.count(),
      ]);

      sendSuccess(res, { users, total });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/users/:id/balance
 * Verify a user's balance.
 */
router.get(
  '/users/:id/balance',
  validateParams(idParamSchema),
  async (req, res, next) => {
    try {
      const check = await LedgerService.verifyBalance(req.params.id);
      sendSuccess(res, { balance: check });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/users/:id/balance/repair
 * Repair a user's cached balance.
 */
router.post(
  '/users/:id/balance/repair',
  validateParams(idParamSchema),
  async (req, res, next) => {
    try {
      const check = await LedgerService.repairBalance(req.params.id);
      sendSuccess(res, { balance: check });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/tokens/credit
 * Credit tokens to a user (admin adjustment).
 */
router.post(
  '/tokens/credit',
  validateBody(adminCreditSchema),
  async (req, res, next) => {
    try {
      const { userId, amount, description } = req.body;

      const result = await LedgerService.credit({
        userId,
        amount,
        type: 'ADMIN_CREDIT',
        description: description ?? 'Admin credit',
      });

      sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// SYSTEM
// =============================================================================

/**
 * GET /admin/stats
 * Get platform statistics.
 */
router.get(
  '/stats',
  async (req, res, next) => {
    try {
      const [
        userCount,
        eventCount,
        predictionCount,
        redemptionCount,
        totalTokensInCirculation,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.event.count(),
        prisma.prediction.count(),
        prisma.redemption.count(),
        prisma.user.aggregate({ _sum: { tokenBalance: true } }),
      ]);

      const pendingRedemptions = await prisma.redemption.count({
        where: { status: 'PENDING' },
      });

      const openEvents = await prisma.event.count({
        where: { status: 'OPEN' },
      });

      sendSuccess(res, {
        stats: {
          users: userCount,
          events: {
            total: eventCount,
            open: openEvents,
          },
          predictions: predictionCount,
          redemptions: {
            total: redemptionCount,
            pending: pendingRedemptions,
          },
          tokensInCirculation: totalTokensInCirculation._sum.tokenBalance ?? 0,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// =============================================================================
// SETTLEMENT WORKER
// =============================================================================

/**
 * POST /admin/settlement/run
 * Manually trigger settlement worker.
 */
router.post(
  '/settlement/run',
  async (_req, res, next) => {
    try {
      const result = await SettlementWorker.runOnce();
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/settlement/status
 * Get settlement worker status.
 */
router.get(
  '/settlement/status',
  async (_req, res, next) => {
    try {
      sendSuccess(res, { status: SettlementWorker.getStatus() });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
