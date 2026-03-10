import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'crypto';
import { Prisma, type User } from '@prisma/client';
import { config } from '../config/index.js';
import { prisma } from './database.js';
import { LedgerService } from './ledger.js';
import { TokenAllowanceService } from './tokenAllowance.js';
import { AppError } from '../utils/index.js';
import type { JwtPayload, SafeUser } from '../types/index.js';

// =============================================================================
// AUTH SERVICE
// =============================================================================

function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

function getLockoutMessage(remainingMinutes: number): string {
  const suffix = remainingMinutes === 1 ? '' : 's';
  return `Too many failed login attempts. Please try again in ${remainingMinutes} minute${suffix}.`;
}

function toSafeUser(user: User): SafeUser {
  const safeUser = { ...user } as Partial<User>;
  delete safeUser.passwordHash;
  delete safeUser.tokenVersion;
  delete safeUser.refreshTokenHash;
  delete safeUser.refreshTokenExpiresAt;
  delete safeUser.failedLoginAttempts;
  delete safeUser.loginLockoutUntil;
  return safeUser as SafeUser;
}

async function getUserWithFreshAllowance(
  userId: string,
  tx?: Prisma.TransactionClient
): Promise<User> {
  await TokenAllowanceService.getOrCreateStatus(userId, tx);
  const client = tx ?? prisma;
  return client.user.findUniqueOrThrow({
    where: { id: userId },
  });
}

