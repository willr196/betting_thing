import type {
  ApiResponse,
  AuthResponse,
  User,
  Event,
  EventStats,
  Prediction,
  PredictionStats,
  Accumulator,
  LeaderboardEntry,
  LeaderboardPeriod,
  Achievement,
  AchievementUnlocked,
  DashboardStats,
  TokenTransaction,
  PointsTransaction,
  TokenAllowance,
  Reward,
  Redemption,
  League,
  LeagueListItem,
  LeagueMember,
  LeagueStandingRow,
  LeagueMembershipSummary,
  LeaguePeriod,
  AdminUser,
  AdminStats,
  AdminEvent,
  AuditLogEntry,
  SettlementStatus,
  OddsQuota,
  AdminRedemption,
  AdminEventRestoration,
} from '../types';

// =============================================================================
// API CLIENT
// =============================================================================

// Default to a same-origin API path so Vite's dev proxy can be used.
// Allow overrides (e.g. docker/ngrok) via VITE_API_URL like "http://localhost:3000/api".
const API_BASE = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/+$/, '');
const SESSION_HINT_KEY = 'auth_session_hint';

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type StorageBundle = {
  tokenStorage: StorageLike | null;
  hintStorage: StorageLike | null;
};

function getLocalStorage(): StorageLike | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage ?? null;
}

function getSessionStorage(): StorageLike | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage ?? null;
}

function getDefaultStorageBundle(): StorageBundle {
  const tokenStorage = getSessionStorage() ?? getLocalStorage();
  const hintStorage = getLocalStorage() ?? getSessionStorage();

  return {
    tokenStorage,
    hintStorage,
  };
}

function isStorageBundle(
  value: StorageLike | StorageBundle | null
): value is StorageBundle {
  return value !== null && typeof value === 'object' && 'tokenStorage' in value;
}

export class ApiClient {
  private token: string | null = null;
  private tokenStorage: StorageLike | null;
  private hintStorage: StorageLike | null;
  private isRefreshing = false;

  constructor(storage: StorageLike | StorageBundle | null = getDefaultStorageBundle()) {
    if (isStorageBundle(storage)) {
      this.tokenStorage = storage.tokenStorage;
      this.hintStorage = storage.hintStorage;
      return;
    }

    this.tokenStorage = storage;
    this.hintStorage = storage;
  }

  setToken(token: string | null) {
    this.token = token;
    if (!this.tokenStorage) {
      return;
    }

    if (token) {
      this.tokenStorage.setItem('token', token);
    } else {
      this.tokenStorage.removeItem('token');
    }
  }

  getToken(): string | null {
    if (!this.token && this.tokenStorage) {
      this.token = this.tokenStorage.getItem('token');
    }
    return this.token;
  }

  hasSessionHint(): boolean {
    return this.hintStorage?.getItem(SESSION_HINT_KEY) === '1';
  }

  private markSessionHint() {
    this.hintStorage?.setItem(SESSION_HINT_KEY, '1');
  }

