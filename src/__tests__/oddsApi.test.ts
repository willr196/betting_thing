import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config/index.js';
import { OddsApiService } from '../services/oddsApi.js';

const SPORT_KEY = 'soccer_epl';
const SAMPLE_EVENT_ID = 'event_1';

function makeResponse(data: unknown, remaining = 400) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-requests-remaining': String(remaining),
    },
  });
}

function makeOddsPayload(price = 1.75) {
  return [
    {
      id: SAMPLE_EVENT_ID,
      sport_key: SPORT_KEY,
      commence_time: '2026-03-05T12:00:00.000Z',
      bookmakers: [
        {
          markets: [
            {
              outcomes: [
                { name: 'Team A', price },
                { name: 'Team B', price: 2.4 },
              ],
            },
          ],
        },
      ],
    },
  ];
}

describe('OddsApiService cache', () => {
  beforeEach(() => {
    OddsApiService.clearCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses cached getOddsForSport response within TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(makeOddsPayload()));
    vi.stubGlobal('fetch', fetchMock);

    await OddsApiService.getOddsForSport(SPORT_KEY);
    await OddsApiService.getOddsForSport(SPORT_KEY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches getOddsForSport after TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T10:00:00.000Z'));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(makeOddsPayload(1.8)))
      .mockResolvedValueOnce(makeResponse(makeOddsPayload(1.9)));
    vi.stubGlobal('fetch', fetchMock);

    await OddsApiService.getOddsForSport(SPORT_KEY);
    vi.setSystemTime(Date.now() + config.oddsApi.cacheTtlMs + 1000);
    await OddsApiService.getOddsForSport(SPORT_KEY);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves getEventOdds from cached sport odds without extra API call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(makeOddsPayload()));
    vi.stubGlobal('fetch', fetchMock);

    await OddsApiService.getOddsForSport(SPORT_KEY);
    fetchMock.mockClear();

    const eventOdds = await OddsApiService.getEventOdds(SPORT_KEY, SAMPLE_EVENT_ID);

    expect(eventOdds).not.toBeNull();
    expect(eventOdds?.outcomes.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('includes the requested score lookback window and event ids in score requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await OddsApiService.getScores(SPORT_KEY, {
      daysFrom: 3,
      eventIds: ['event_2', SAMPLE_EVENT_ID],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl).toBe(
      `${config.oddsApi.baseUrl}/sports/${SPORT_KEY}/scores?daysFrom=3&eventIds=event_2%2C${SAMPLE_EVENT_ID}&apiKey=${config.oddsApi.key}`
    );
  });
});
