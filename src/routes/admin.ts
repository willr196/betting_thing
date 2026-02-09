import { Router } from 'express';
import { z } from 'zod';
import { EventService } from '../services/events.js';
import { RewardsService } from '../services/rewards.js';
import { LedgerService } from '../services/ledger.js';
import { prisma } from '../services/database.js';
import { SettlementWorker } from '../services/settlementWorker.js';
import { OddsSyncService } from '../services/oddsSync.js';
import { requireAuth, requireAdmin, validateBody, validateParams, getAuthUser, idParamSchema, positiveIntSchema, futureDateSchema } from '../middleware/index.js';
import { asyncHandler, parseLimitOffset, sendSuccess } from '../utils/index.js';

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
  asyncHandler(async (req, res) => {
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
  })
);

/**
 * POST /admin/events/:id/lock
 * Lock an event (stop accepting predictions).
 */
router.post(
  '/events/:id/lock',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const event = await EventService.lock(req.params.id as string);
    sendSuccess(res, { event });
  })
);

/**
 * POST /admin/events/:id/settle
 * Settle an event with a final outcome.
 */
router.post(
  '/events/:id/settle',
  validateParams(idParamSchema),
  validateBody(settleEventSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { finalOutcome } = req.body;

    const result = await EventService.settle(
      req.params.id as string,
      finalOutcome,
      userId
    );

    sendSuccess(res, { settlement: result });
  })
);

/**
 * POST /admin/events/:id/cancel
 * Cancel an event and refund all stakes.
 */
router.post(
  '/events/:id/cancel',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const result = await EventService.cancel(req.params.id as string, userId);
    sendSuccess(res, { cancellation: result });
  })
);

/**
 * POST /admin/events/auto-lock
 * Auto-lock all events that have started.
 */
router.post(
  '/events/auto-lock',
  asyncHandler(async (_req, res) => {
    const count = await EventService.autoLockStartedEvents();
    sendSuccess(res, { locked: count });
  })
);

/**
 * POST /admin/odds/sync
 * Trigger odds sync from external provider.
 */
router.post(
  '/odds/sync',
  asyncHandler(async (_req, res) => {
    const result = await OddsSyncService.runOnce();
    sendSuccess(res, result);
  })
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
  asyncHandler(async (req, res) => {
    const reward = await RewardsService.createReward(req.body);
    sendSuccess(res, { reward }, 201);
  })
);

/**
 * PATCH /admin/rewards/:id
 * Update a reward.
 */
router.patch(
  '/rewards/:id',
  validateParams(idParamSchema),
  validateBody(updateRewardSchema),
  asyncHandler(async (req, res) => {
    const reward = await RewardsService.updateReward(req.params.id as string, req.body);
    sendSuccess(res, { reward });
  })
);

/**
 * GET /admin/rewards
 * List all rewards (including inactive).
 */
router.get(
  '/rewards',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parseLimitOffset(req.query as Record<string, unknown>, {
      defaultLimit: 50,
      maxLimit: 100,
    });

    const result = await RewardsService.listRewards({
      activeOnly: false,
      limit,
      offset,
    });

    sendSuccess(res, result);
  })
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
  asyncHandler(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const status = query.status as 'PENDING' | 'FULFILLED' | 'CANCELLED' | undefined;
    const { limit, offset } = parseLimitOffset(query as Record<string, unknown>, {
      defaultLimit: 50,
      maxLimit: 100,
    });

    const result = await RewardsService.listRedemptions({
      status,
      limit,
      offset,
    });

    sendSuccess(res, result);
  })
);

/**
 * POST /admin/redemptions/:id/fulfil
 * Mark a redemption as fulfilled.
 */
router.post(
  '/redemptions/:id/fulfil',
  validateParams(idParamSchema),
  validateBody(fulfilRedemptionSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { fulfilmentNote } = req.body;

    const redemption = await RewardsService.fulfil(
      req.params.id as string,
      userId,
      fulfilmentNote
    );

    sendSuccess(res, { redemption });
  })
);

/**
 * POST /admin/redemptions/:id/cancel
 * Cancel a redemption and refund points.
 */
router.post(
  '/redemptions/:id/cancel',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const redemption = await RewardsService.cancel(req.params.id as string, userId);
    sendSuccess(res, { redemption });
  })
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
  asyncHandler(async (req, res) => {
    const { limit, offset } = parseLimitOffset(req.query as Record<string, unknown>, {
      defaultLimit: 50,
      maxLimit: 100,
    });

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
  })
);

/**
 * GET /admin/users/:id/balance
 * Verify a user's balance.
 */
router.get(
  '/users/:id/balance',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const check = await LedgerService.verifyBalance(req.params.id as string);
    sendSuccess(res, { balance: check });
  })
);

/**
 * POST /admin/users/:id/balance/repair
 * Repair a user's cached balance.
 */
router.post(
  '/users/:id/balance/repair',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const check = await LedgerService.repairBalance(req.params.id as string);
    sendSuccess(res, { balance: check });
  })
);

/**
 * POST /admin/tokens/credit
 * Credit tokens to a user (admin adjustment).
 */
router.post(
  '/tokens/credit',
  validateBody(adminCreditSchema),
  asyncHandler(async (req, res) => {
    const { userId, amount, description } = req.body;

    const result = await LedgerService.credit({
      userId,
      amount,
      type: 'ADMIN_CREDIT',
      description: description ?? 'Admin credit',
    });

    sendSuccess(res, result, 201);
  })
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
  asyncHandler(async (_req, res) => {
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
  })
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
  asyncHandler(async (_req, res) => {
    const result = await SettlementWorker.runOnce();
    sendSuccess(res, result);
  })
);

/**
 * GET /admin/settlement/status
 * Get settlement worker status.
 */
router.get(
  '/settlement/status',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { status: SettlementWorker.getStatus() });
  })
);

export default router;
