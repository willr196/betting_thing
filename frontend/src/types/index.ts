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
  displayName: string | null;
  tokenBalance: number;
  pointsBalance: number;
  isAdmin: boolean;
  isVerified: boolean;
  showPublicProfile: boolean;
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
// ACCUMULATOR TYPES
// =============================================================================

export type AccumulatorStatus = 'PENDING' | 'WON' | 'LOST' | 'CANCELLED' | 'CASHED_OUT';

export interface AccumulatorLeg {
  id: string;
  accumulatorId: string;
  eventId: string;
  predictedOutcome: string;
  odds: string;
  status: PredictionStatus;
  settledAt: string | null;
  createdAt: string;
  event?: Event;
}

export interface Accumulator {
  id: string;
  userId: string;
  stakeAmount: number;
  combinedOdds: string;
  potentialPayout: number;
  status: AccumulatorStatus;
  payout: number | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
  legs: AccumulatorLeg[];
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
  | 'STREAK_BONUS'
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

export type LeaderboardPeriod = 'weekly' | 'monthly' | 'all-time';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  totalPredictions: number;
  wins: number;
  losses: number;
  totalPointsWon: number;
  winRate: number;
  currentStreak: number;
  longestStreak: number;
}

export interface AchievementUnlocked {
  key: string;
  name: string;
  iconEmoji: string;
}

export interface Achievement {
  key: string;
  name: string;
  description: string;
  iconEmoji: string;
  category: string;
  threshold: number;
  unlockedAt: string | null;
  currentValue: number;
  progress: number;
}

export interface DashboardActivity {
  id: string;
  currency: 'TOKENS' | 'POINTS';
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  createdAt: string;
}

export interface DashboardStats {
  predictionStats: PredictionStats & {
    totalPointsEarned: number;
  };
  streak: {
    current: number;
    longest: number;
  };
  recentActivity: DashboardActivity[];
  allowance: {
    tokensRemaining: number;
    lastRefillAt: string;
    nextRefillAt: string;
    weeklyStartTokens: number;
    dailyAllowance: number;
    maxStack: number;
  };
  achievementProgress: Achievement[];
}

// =============================================================================
// LEAGUES
// =============================================================================

export type LeagueRole = 'OWNER' | 'MEMBER';
export type LeaguePeriod = 'weekly' | 'all-time';

export interface League {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  inviteCode: string;
  isOpen: boolean;
  maxMembers: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeagueMembershipSummary {
  role: LeagueRole;
  joinedAt: string;
}

export interface LeagueWeekSummary {
  rank: number;
  pointsEarned: number;
  totalPredictions: number;
}

export interface LeagueListItem extends League {
  role: LeagueRole;
  joinedAt: string;
  memberCount: number;
  weekly: LeagueWeekSummary | null;
}

export interface LeagueMember {
  userId: string;
  displayName: string;
  role: LeagueRole;
  joinedAt: string;
}

export interface LeagueStandingRow {
  rank: number;
  userId: string;
  displayName: string;
  pointsEarned: number;
  predictionsWon: number;
  predictionsLost: number;
  totalPredictions: number;
  winRate: number;
  updatedAt: string;
}

// =============================================================================
// ADMIN TYPES
// =============================================================================

export interface AdminUser {
  id: string;
  email: string;
  tokenBalance: number;
  pointsBalance: number;
  isAdmin: boolean;
  isVerified: boolean;
  createdAt: string;
  _count: { predictions: number; redemptions: number };
}

export interface AdminStats {
  users: number;
  events: { total: number; open: number; settled: number };
  predictions: number;
  redemptions: { total: number; pending: number };
  tokens: { inCirculation: number };
  points: { inCirculation: number; totalPaidOut: number; totalRedeemed: number };
}

export interface AdminEvent extends Event {
  _count?: { predictions: number };
}

export interface AuditLogEntry {
  id: string;
  adminId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface SettlementStatus {
  isRunning: boolean;
  lastRunAt: string | null;
  lastResult: Record<string, unknown> | null;
}

export interface OddsQuota {
  monthlyQuota: number;
  remainingRequests: number | null;
  remainingPercent: number | null;
  nonEssentialPollingAllowed: boolean;
}

export interface AdminRedemption extends Redemption {
  user?: { email: string };
  reward?: Reward;
}
