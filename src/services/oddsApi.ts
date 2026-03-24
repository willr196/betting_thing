import { config } from '../config/index.js';
import { AppError } from '../utils/index.js';
import { logger } from '../logger.js';

export interface OddsOutcome {
  name: string;
  price: number;
}

export interface NormalizedOdds {
  outcomes: OddsOutcome[];
  updatedAt: string;
}

export interface OddsScore {
  id: string;
  sport_key: string;
  completed: boolean;
  scores?: Array<{ name: string; score: string }> | null;
  home_team?: string;
  away_team?: string;
}

const BASE_URL = config.oddsApi.baseUrl;
const LOW_QUOTA_THRESHOLD = 0.2;
const CRITICAL_QUOTA_THRESHOLD = 0.1;

type SportOddsEvent = {
  id: string;
  sport_key: string;
  commence_time: string;
  bookmakers?: Array<{
    markets?: Array<{
      outcomes?: OddsOutcome[];
    }>;
  }>;
  home_team?: string;
  away_team?: string;
};

type CacheEntry<T> = {
  value: T;
  expiresAtMs: number;
};

const sportOddsCache = new Map<string, CacheEntry<SportOddsEvent[]>>();
const scoresCache = new Map<string, CacheEntry<OddsScore[]>>();
let remainingRequests: number | null = null;

function getScoresCacheKey(
  sportKey: string,
  options: { daysFrom?: number; eventIds?: string[] }
) {
  const daysFrom = options.daysFrom ?? 1;
  const eventIds = options.eventIds?.filter(Boolean).sort().join(',') ?? '';
  return `${sportKey}|daysFrom=${daysFrom}|eventIds=${eventIds}`;
}

function buildUrl(path: string, params: Record<string, string | number | undefined>) {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  url.searchParams.set('apiKey', config.oddsApi.key);
  return url.toString();
}

function getCachedValue<T>(store: Map<string, CacheEntry<T>>, key: string): T | null {
  const cached = store.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAtMs <= Date.now()) {
    store.delete(key);
    return null;
  }

  return cached.value;
}

function setCachedValue<T>(store: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  store.set(key, {
    value,
    expiresAtMs: Date.now() + ttlMs,
  });
}

function updateRemainingRequests(response: Response, endpoint: string) {
  const rawRemaining = response.headers.get('x-requests-remaining');
  if (!rawRemaining) {
    return;
  }

  const parsedRemaining = Number.parseInt(rawRemaining, 10);
  if (!Number.isFinite(parsedRemaining)) {
    return;
  }

  const previousRemaining = remainingRequests;
  remainingRequests = parsedRemaining;

  const monthlyQuota = config.oddsApi.monthlyQuota;
  const remainingRatio = parsedRemaining / monthlyQuota;

  logger.info(
    {
      endpoint,
      remainingRequests: parsedRemaining,
      monthlyQuota,
      remainingPercent: Math.round(remainingRatio * 10000) / 100,
    },
    '[OddsAPI] Requests remaining'
  );

  if (
    remainingRatio <= CRITICAL_QUOTA_THRESHOLD &&
    (previousRemaining === null || previousRemaining / monthlyQuota > CRITICAL_QUOTA_THRESHOLD)
  ) {
    logger.warn(
      { remainingRequests: parsedRemaining, monthlyQuota },
      '[OddsAPI] Quota below 10% - non-essential polling should be paused'
    );
    return;
  }

  if (
    remainingRatio <= LOW_QUOTA_THRESHOLD &&
    (previousRemaining === null || previousRemaining / monthlyQuota > LOW_QUOTA_THRESHOLD)
  ) {
    logger.warn(
      { remainingRequests: parsedRemaining, monthlyQuota },
      '[OddsAPI] Quota below 20%'
    );
  }
}

async function fetchOddsJson<T>(url: string, endpoint: string): Promise<T> {
  const response = await fetch(url);
  updateRemainingRequests(response, endpoint);

  if (!response.ok) {
    throw AppError.internal(`Odds API error: ${response.status}`);
  }

  return (await response.json()) as T;
}

function normalizeEventOdds(event: {
  bookmakers?: Array<{
    markets?: Array<{
      outcomes?: OddsOutcome[];
    }>;
  }>;
}): NormalizedOdds | null {
  const outcomes = event.bookmakers?.[0]?.markets?.[0]?.outcomes ?? [];
  if (outcomes.length === 0) {
    return null;
  }

  return {
    outcomes,
    updatedAt: new Date().toISOString(),
  };
}

export const OddsApiService = {
  getRemainingRequests() {
    return remainingRequests;
  },

  getQuotaStatus() {
    const monthlyQuota = config.oddsApi.monthlyQuota;
    const remaining = remainingRequests;
    const remainingRatio = remaining === null ? null : remaining / monthlyQuota;

    return {
      monthlyQuota,
      remainingRequests: remaining,
      remainingPercent: remainingRatio === null ? null : Math.round(remainingRatio * 10000) / 100,
      nonEssentialPollingAllowed:
        remainingRatio === null ? true : remainingRatio > CRITICAL_QUOTA_THRESHOLD,
    };
  },

  shouldPauseNonEssentialPolling() {
    const monthlyQuota = config.oddsApi.monthlyQuota;
    if (remainingRequests === null) {
      return false;
    }
    return remainingRequests / monthlyQuota <= CRITICAL_QUOTA_THRESHOLD;
  },

  clearCache() {
    sportOddsCache.clear();
    scoresCache.clear();
    logger.info('[OddsAPI] Cleared in-memory odds/scores cache');
  },

  async getOddsForSport(sportKey: string, options: { forceRefresh?: boolean } = {}) {
    if (!options.forceRefresh) {
      const cached = getCachedValue(sportOddsCache, sportKey);
      if (cached) {
        return cached;
      }
    }

    const url = buildUrl(`/sports/${sportKey}/odds`, {
      regions: config.oddsApi.regions,
      markets: config.oddsApi.markets,
    });

    const data = await fetchOddsJson<SportOddsEvent[]>(url, `/sports/${sportKey}/odds`);
    setCachedValue(sportOddsCache, sportKey, data, config.oddsApi.cacheTtlMs);
    return data;
  },

  async getEventOdds(
    sportKey: string,
    eventId: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<NormalizedOdds | null> {
    const data = await this.getOddsForSport(sportKey, options);
    const event = data.find((item) => item.id === eventId);

    if (!event) {
      return null;
    }

    return normalizeEventOdds(event);
  },

  async getScores(
    sportKey: string,
    options: { forceRefresh?: boolean; daysFrom?: number; eventIds?: string[] } = {}
  ): Promise<OddsScore[]> {
    const cacheKey = getScoresCacheKey(sportKey, options);
    const daysFrom = options.daysFrom ?? 1;
    const eventIds = options.eventIds?.filter(Boolean);

    if (!options.forceRefresh) {
      const cached = getCachedValue(scoresCache, cacheKey);
      if (cached) {
        return cached;
      }
    }

    const url = buildUrl(`/sports/${sportKey}/scores`, {
      daysFrom,
      eventIds: eventIds && eventIds.length > 0 ? eventIds.join(',') : undefined,
    });

    const scores = await fetchOddsJson<OddsScore[]>(url, `/sports/${sportKey}/scores`);
    setCachedValue(scoresCache, cacheKey, scores, config.oddsApi.scoresCacheTtlMs);
    return scores;
  },
};