export const AuthService = {
  /**
   * Register a new user.
   * Creates user with hashed password and initial token bonus.
   */
  async register(
    email: string,
    password: string
  ): Promise<{ user: SafeUser; token: string; refreshToken: string }> {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      throw new AppError('ALREADY_EXISTS', 'User with this email already exists', 409);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);

    // Create user and token allowance in a transaction
    const user = await prisma.$transaction(async (tx) => {
      // Create the user
      const newUser = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash,
          tokenBalance: 0, // Will be set by ledger
          pointsBalance: 0,
        },
      });

      if (config.tokens.signupBonus > 0) {
        await LedgerService.createSignupBonus(
          newUser.id,
          config.tokens.signupBonus,
          tx
        );
      }

      return getUserWithFreshAllowance(newUser.id, tx);
    });

    // Generate tokens
    const token = this.generateToken(user);
    const refreshToken = await this.createRefreshToken(user.id);

    return {
      user: toSafeUser(user),
      token,
      refreshToken,
    };
  },

  /**
   * Authenticate a user with email and password.
   * Returns user, access token, and refresh token on success.
   */
  async login(
    email: string,
    password: string
  ): Promise<{ user: SafeUser; token: string; refreshToken: string }> {
    const normalizedEmail = normalizeEmailKey(email);
    const result = await prisma.$transaction(async (tx) => {
      const [lockedUser] = await tx.$queryRaw<
        Array<{
          id: string;
          passwordHash: string;
          failedLoginAttempts: number;
          loginLockoutUntil: Date | null;
        }>
      >`SELECT "id", "passwordHash", "failedLoginAttempts", "loginLockoutUntil"
        FROM "User"
        WHERE "email" = ${normalizedEmail}
        FOR UPDATE`;

      if (!lockedUser) {
        throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
      }

      const now = new Date();
      if (lockedUser.loginLockoutUntil && lockedUser.loginLockoutUntil > now) {
        const remainingMinutes = Math.ceil(
          (lockedUser.loginLockoutUntil.getTime() - now.getTime()) / (60 * 1000)
        );
        throw new AppError('RATE_LIMITED', getLockoutMessage(remainingMinutes), 429);
      }

      let failedAttempts = lockedUser.failedLoginAttempts;
      if (lockedUser.loginLockoutUntil && lockedUser.loginLockoutUntil <= now) {
        await tx.user.update({
          where: { id: lockedUser.id },
          data: {
            failedLoginAttempts: 0,
            loginLockoutUntil: null,
          },
        });
        failedAttempts = 0;
      }

      const isValidPassword = await bcrypt.compare(password, lockedUser.passwordHash);
      if (!isValidPassword) {
        const nextFailedAttempts = failedAttempts + 1;
        const maxAttempts = config.auth.loginLockout.maxAttempts;

        if (nextFailedAttempts >= maxAttempts) {
          const lockMinutes = config.auth.loginLockout.windowMinutes;
          const lockoutUntil = new Date(now.getTime() + lockMinutes * 60 * 1000);

          await tx.user.update({
            where: { id: lockedUser.id },
            data: {
              failedLoginAttempts: nextFailedAttempts,
              loginLockoutUntil: lockoutUntil,
            },
          });

          throw new AppError('RATE_LIMITED', getLockoutMessage(lockMinutes), 429);
        }

        await tx.user.update({
          where: { id: lockedUser.id },
          data: {
            failedLoginAttempts: nextFailedAttempts,
            loginLockoutUntil: null,
          },
        });

        throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
      }

      if (failedAttempts > 0 || lockedUser.loginLockoutUntil) {
        await tx.user.update({
          where: { id: lockedUser.id },
          data: {
            failedLoginAttempts: 0,
            loginLockoutUntil: null,
          },
        });
      }

      const user = await getUserWithFreshAllowance(lockedUser.id, tx);

      const token = this.generateToken(user);
      const refreshToken = await this.createRefreshToken(user.id, tx);

      return {
        user,
        token,
        refreshToken,
      };
    });

    return {
      user: toSafeUser(result.user),
      token: result.token,
      refreshToken: result.refreshToken,
    };
  },

  /**
   * Generate a JWT access token for a user.
   */
  generateToken(user: { id: string; email: string; isAdmin: boolean; tokenVersion: number }): string {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      userId: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
      tokenVersion: user.tokenVersion,
    };

    return jwt.sign(payload, config.auth.jwtSecret, {
      expiresIn: config.auth.jwtExpiresIn as string,
    } as jwt.SignOptions);
  },

  /**
   * Create and store a new refresh token for a user.
   * Returns the raw (unhashed) token to send to the client.
   */
  async createRefreshToken(userId: string, tx?: Prisma.TransactionClient): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.auth.refreshTokenExpiresDays);

    const client = tx ?? prisma;
    await client.user.update({
      where: { id: userId },
      data: {
        refreshTokenHash: hash,
        refreshTokenExpiresAt: expiresAt,
      },
    });

    return raw;
  },

  /**
   * Exchange a refresh token for a new access token.
   * Returns the new access token (and rotates the refresh token).
   */
  async refreshAccessToken(
    rawToken: string
  ): Promise<{ token: string; refreshToken: string; user: SafeUser }> {
    const hash = createHash('sha256').update(rawToken).digest('hex');

    const user = await prisma.user.findUnique({
      where: { refreshTokenHash: hash },
    });

    if (!user || !user.refreshTokenExpiresAt) {
      throw new AppError('TOKEN_INVALID', 'Invalid refresh token', 401);
    }

    if (user.refreshTokenExpiresAt < new Date()) {
      // Clean up expired token
      await prisma.user.update({
        where: { id: user.id },
        data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
      });
      throw new AppError('TOKEN_EXPIRED', 'Refresh token has expired', 401);
    }

    const refreshedUser = await getUserWithFreshAllowance(user.id);

    // Issue new access token and rotate refresh token
    const token = this.generateToken(refreshedUser);
    const newRefreshToken = await this.createRefreshToken(user.id);

    return {
      token,
      refreshToken: newRefreshToken,
      user: toSafeUser(refreshedUser),
    };
  },

  /**
   * Revoke a user's refresh token (logout).
   */
  async revokeRefreshToken(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
    });
  },

  /**
   * Revoke ALL tokens for a user by incrementing tokenVersion.
   * Any existing JWTs with the old tokenVersion will be rejected by requireAuth.
   * Also clears the refresh token so persistent sessions are terminated.
   * Use on password change, account compromise, or forced logout.
   */
  async revokeAllTokens(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        tokenVersion: { increment: 1 },
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
    });
  },

  /**
   * Verify and decode a JWT.
   */
  verifyToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, config.auth.jwtSecret);
      return decoded as JwtPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError('TOKEN_EXPIRED', 'Token has expired', 401);
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError('TOKEN_INVALID', 'Invalid token', 401);
      }
      throw error;
    }
  },

  /**
   * Get a user by ID (without sensitive fields).
   */
  async getUserById(userId: string): Promise<SafeUser | null> {
    try {
      const user = await getUserWithFreshAllowance(userId);
      return toSafeUser(user);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  },

  /**
   * Update user password.
   */
  async updatePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw AppError.notFound('User');
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!isValidPassword) {
      throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect', 401);
    }

    // Hash and save new password; increment tokenVersion to invalidate existing JWTs
    const passwordHash = await bcrypt.hash(newPassword, config.auth.bcryptRounds);

    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
        // Revoke refresh token on password change
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
    });
  },

  /**
   * Hash a password (utility for admin operations).
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, config.auth.bcryptRounds);
  },

  /**
   * Compare a password with a hash (utility for verification).
   */
  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },
};
