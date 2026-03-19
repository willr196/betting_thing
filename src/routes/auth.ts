import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { AuthService } from '../services/auth.js';
import { LedgerService } from '../services/ledger.js';
import { TokenAllowanceService, getNextAllowanceRefillAt } from '../services/tokenAllowance.js';
import { PointsLedgerService } from '../services/pointsLedger.js';
import { PredictionService } from '../services/predictions.js';
import { LeaderboardService } from '../services/leaderboard.js';
import { AchievementService } from '../services/achievements.js';
import { requireAuth, validateBody, validateQuery, getAuthUser, emailSchema, passwordSchema } from '../middleware/index.js';
import { asyncHandler, sendSuccess } from '../utils/index.js';
import { config } from '../config/index.js';

const router = Router();

// =============================================================================
// REFRESH TOKEN COOKIE HELPERS
// =============================================================================

const REFRESH_COOKIE = 'refresh_token';
const refreshCookieSameSite: 'none' | 'strict' = config.isProd ? 'none' : 'strict';
const refreshCookieBaseOptions = {
  httpOnly: true,
  secure: config.isProd,
  // Production uses a separate frontend origin, so the browser must be allowed
  // to attach the refresh cookie on cross-site credentialed requests.
  sameSite: refreshCookieSameSite,
  path: '/api/v1/auth',
};

const refreshCookieOptions = {
  ...refreshCookieBaseOptions,
  maxAge: config.auth.refreshTokenExpiresDays * 24 * 60 * 60 * 1000,
};

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions);
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, refreshCookieBaseOptions);
}

// =============================================================================
// AUTH-SPECIFIC RATE LIMITERS
// Stricter than the global limiter — authentication endpoints are high-value targets.
// =============================================================================

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 min window
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many login attempts. Please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many registration attempts. Please try again in 15 minutes.',
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

const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many password change attempts. Please try again in 15 minutes.',
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

const transactionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
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
    await TokenAllowanceService.getOrCreateStatus(userId);
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
  changePasswordLimiter,
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
  validateQuery(transactionsQuerySchema),
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);
    const { limit, offset } = req.query as unknown as { limit: number; offset: number };

    const result = await LedgerService.getHistory(userId, { limit, offset });

    sendSuccess(res, result);
  })
);

/**
 * GET /auth/dashboard
 * Aggregated wallet/profile stats for dashboard UI.
 */
router.get(
  '/dashboard',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = getAuthUser(req);

    const [predictionStats, allowanceStatus, tokenHistory, pointsHistory, achievementProgress, metrics] =
      await Promise.all([
        PredictionService.getUserStats(userId),
        TokenAllowanceService.getOrCreateStatus(userId),
        LedgerService.getHistory(userId, { limit: 5, offset: 0 }),
        PointsLedgerService.getHistory(userId, { limit: 5, offset: 0 }),
        AchievementService.getProgress(userId, 3),
        AchievementService.getMetrics(userId),
      ]);

    let streak = { current: 0, longest: 0 };
    const rank = await LeaderboardService.findUserRank(userId, 'ALL_TIME', 'all-time');
    if (rank) {
      streak = {
        current: rank.currentStreak,
        longest: rank.longestStreak,
      };
    }

    const recentActivity = [
      ...tokenHistory.transactions.map((tx) => ({
        id: tx.id,
        currency: 'TOKENS' as const,
        type: tx.type,
        amount: tx.amount,
        balanceAfter: tx.balanceAfter,
        description: tx.description,
        createdAt: tx.createdAt,
      })),
      ...pointsHistory.transactions.map((tx) => ({
        id: tx.id,
        currency: 'POINTS' as const,
        type: tx.type,
        amount: tx.amount,
        balanceAfter: tx.balanceAfter,
        description: tx.description,
        createdAt: tx.createdAt,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5);

    const lastRefillAt = allowanceStatus.lastResetDate;
    const nextRefillAt = getNextAllowanceRefillAt(new Date());

    sendSuccess(res, {
      predictionStats: {
        ...predictionStats,
        totalPointsEarned: metrics.totalPositivePoints,
      },
      streak,
      recentActivity,
      allowance: {
        tokensRemaining: allowanceStatus.tokensRemaining,
        lastRefillAt,
        nextRefillAt,
        weeklyStartTokens: config.tokens.weeklyStart,
        dailyAllowance: config.tokens.dailyAllowance,
        maxStack: config.tokens.maxAllowance,
      },
      achievementProgress: achievementProgress.next,
    });
  })
);

export default router;
