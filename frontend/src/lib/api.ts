import type {
  ApiResponse,
  AuthResponse,
  User,
  Event,
  EventStats,
  Prediction,
  PredictionStats,
  TokenTransaction,
  TokenAllowance,
  Reward,
  Redemption,
} from '../types';

// =============================================================================
// API CLIENT
// =============================================================================

const API_BASE = '/api';

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('token');
    }
    return this.token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const token = this.getToken();
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    const data: ApiResponse<T> = await response.json();

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
    this.setToken(data.token);
    return data;
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const data = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(data.token);
    return data;
  }

  async getMe(): Promise<{ user: User }> {
    return this.request<{ user: User }>('/auth/me');
  }

  async getBalance(): Promise<{ balance: number; verified: boolean }> {
    return this.request<{ balance: number; verified: boolean }>('/auth/balance');
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

  logout() {
    this.setToken(null);
  }

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  async getEvents(params?: {
    status?: string;
    upcoming?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ events: Event[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.upcoming) searchParams.set('upcoming', 'true');
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());
    
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
  ): Promise<{ prediction: Prediction }> {
    return this.request<{ prediction: Prediction }>('/predictions', {
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
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());
    
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

  async cashoutPrediction(predictionId: string): Promise<{ prediction: Prediction }> {
    return this.request<{ prediction: Prediction }>(`/predictions/${predictionId}/cashout`, {
      method: 'POST',
    });
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

  async redeemReward(rewardId: string): Promise<{ redemption: Redemption }> {
    return this.request<{ redemption: Redemption }>(`/rewards/${rewardId}/redeem`, {
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
