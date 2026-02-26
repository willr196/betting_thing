import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { AuthService } from '../services/auth.js';
import { LedgerService } from '../services/ledger.js';
import { TokenAllowanceService } from '../services/tokenAllowance.js';
import { requireAuth, validateBody, getAuthUser, emailSchema, passwordSchema } from '../middleware/index.js';
import { asyncHandler, parseLimitOffset, sendSuccess } from '../utils/index.js';
import { config } from '../config/index.js';

const router = Router();

// =============================================================================
// REFRESH TOKEN COOKIE HELPERS
// =============================================================================

const REFRESH_COOKIE = 'refresh_token';

const refreshCookieOptions = {
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'strict' as const,
  maxAge: config.auth.refreshTokenExpiresDays * 24 * 60 * 60 * 1000,
  path: '/api/auth',
};

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions);
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

// =============================================================================
// AUTH-SPECIFIC RATE LIMITERS
// Stricter than the global limiter — authentication endpoints are high-value targets.
// =============================================================================

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many login attempts. Please try again in 15 minutes.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many registration attempts. Please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many refresh attempts. Please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

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
  registerLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const result = await AuthService.register(email, password);
    setRefreshCookie(res, result.refreshToken);
    sendSuccess(res, { user: result.user, token: result.token }, 201);
  })
);

/**
 * POST /auth/login
 * Authenticate user and return JWT.
 */
router.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const result = await AuthService.login(email, password);
    setRefreshCookie(res, result.refreshToken);
    sendSuccess(res, { user: result.user, token: result.token });
  })
);

/**
 * POST /auth/refresh
 * Exchange a refresh token (from HTTP-only cookie) for a new access token.
 */
router.post(
  '/refresh',
  refreshLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const rawToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;

    if (!rawToken) {
      res.status(401).json({
        success: false,
        error: { code: 'TOKEN_MISSING', message: 'No refresh token provided' },
      });
      return;
    }

    const result = await AuthService.refreshAccessToken(rawToken);
    setRefreshCookie(res, result.refreshToken);
    sendSuccess(res, { user: result.user, token: result.token });
  })
);

/**
 * POST /auth/logout
 * Revoke refresh token and clear the cookie.
 */
router.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    // Best-effort revocation — works with or without auth header
    const rawToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (rawToken) {
      try {
        const result = await AuthService.refreshAccessToken(rawToken);
        await AuthService.revokeRefreshToken(result.user.id);
      } catch {
        // Token invalid/expired — nothing to revoke
      }
    }
    clearRefreshCookie(res);
    sendSuccess(res, { message: 'Logged out successfully' });
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
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuthUser(req);
    const { currentPassword, newPassword } = req.body;

    await AuthService.updatePassword(userId, currentPassword, newPassword);

    // Clear refresh token cookie since password change invalidates all sessions
    clearRefreshCookie(res);

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