  private clearSessionHint() {
    this.hintStorage?.removeItem(SESSION_HINT_KEY);
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryOnExpiry = true
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const token = this.getToken();
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
        credentials: 'include', // Always include cookies for refresh token
      });
    } catch {
      throw new ApiError(
        'Network error. Please check your connection and try again.',
        'NETWORK_ERROR',
        0
      );
    }

    // On 401 TOKEN_EXPIRED, try to refresh the access token once
    if (response.status === 401 && retryOnExpiry && !this.isRefreshing) {
      let data: ApiResponse<T>;
      try {
        data = await response.json();
      } catch {
        throw new ApiError('Session expired. Please log in again.', 'UNAUTHORIZED', 401);
      }

      if (data.error?.code === 'TOKEN_EXPIRED') {
        try {
          const refreshed = await this.refresh();
          this.setToken(refreshed.token);
          // Retry the original request with the new token
          return this.request<T>(endpoint, options, false);
        } catch {
          // Refresh failed — clear token and signal auth failure
          this.setToken(null);
          throw new ApiError('Session expired. Please log in again.', 'UNAUTHORIZED', 401);
        }
      }

      // 401 for other reasons (e.g. INVALID_CREDENTIALS) — pass through the real error
      this.setToken(null);
      throw new ApiError(
        data.error?.message ?? 'Session expired. Please log in again.',
        data.error?.code ?? 'UNAUTHORIZED',
        401
      );
    }

    // Handle non-401 error responses
    if (response.status === 401) {
      this.setToken(null);
      throw new ApiError('Session expired. Please log in again.', 'UNAUTHORIZED', 401);
    }

    let data: ApiResponse<T>;
    try {
      data = await response.json();
    } catch {
      throw new ApiError(
        'Unexpected server response. Please try again later.',
        'PARSE_ERROR',
        response.status
      );
    }

    if (!data.success) {
      throw new ApiError(
        data.error?.message ?? 'An error occurred',
        data.error?.code ?? 'UNKNOWN_ERROR',
        response.status
      );
    }

    return data.data as T;
  }

  // ===========================================================================
  // AUTH
  // ===========================================================================

  async register(email: string, password: string): Promise<AuthResponse> {
    const data = await this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.markSessionHint();
    this.setToken(data.token);
    return data;
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const data = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.markSessionHint();
    this.setToken(data.token);
    return data;
  }

  /**
   * Attempt to get a new access token using the HTTP-only refresh token cookie.
   * Used on page load when localStorage token is absent/expired.
   */
  async refresh(): Promise<{ token: string; user: User }> {
    this.isRefreshing = true;
    try {
      const data = await this.request<{ token: string; user: User }>(
        '/auth/refresh',
        { method: 'POST' },
        false // Don't retry on failure
      );
      this.markSessionHint();
      this.setToken(data.token);
      return data;
    } catch (error) {
      this.clearSessionHint();
      throw error;
    } finally {
      this.isRefreshing = false;
    }
  }

  async forgotPassword(email: string): Promise<void> {
    await this.request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    return this.request<{ message: string }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async resendVerification(): Promise<{ message: string }> {
    return this.request<{ message: string }>('/auth/resend-verification', {
      method: 'POST',
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    await this.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  }

  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST' }, false);
    } catch {
      // Ignore errors during logout
    } finally {
      this.clearSessionHint();
      this.setToken(null);
    }
  }

  async getMe(): Promise<{ user: User }> {
    return this.request<{ user: User }>('/auth/me');
  }

  async updateProfile(data: {
    email?: string;
    currentPassword?: string;
    displayName?: string | null;
    showPublicProfile?: boolean;
  }): Promise<{ user: User }> {
    return this.request<{ user: User }>('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
    return this.request<{ message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async logoutAll(): Promise<{ message: string }> {
    const data = await this.request<{ message: string }>('/auth/logout-all', {
      method: 'POST',
    });
    this.clearSessionHint();
    this.setToken(null);
    return data;
  }

  async getBalance(): Promise<{ balance: number; verified: boolean }> {
    return this.request<{ balance: number; verified: boolean }>('/auth/balance');
  }

  async getDashboardStats(): Promise<DashboardStats> {
    return this.request<DashboardStats>('/auth/dashboard');
  }

  async getTransactions(
    limit = 50,
    offset = 0
  ): Promise<{ transactions: TokenTransaction[]; total: number }> {
    return this.request<{ transactions: TokenTransaction[]; total: number }>(
      `/auth/transactions?limit=${limit}&offset=${offset}`
    );
  }

  async getTokenAllowance(): Promise<{
    allowance: TokenAllowance;
    balance: number;
    verified: boolean;
  }> {
    return this.request<{ allowance: TokenAllowance; balance: number; verified: boolean }>(
      '/tokens/allowance'
    );
  }

  async getPointsBalance(): Promise<{ balance: number; verified: boolean }> {
    return this.request<{ balance: number; verified: boolean }>('/points/balance');
  }

  async getPointsTransactions(
    limit = 20,
    offset = 0
  ): Promise<{ transactions: PointsTransaction[]; total: number }> {
    return this.request<{ transactions: PointsTransaction[]; total: number }>(
      `/points/transactions?limit=${limit}&offset=${offset}`
    );
  }

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  async getEvents(params?: {
    status?: string;
    upcoming?: boolean;
    sportKey?: string;
    sportKeyPrefix?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ events: Event[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.upcoming) searchParams.set('upcoming', 'true');
    if (params?.sportKey) searchParams.set('sportKey', params.sportKey);
    if (params?.sportKeyPrefix) searchParams.set('sportKeyPrefix', params.sportKeyPrefix);
    if (params?.limit != null) searchParams.set('limit', params.limit.toString());
    if (params?.offset != null) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.request<{ events: Event[]; total: number }>(
      `/events${query ? `?${query}` : ''}`
    );
  }

  async getEvent(id: string): Promise<{ event: Event }> {
    return this.request<{ event: Event }>(`/events/${id}`);
  }

  async getEventStats(id: string): Promise<{ stats: EventStats }> {
    return this.request<{ stats: EventStats }>(`/events/${id}/stats`);
  }

  async getEventOdds(id: string): Promise<{ odds: Event['currentOdds'] }> {
    return this.request<{ odds: Event['currentOdds'] }>(`/events/${id}/odds`);
  }

  // ===========================================================================
  // PREDICTIONS
  // ===========================================================================

  async placePrediction(
    eventId: string,
    predictedOutcome: string,
    stakeAmount: number
  ): Promise<{ prediction: Prediction; achievementsUnlocked?: AchievementUnlocked[] }> {
    return this.request<{ prediction: Prediction; achievementsUnlocked?: AchievementUnlocked[] }>('/predictions', {
      method: 'POST',
      body: JSON.stringify({ eventId, predictedOutcome, stakeAmount }),
    });
  }

  async getMyPredictions(params?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ predictions: Prediction[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit != null) searchParams.set('limit', params.limit.toString());
    if (params?.offset != null) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.request<{ predictions: Prediction[]; total: number }>(
      `/predictions${query ? `?${query}` : ''}`
    );
  }

  async getMyPredictionStats(): Promise<{ stats: PredictionStats }> {
    return this.request<{ stats: PredictionStats }>('/predictions/stats');
  }

  async getCashoutValue(predictionId: string): Promise<{
    predictionId: string;
    cashoutValue: number;
    currentOdds: number;
    updatedAt: string;
  }> {
    return this.request(`/predictions/${predictionId}/cashout-value`);
  }

  async cashoutPrediction(
    predictionId: string
  ): Promise<{ prediction: Prediction; achievementsUnlocked?: AchievementUnlocked[] }> {
    return this.request<{ prediction: Prediction; achievementsUnlocked?: AchievementUnlocked[] }>(`/predictions/${predictionId}/cashout`, {
      method: 'POST',
    });
  }

  // ===========================================================================
  // ACCUMULATORS
  // ===========================================================================

  async placeAccumulator(
    legs: Array<{ eventId: string; predictedOutcome: string }>,
    stakeAmount: number
  ): Promise<{ accumulator: Accumulator }> {
    return this.request<{ accumulator: Accumulator }>('/accumulators', {
      method: 'POST',
      body: JSON.stringify({ legs, stakeAmount }),
    });
  }

  async getMyAccumulators(params?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ accumulators: Accumulator[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit != null) searchParams.set('limit', params.limit.toString());
    if (params?.offset != null) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.request<{ accumulators: Accumulator[]; total: number }>(
      `/accumulators${query ? `?${query}` : ''}`
    );
  }

  async getAccumulator(id: string): Promise<{ accumulator: Accumulator }> {
    return this.request<{ accumulator: Accumulator }>(`/accumulators/${id}`);
  }

  // ===========================================================================
  // LEADERBOARD
  // ===========================================================================

  async getLeaderboard(
    period: LeaderboardPeriod,
    limit = 20
  ): Promise<{
    period: 'WEEKLY' | 'MONTHLY' | 'ALL_TIME';
    periodKey: string;
    leaderboard: LeaderboardEntry[];
    userRank: LeaderboardEntry | null;
  }> {
    const searchParams = new URLSearchParams({
      period,
      limit: String(limit),
    });
    return this.request(`/leaderboard?${searchParams.toString()}`);
  }

  async getMyLeaderboardRank(
    period: LeaderboardPeriod
  ): Promise<{ rank: LeaderboardEntry | null }> {
    const searchParams = new URLSearchParams({ period });
    return this.request(`/leaderboard/me?${searchParams.toString()}`);
  }

  // ===========================================================================
  // LEAGUES
  // ===========================================================================

  async createLeague(data: {
    name: string;
    description?: string;
    emoji?: string;
  }): Promise<{
    league: League;
    membership: LeagueMembershipSummary;
    memberCount: number;
  }> {
    return this.request('/leagues', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getMyLeagues(): Promise<{ leagues: LeagueListItem[] }> {
    return this.request('/leagues');
  }

  async getLeague(leagueId: string): Promise<{
    league: League;
    membership: LeagueMembershipSummary;
    memberCount: number;
  }> {
    return this.request(`/leagues/${leagueId}`);
  }

  async joinLeague(inviteCode: string): Promise<{
    league: League;
    membership: LeagueMembershipSummary;
    memberCount: number;
  }> {
    return this.request('/leagues/join', {
      method: 'POST',
      body: JSON.stringify({ inviteCode }),
    });
  }

  async updateLeague(
    leagueId: string,
    data: {
      name?: string;
      description?: string;
      emoji?: string;
      isOpen?: boolean;
    }
  ): Promise<{
    league: League;
    membership: LeagueMembershipSummary;
    memberCount: number;
  }> {
    return this.request(`/leagues/${leagueId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteLeague(leagueId: string): Promise<{ deleted: boolean }> {
    return this.request(`/leagues/${leagueId}`, {
      method: 'DELETE',
    });
  }

  async leaveLeague(leagueId: string): Promise<{ left: boolean }> {
    return this.request(`/leagues/${leagueId}/leave`, {
      method: 'POST',
    });
  }

  async kickLeagueMember(leagueId: string, targetUserId: string): Promise<{ removed: boolean }> {
    return this.request(`/leagues/${leagueId}/kick/${targetUserId}`, {
      method: 'POST',
    });
  }

  async transferLeagueOwnership(leagueId: string, newOwnerId: string): Promise<{
    league: League;
    membership: LeagueMembershipSummary;
    memberCount: number;
  }> {
    return this.request(`/leagues/${leagueId}/transfer/${newOwnerId}`, {
      method: 'POST',
    });
  }

  async regenerateLeagueInviteCode(leagueId: string): Promise<{ inviteCode: string; inviteUrl: string }> {
    return this.request(`/leagues/${leagueId}/regenerate-code`, {
      method: 'POST',
    });
  }

  async getLeagueMembers(leagueId: string): Promise<{ members: LeagueMember[] }> {
    return this.request(`/leagues/${leagueId}/members`);
  }

  async getLeagueStandings(
    leagueId: string,
    period: LeaguePeriod,
    periodKey?: string
  ): Promise<{
    leagueId: string;
    period: 'WEEKLY' | 'ALL_TIME';
    periodKey: string;
    standings: LeagueStandingRow[];
    requester: LeagueStandingRow | null;
    updatedAt: string | null;
  }> {
    const searchParams = new URLSearchParams({ period });
    if (periodKey) {
      searchParams.set('periodKey', periodKey);
    }
    return this.request(`/leagues/${leagueId}/standings?${searchParams.toString()}`);
  }

  async getLeagueInvite(leagueId: string): Promise<{ inviteCode: string; inviteUrl: string }> {
    return this.request(`/leagues/${leagueId}/invite`);
  }

  // ===========================================================================
  // REWARDS
  // ===========================================================================

  async getRewards(
    limit = 50,
    offset = 0
  ): Promise<{ rewards: Reward[]; total: number }> {
    return this.request<{ rewards: Reward[]; total: number }>(
      `/rewards?limit=${limit}&offset=${offset}`
    );
  }

  async redeemReward(
    rewardId: string
  ): Promise<{ redemption: Redemption; achievementsUnlocked?: AchievementUnlocked[] }> {
    return this.request<{ redemption: Redemption; achievementsUnlocked?: AchievementUnlocked[] }>(`/rewards/${rewardId}/redeem`, {
      method: 'POST',
    });
  }

  async getMyRedemptions(params?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ redemptions: Redemption[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.request<{ redemptions: Redemption[]; total: number }>(
      `/rewards/redemptions${query ? `?${query}` : ''}`
    );
  }

  // ===========================================================================
  // ACHIEVEMENTS
  // ===========================================================================

  async getAchievements(): Promise<{ achievements: Achievement[] }> {
    return this.request<{ achievements: Achievement[] }>('/achievements');
  }

  async getUnlockedAchievements(): Promise<{ achievements: Achievement[] }> {
    return this.request<{ achievements: Achievement[] }>('/achievements/me');
  }

  async getAchievementProgress(limit = 3): Promise<{ next: Achievement[] }> {
    return this.request<{ next: Achievement[] }>(`/achievements/progress?limit=${limit}`);
  }

  // ===========================================================================
  // ADMIN
  // ===========================================================================

  async getAdminStats(): Promise<{ stats: AdminStats }> {
    return this.request<{ stats: AdminStats }>('/admin/stats');
  }

  async getAdminUsers(
    limit = 50,
    offset = 0
  ): Promise<{ users: AdminUser[]; total: number }> {
    return this.request<{ users: AdminUser[]; total: number }>(
      `/admin/users?limit=${limit}&offset=${offset}`
    );
  }

  async getAdminEvents(
    limit = 50,
    offset = 0,
    status?: string
  ): Promise<{ events: AdminEvent[]; total: number }> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (status) params.set('status', status);
    return this.request<{ events: AdminEvent[]; total: number }>(
      `/admin/events?${params.toString()}`
    );
  }

  async createAdminEvent(data: {
    title: string;
    description?: string;
    startsAt: string;
    outcomes: string[];
    payoutMultiplier: number;
    odds: Array<{ name: string; price: number }>;
    detachFromExternalSource?: boolean;
  }): Promise<{ event: Event }> {
    return this.request<{ event: Event }>('/admin/events', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAdminEvent(
    eventId: string,
    data: {
      title?: string;
      description?: string | null;
      startsAt?: string;
      outcomes?: string[];
      payoutMultiplier?: number;
      odds?: Array<{ name: string; price: number }>;
      detachFromExternalSource?: boolean;
    }
  ): Promise<{ event: Event }> {
    return this.request<{ event: Event }>(`/admin/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async lockEvent(eventId: string): Promise<{ event: Event }> {
    return this.request<{ event: Event }>(`/admin/events/${eventId}/lock`, {
      method: 'POST',
    });
  }

  async settleEvent(
    eventId: string,
    finalOutcome: string
  ): Promise<{ settlement: Record<string, unknown> }> {
    return this.request<{ settlement: Record<string, unknown> }>(
      `/admin/events/${eventId}/settle`,
      {
        method: 'POST',
        body: JSON.stringify({ finalOutcome }),
      }
    );
  }

  async cancelEvent(
    eventId: string
  ): Promise<{ cancellation: { refunded: number } }> {
    return this.request<{ cancellation: { refunded: number } }>(
      `/admin/events/${eventId}/cancel`,
      { method: 'POST' }
    );
  }

  async uncancelEvent(
    eventId: string
  ): Promise<{ restoration: AdminEventRestoration }> {
    return this.request<{ restoration: AdminEventRestoration }>(
      `/admin/events/${eventId}/uncancel`,
      { method: 'POST' }
    );
  }

  async autoLockEvents(): Promise<{ locked: number }> {
    return this.request<{ locked: number }>('/admin/events/auto-lock', {
      method: 'POST',
    });
  }

  async triggerEventImport(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/admin/events/import', {
      method: 'POST',
    });
  }

  async importEventsBySport(sportKey: string): Promise<{
    imported: number;
    updated: number;
    skipped: number;
    sport: { key: string; name: string };
  }> {
    return this.request<{
      imported: number;
      updated: number;
      skipped: number;
      sport: { key: string; name: string };
    }>(`/admin/events/import/${encodeURIComponent(sportKey)}`, { method: 'POST' });
  }

  async triggerOddsSync(): Promise<{
    updatedEvents: number;
    quota: OddsQuota;
  }> {
    return this.request<{ updatedEvents: number; quota: OddsQuota }>(
      '/admin/odds/sync',
      { method: 'POST' }
    );
  }

  async getOddsQuota(): Promise<{ quota: OddsQuota }> {
    return this.request<{ quota: OddsQuota }>('/admin/odds/quota');
  }

  async triggerSettlement(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/admin/settlement/run', {
      method: 'POST',
    });
  }

  async getSettlementStatus(): Promise<{ status: SettlementStatus }> {
    return this.request<{ status: SettlementStatus }>(
      '/admin/settlement/status'
    );
  }

  async createAdminReward(data: {
    name: string;
    description?: string;
    pointsCost: number;
    stockLimit?: number;
    imageUrl?: string;
  }): Promise<{ reward: Reward }> {
    return this.request<{ reward: Reward }>('/admin/rewards', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAdminReward(
    id: string,
    data: {
      name?: string;
      description?: string;
      pointsCost?: number;
      stockLimit?: number | null;
      imageUrl?: string | null;
      isActive?: boolean;
    }
  ): Promise<{ reward: Reward }> {
    return this.request<{ reward: Reward }>(`/admin/rewards/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async getAdminRewards(
    limit = 50,
    offset = 0
  ): Promise<{ rewards: Reward[]; total: number }> {
    return this.request<{ rewards: Reward[]; total: number }>(
      `/admin/rewards?limit=${limit}&offset=${offset}`
    );
  }

  async getAdminRedemptions(
    status?: string,
    limit = 50,
    offset = 0
  ): Promise<{ redemptions: AdminRedemption[]; total: number }> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (status) params.set('status', status);
    return this.request<{ redemptions: AdminRedemption[]; total: number }>(
      `/admin/redemptions?${params.toString()}`
    );
  }

  async fulfilRedemption(
    id: string,
    fulfilmentNote?: string
  ): Promise<{ redemption: Redemption }> {
    return this.request<{ redemption: Redemption }>(
      `/admin/redemptions/${id}/fulfil`,
      {
        method: 'POST',
        body: JSON.stringify({ fulfilmentNote }),
      }
    );
  }

  async cancelRedemption(id: string): Promise<{ redemption: Redemption }> {
    return this.request<{ redemption: Redemption }>(
      `/admin/redemptions/${id}/cancel`,
      { method: 'POST' }
    );
  }

  async creditTokens(
    userId: string,
    amount: number,
    description?: string
  ): Promise<{ transaction: TokenTransaction; user: { id: string; tokenBalance: number } }> {
    return this.request<{
      transaction: TokenTransaction;
      user: { id: string; tokenBalance: number };
    }>('/admin/tokens/credit', {
      method: 'POST',
      body: JSON.stringify({ userId, amount, description }),
    });
  }

  async promoteUser(userId: string): Promise<{ user: AdminUser }> {
    return this.request<{ user: AdminUser }>(`/admin/users/${userId}/promote`, { method: 'POST' });
  }

  async demoteUser(userId: string): Promise<{ user: AdminUser }> {
    return this.request<{ user: AdminUser }>(`/admin/users/${userId}/demote`, { method: 'POST' });
  }

  async bulkCreateEvents(events: Array<{
    title: string;
    description?: string;
    startsAt: string;
    outcomes: string[];
    payoutMultiplier: number;
    odds: Array<{ name: string; price: number }>;
  }>): Promise<{ events: Event[]; count: number }> {
    return this.request<{ events: Event[]; count: number }>('/admin/events/bulk', {
      method: 'POST',
      body: JSON.stringify({ events }),
    });
  }

  async getStaleEvents(): Promise<{ events: AdminEvent[]; count: number }> {
    return this.request<{ events: AdminEvent[]; count: number }>('/admin/events/stale');
  }

  async verifyUserBalance(
    userId: string
  ): Promise<{ balance: { cached: number; calculated: number; discrepancy?: number } }> {
    return this.request<{
      balance: { cached: number; calculated: number; discrepancy?: number };
    }>(`/admin/users/${userId}/balance`);
  }

  async repairUserBalance(
    userId: string
  ): Promise<{ balance: Record<string, unknown> }> {
    return this.request<{ balance: Record<string, unknown> }>(
      `/admin/users/${userId}/balance/repair`,
      { method: 'POST' }
    );
  }

  async recalculateLeagues(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      '/admin/leagues/recalculate',
      { method: 'POST' }
    );
  }

  async getAuditLog(
    limit = 50,
    offset = 0
  ): Promise<{ entries: AuditLogEntry[]; total: number }> {
    return this.request<{ entries: AuditLogEntry[]; total: number }>(
      `/admin/audit-log?limit=${limit}&offset=${offset}`
    );
  }
}

// =============================================================================
// ERROR CLASS
// =============================================================================

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const api = new ApiClient();
