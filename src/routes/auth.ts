import { Router } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/auth.js';
import { LedgerService } from '../services/ledger.js';
import { TokenAllowanceService } from '../services/tokenAllowance.js';
import { requireAuth, validateBody, getAuthUser, emailSchema, passwordSchema } from '../middleware/index.js';
import { asyncHandler, parseLimitOffset, sendSuccess } from '../utils/index.js';

const router = Router();

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

// =============================================================================
// ROUTES
// =============================================================================

/**
 * POST /auth/register
 * Register a new user account.
 */
router.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const result = await AuthService.register(email, password);
    sendSuccess(res, result, 201);
  })
);

/**
 * POST /auth/login
 * Authenticate user and return JWT.
 */
router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const result = await AuthService.login(email, password);
    sendSuccess(res, result);
  })
);

/**
 * GET /auth/me
 * Get current authenticated user's profile.
 */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const user = await AuthService.getUserById(userId);

    if (!user) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
      return;
    }

    sendSuccess(res, { user });
  })
);

/**
 * GET /auth/balance
 * Get current user's token balance with verification.
 */
router.get(
  '/balance',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    await TokenAllowanceService.getStatus(userId);
    const balance = await LedgerService.getBalance(userId);

    sendSuccess(res, {
      balance: balance.cached,
      verified: balance.cached === balance.calculated,
    });
  })
);

/**
 * POST /auth/change-password
 * Change the current user's password.
 */
router.post(
  '/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { currentPassword, newPassword } = req.body;

    await AuthService.updatePassword(userId, currentPassword, newPassword);

    sendSuccess(res, { message: 'Password updated successfully' });
  })
);

/**
 * GET /auth/transactions
 * Get current user's token transaction history.
 */
router.get(
  '/transactions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { limit, offset } = parseLimitOffset(req.query as Record<string, unknown>, {
      defaultLimit: 50,
      maxLimit: 100,
    });

    const result = await LedgerService.getHistory(userId, { limit, offset });

    sendSuccess(res, result);
  })
);

export default router;
