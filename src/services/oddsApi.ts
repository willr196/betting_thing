import { config } from '../config/index.js';
import { AppError } from '../utils/index.js';

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
  scores?: Array<{ name: string; score: string }>;
  home_team?: string;
  away_team?: string;
}

const BASE_URL = config.oddsApi.baseUrl;

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

export const OddsApiService = {
  async getOddsForSport(sportKey: string) {
    const url = buildUrl(`/sports/${sportKey}/odds`, {
      regions: config.oddsApi.regions,
      markets: config.oddsApi.markets,
    });

    const response = await fetch(url);
    if (!response.ok) {
      throw AppError.internal(`Odds API error: ${response.status}`);
    }

    return (await response.json()) as Array<{
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
    }>;
  },

  async getEventOdds(sportKey: string, eventId: string): Promise<NormalizedOdds | null> {
    const url = buildUrl(`/sports/${sportKey}/odds`, {
      regions: config.oddsApi.regions,
      markets: config.oddsApi.markets,
      eventIds: eventId,
    });

    const response = await fetch(url);
    if (!response.ok) {
      throw AppError.internal(`Odds API error: ${response.status}`);
    }

    const data = (await response.json()) as Array<{
      id: string;
      bookmakers?: Array<{
        markets?: Array<{
          outcomes?: OddsOutcome[];
        }>;
      }>;
    }>;

    const event = data.find((item) => item.id === eventId);
    if (!event) {
      return null;
    }

    const outcomes = event.bookmakers?.[0]?.markets?.[0]?.outcomes ?? [];
    if (outcomes.length === 0) {
      return null;
    }

    return {
      outcomes,
      updatedAt: new Date().toISOString(),
    };
  },

  async getScores(sportKey: string): Promise<OddsScore[]> {
    const url = buildUrl(`/sports/${sportKey}/scores`, {
      daysFrom: 1,
    });

    const response = await fetch(url);
    if (!response.ok) {
      throw AppError.internal(`Odds API error: ${response.status}`);
    }

    return (await response.json()) as OddsScore[];
  },
};
