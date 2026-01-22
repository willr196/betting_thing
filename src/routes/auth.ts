import { Router } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/auth.js';
import { LedgerService } from '../services/ledger.js';
import { TokenAllowanceService } from '../services/tokenAllowance.js';
import { requireAuth, validateBody, getAuthUser, emailSchema, passwordSchema } from '../middleware/index.js';
import { sendSuccess } from '../utils/index.js';

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
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const result = await AuthService.register(email, password);
      sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /auth/login
 * Authenticate user and return JWT.
 */
router.post(
  '/login',
  validateBody(loginSchema),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const result = await AuthService.login(email, password);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /auth/me
 * Get current authenticated user's profile.
 */
router.get(
  '/me',
  requireAuth,
  async (req, res, next) => {
    try {
      const { userId } = getAuthUser(req);
      const user = await AuthService.getUserById(userId);
      
      if (!user) {
        return sendSuccess(res, null, 404);
      }
      
      sendSuccess(res, { user });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /auth/balance
 * Get current user's token balance with verification.
 */
router.get(
  '/balance',
  requireAuth,
  async (req, res, next) => {
    try {
      const { userId } = getAuthUser(req);
      await TokenAllowanceService.getStatus(userId);
      const balance = await LedgerService.getBalance(userId);
      
      sendSuccess(res, {
        balance: balance.cached,
        verified: balance.cached === balance.calculated,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /auth/change-password
 * Change the current user's password.
 */
router.post(
  '/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  async (req, res, next) => {
    try {
      const { userId } = getAuthUser(req);
      const { currentPassword, newPassword } = req.body;
      
      await AuthService.updatePassword(userId, currentPassword, newPassword);
      
      sendSuccess(res, { message: 'Password updated successfully' });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /auth/transactions
 * Get current user's token transaction history.
 */
router.get(
  '/transactions',
  requireAuth,
  async (req, res, next) => {
    try {
      const { userId } = getAuthUser(req);
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      
      const result = await LedgerService.getHistory(userId, { limit, offset });
      
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
