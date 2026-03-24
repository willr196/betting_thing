import { describe, expect, it } from 'vitest';
import { shouldEnforceCachedOddsFreshnessForTest } from '../services/predictions.js';

describe('prediction odds freshness policy', () => {
  it('does not enforce staleness for local-only events', () => {
    expect(
      shouldEnforceCachedOddsFreshnessForTest({
        id: 'event_local',
        externalSportKey: null,
        externalEventId: null,
        currentOdds: null,
        oddsUpdatedAt: null,
      })
    ).toBe(false);
  });

  it('enforces staleness for externally mapped events', () => {
    expect(
      shouldEnforceCachedOddsFreshnessForTest({
        id: 'event_api',
        externalSportKey: 'soccer_epl',
        externalEventId: 'api_event_1',
        currentOdds: null,
        oddsUpdatedAt: null,
      })
    ).toBe(true);
  });
});
