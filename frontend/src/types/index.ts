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
// USER TYPES
// =============================================================================

export interface User {
  id: string;
  email: string;
  tokenBalance: number;
  pointsBalance: number;
  isAdmin: boolean;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

// =============================================================================
// EVENT TYPES
// =============================================================================

export type EventStatus = 'OPEN' | 'LOCKED' | 'SETTLED' | 'CANCELLED';

export interface Event {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  status: EventStatus;
  outcomes: string[];
  finalOutcome: string | null;
  payoutMultiplier: number;
  externalEventId?: string | null;
  externalSportKey?: string | null;
  currentOdds?: {
    outcomes: { name: string; price: number }[];
    updatedAt: string;
  } | null;
  oddsUpdatedAt?: string | null;
  createdAt: string;
  _count?: {
    predictions: number;
  };
}

export interface EventStats {
  eventId: string;
  outcomes: {
    outcome: string;
    count: number;
    totalStaked: number;
  }[];
  totalPredictions: number;
  totalStaked: number;
}

// =============================================================================
// PREDICTION TYPES
// =============================================================================

export type PredictionStatus = 'PENDING' | 'WON' | 'LOST' | 'REFUNDED' | 'CASHED_OUT';

export interface Prediction {
  id: string;
  userId: string;
  eventId: string;
  predictedOutcome: string;
  stakeAmount: number;
  status: PredictionStatus;
  payout: number | null;
  originalOdds?: string | null;
  cashedOutAt?: string | null;
  cashoutAmount?: number | null;
  settledAt: string | null;
  createdAt: string;
  event?: Event;
}

export interface PredictionStats {
  total: number;
  won: number;
  lost: number;
  pending: number;
  cashedOut: number;
  winRate: number;
  totalWinnings: number;
  totalStaked: number;
}

// =============================================================================
// TRANSACTION TYPES
// =============================================================================

export type TransactionType =
  | 'DAILY_ALLOWANCE'
  | 'SIGNUP_BONUS'
  | 'PREDICTION_STAKE'
  | 'PREDICTION_WIN'
  | 'PREDICTION_REFUND'
  | 'CASHOUT'
  | 'REDEMPTION'
  | 'REDEMPTION_REFUND'
  | 'PURCHASE'
  | 'ADMIN_CREDIT'
  | 'ADMIN_DEBIT';

export interface TokenTransaction {
  id: string;
  userId: string;
  amount: number;
  balanceAfter: number;
  type: TransactionType;
  referenceType: string | null;
  referenceId: string | null;
  description: string | null;
  createdAt: string;
}

// =============================================================================
// REWARD TYPES
// =============================================================================

export interface Reward {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
  stockLimit: number | null;
  stockClaimed: number;
  isActive: boolean;
  imageUrl: string | null;
  createdAt: string;
}

export type RedemptionStatus = 'PENDING' | 'FULFILLED' | 'CANCELLED';

export interface Redemption {
  id: string;
  userId: string;
  rewardId: string;
  pointsCost: number;
  status: RedemptionStatus;
  fulfilmentNote: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  reward?: Reward;
}

export interface TokenAllowance {
  tokensRemaining: number;
  lastResetDate: string;
}

export interface PointsTransaction {
  id: string;
  userId: string;
  amount: number;
  balanceAfter: number;
  type: 'PREDICTION_WIN' | 'CASHOUT' | 'REDEMPTION' | 'REDEMPTION_REFUND' | 'ADMIN_CREDIT' | 'ADMIN_DEBIT';
  referenceType: string | null;
  referenceId: string | null;
  description: string | null;
  createdAt: string;
}
