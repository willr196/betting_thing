import type { User, Event, Prediction, Reward, Redemption, TokenTransaction, PointsTransaction } from '@prisma/client';
import type { Request } from 'express';

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

// =============================================================================
// AUTH TYPES
// =============================================================================

export interface JwtPayload {
  userId: string;
  email: string;
  isAdmin: boolean;
  tokenVersion: number;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

// Type guard for authenticated requests
export function isAuthenticated(req: Request): req is AuthenticatedRequest {
  return 'user' in req && req.user !== undefined;
}

// =============================================================================
// USER TYPES
// =============================================================================

// Safe user object without password hash, internal version, and refresh token fields
export type SafeUser = Omit<User, 'passwordHash' | 'tokenVersion' | 'refreshTokenHash' | 'refreshTokenExpiresAt'>;

export interface UserWithBalance extends SafeUser {
  tokenBalance: number;
  pointsBalance: number;
}

// =============================================================================
// EVENT TYPES
// =============================================================================

export interface EventWithStats extends Event {
  _count?: {
    predictions: number;
  };
  totalStaked?: number;
}

// =============================================================================
// PREDICTION TYPES
// =============================================================================

export interface PredictionWithEvent extends Prediction {
  event: Event;
}

export interface PredictionWithUser extends Prediction {
  user: SafeUser;
}

// =============================================================================
// LEDGER TYPES
// =============================================================================

export interface LedgerEntry {
  userId: string;
  amount: number;
  type: TokenTransaction['type'];
  referenceType?: string;
  referenceId?: string;
  description?: string;
}

export interface PointsLedgerEntry {
  userId: string;
  amount: number;
  type: PointsTransaction['type'];
  referenceType?: string;
  referenceId?: string;
  description?: string;
}

export interface BalanceCheck {
  userId: string;
  cachedBalance: number;
  calculatedBalance: number;
  isValid: boolean;
  discrepancy: number;
}

// =============================================================================
// SETTLEMENT TYPES
// =============================================================================

export interface SettlementResult {
  eventId: string;
  finalOutcome: string;
  totalPredictions: number;
  winners: number;
  losers: number;
  totalPayout: number;
  settledAt: Date;
}

// =============================================================================
// REDEMPTION TYPES
// =============================================================================

export interface RedemptionWithReward extends Redemption {
  reward: Reward;
}

// =============================================================================
// PAGINATION
// =============================================================================

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  items: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// =============================================================================
// ERROR CODES
// =============================================================================

export const ErrorCodes = {
  // Auth errors
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  
  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  
  // Token/Balance errors
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  BALANCE_MISMATCH: 'BALANCE_MISMATCH',
  
  // Event errors
  EVENT_NOT_OPEN: 'EVENT_NOT_OPEN',
  EVENT_ALREADY_STARTED: 'EVENT_ALREADY_STARTED',
  EVENT_ALREADY_SETTLED: 'EVENT_ALREADY_SETTLED',
  INVALID_OUTCOME: 'INVALID_OUTCOME',
  
  // Prediction errors
  ALREADY_PREDICTED: 'ALREADY_PREDICTED',
  PREDICTION_NOT_FOUND: 'PREDICTION_NOT_FOUND',
  
  // Reward errors
  REWARD_UNAVAILABLE: 'REWARD_UNAVAILABLE',
  REWARD_OUT_OF_STOCK: 'REWARD_OUT_OF_STOCK',
  CASHOUT_UNAVAILABLE: 'CASHOUT_UNAVAILABLE',
  
  // System errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
