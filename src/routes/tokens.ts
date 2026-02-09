import { Router } from 'express';
import { requireAuth, getAuthUser } from '../middleware/index.js';
import { TokenAllowanceService } from '../services/tokenAllowance.js';
import { LedgerService } from '../services/ledger.js';
import { asyncHandler, sendSuccess } from '../utils/index.js';

const router = Router();

/**
 * GET /tokens/allowance
 * Get user's token allowance and balance.
 */
router.get(
  '/allowance',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const allowance = await TokenAllowanceService.getStatus(userId);
    const balance = await LedgerService.getBalance(userId);

    sendSuccess(res, {
      allowance,
      balance: balance.cached,
      verified: balance.cached === balance.calculated,
    });
  })
);

export default router;
