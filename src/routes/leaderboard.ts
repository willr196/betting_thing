import { Router } from 'express';
import { z } from 'zod';
import { LeaderboardService } from '../services/leaderboard.js';
import {
  optionalAuth,
  requireAuth,
  validateQuery,
  getAuthUser,
} from '../middleware/index.js';
import type { AuthenticatedRequest } from '../types/index.js';
import { asyncHandler, sendSuccess } from '../utils/index.js';

const router = Router();

const leaderboardQuerySchema = z.object({
  period: z.enum(['weekly', 'monthly', 'all-time']).default('weekly'),
  periodKey: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

type LeaderboardPeriod = 'WEEKLY' | 'MONTHLY' | 'ALL_TIME';

function parsePeriod(rawPeriod: z.infer<typeof leaderboardQuerySchema>['period']): LeaderboardPeriod {
  if (rawPeriod === 'weekly') return 'WEEKLY';
  if (rawPeriod === 'monthly') return 'MONTHLY';
  return 'ALL_TIME';
}

/**
 * GET /leaderboard
 * Public leaderboard by period. Includes current user rank when auth is present.
 */
router.get(
  '/',
  optionalAuth,
  validateQuery(leaderboardQuerySchema),
  asyncHandler(async (req, res) => {
    const { period: rawPeriod, periodKey, limit } =
      req.query as unknown as z.infer<typeof leaderboardQuerySchema>;
    const period = parsePeriod(rawPeriod);

    const authReq = req as AuthenticatedRequest;
    const currentUserId = authReq.user?.userId;

    const result = await LeaderboardService.getLeaderboard(
      period,
      periodKey ?? LeaderboardService.getCurrentPeriodKey(period),
      limit,
      currentUserId
    );

    sendSuccess(res, result);
  })
);

/**
 * GET /leaderboard/me
 * Authenticated user's rank for requested period.
 */
router.get(
  '/me',
  requireAuth,
  validateQuery(leaderboardQuerySchema.pick({ period: true, periodKey: true })),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { period: rawPeriod, periodKey } = req.query as unknown as {
      period: 'weekly' | 'monthly' | 'all-time';
      periodKey?: string;
    };
    const period = parsePeriod(rawPeriod);

    const rank = await LeaderboardService.getUserRank(
      userId,
      period,
      periodKey ?? LeaderboardService.getCurrentPeriodKey(period)
    );

    sendSuccess(res, { rank });
  })
);

export default router;
