import { Router } from 'express';
import { z } from 'zod';
import { LeaderboardService } from '../services/leaderboard.js';
import { requireAuth, getAuthUser, validateQuery } from '../middleware/index.js';
import { asyncHandler, sendSuccess } from '../utils/index.js';

const router = Router();

const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * GET /leaderboard
 * Get ranked users by points and current user's rank summary.
 */
router.get(
  '/',
  requireAuth,
  validateQuery(leaderboardQuerySchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { limit } = req.query as unknown as z.infer<typeof leaderboardQuerySchema>;
    const result = await LeaderboardService.getLeaderboard(userId, limit);
    sendSuccess(res, result);
  })
);

export default router;
