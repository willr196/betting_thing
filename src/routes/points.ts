import { Router } from 'express';
import { requireAuth, getAuthUser } from '../middleware/index.js';
import { PointsLedgerService } from '../services/pointsLedger.js';
import { asyncHandler, sendSuccess } from '../utils/index.js';

const router = Router();

/**
 * GET /points/balance
 * Get user's points balance.
 */
router.get(
  '/balance',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const balance = await PointsLedgerService.getBalance(userId);
    sendSuccess(res, {
      balance: balance.cached,
      verified: balance.cached === balance.calculated,
    });
  })
);

/**
 * GET /points/transactions
 * Get paginated points transaction history for the authenticated user.
 */
router.get(
  '/transactions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const limit = Math.min(Number(req.query['limit']) || 20, 100);
    const offset = Number(req.query['offset']) || 0;
    const { transactions, total } = await PointsLedgerService.getHistory(userId, {
      limit,
      offset,
    });
    sendSuccess(res, { transactions, total });
  })
);

export default router;
