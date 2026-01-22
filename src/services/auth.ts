import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { prisma } from './database.js';
import { LedgerService } from './ledger.js';
import { TokenAllowanceService } from './tokenAllowance.js';
import { AppError, omit } from '../utils/index.js';
import type { JwtPayload, SafeUser } from '../types/index.js';

// =============================================================================
// AUTH SERVICE
// =============================================================================

export const AuthService = {
  /**
   * Register a new user.
   * Creates user with hashed password and initial token bonus.
   */
  async register(
    email: string,
    password: string
  ): Promise<{ user: SafeUser; token: string }> {
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

      await TokenAllowanceService.getStatus(newUser.id, tx);

      // Return updated user with balance
      return tx.user.findUniqueOrThrow({
        where: { id: newUser.id },
      });
    });

    // Generate JWT
    const token = this.generateToken(user);

    return {
      user: omit(user, ['passwordHash']),
      token,
    };
  },

  /**
   * Authenticate a user with email and password.
   * Returns user and JWT on success.
   */
  async login(
    email: string,
    password: string
  ): Promise<{ user: SafeUser; token: string }> {
    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    // Generate JWT
    const token = this.generateToken(user);

    return {
      user: omit(user, ['passwordHash']),
      token,
    };
  },

  /**
   * Generate a JWT for a user.
   */
  generateToken(user: { id: string; email: string; isAdmin: boolean }): string {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      userId: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
    };

    return jwt.sign(payload, config.auth.jwtSecret, {
      expiresIn: config.auth.jwtExpiresIn,
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
   * Get a user by ID (without password hash).
   */
  async getUserById(userId: string): Promise<SafeUser | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return null;
    }

    return omit(user, ['passwordHash']);
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

    // Hash and save new password
    const passwordHash = await bcrypt.hash(newPassword, config.auth.bcryptRounds);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
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
