import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, getAuthUser, validateQuery } from '../middleware/index.js';
import { AchievementService } from '../services/achievements.js';
import { asyncHandler, sendSuccess } from '../utils/index.js';

const router = Router();

const progressQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(3),
});

/**
 * GET /achievements
 * List all achievements with unlock status and progress for the authenticated user.
 */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const result = await AchievementService.getAll(userId);
    sendSuccess(res, result);
  })
);

/**
 * GET /achievements/me
 * List only unlocked achievements for the authenticated user.
 */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const result = await AchievementService.getUnlocked(userId);
    sendSuccess(res, result);
  })
);

/**
 * GET /achievements/progress
 * Return the next closest locked achievements by progress.
 */
router.get(
  '/progress',
  requireAuth,
  validateQuery(progressQuerySchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { limit } = req.query as unknown as z.infer<typeof progressQuerySchema>;
    const result = await AchievementService.getProgress(userId, limit);
    sendSuccess(res, result);
  })
);

export default router;
