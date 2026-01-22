import { Router } from 'express';
import { requireAuth, getAuthUser } from '../middleware/index.js';
import { PointsLedgerService } from '../services/pointsLedger.js';
import { sendSuccess } from '../utils/index.js';

const router = Router();

/**
 * GET /points/balance
 * Get user's points balance.
 */
router.get('/balance', requireAuth, async (req, res, next) => {
  try {
    const { userId } = getAuthUser(req);
    const balance = await PointsLedgerService.getBalance(userId);
    sendSuccess(res, {
      balance: balance.cached,
      verified: balance.cached === balance.calculated,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
