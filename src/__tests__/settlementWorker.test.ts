import { describe, it, expect } from 'vitest';
import { determineOutcome } from '../services/settlementWorker.js';
import type { OddsScore } from '../services/oddsApi.js';

// =============================================================================
// OUTCOME DETERMINATION
// =============================================================================

function makeScore(
  team1: string,
  score1: string,
  team2: string,
  score2: string,
  completed = true
): OddsScore {
  return {
    id: 'test-event',
    sport_key: 'soccer_epl',
    completed,
    scores: [
      { name: team1, score: score1 },
      { name: team2, score: score2 },
    ],
  };
}

describe('determineOutcome', () => {
  const outcomes = ['Arsenal', 'Chelsea', 'Draw'];

  it('returns the winner when first team wins', () => {
    const score = makeScore('Arsenal', '2', 'Chelsea', '1');
    expect(determineOutcome(outcomes, score)).toBe('Arsenal');
  });

  it('returns the winner when second team wins', () => {
    const score = makeScore('Arsenal', '0', 'Chelsea', '3');
    expect(determineOutcome(outcomes, score)).toBe('Chelsea');
  });

  it('returns draw outcome when scores are equal', () => {
    const score = makeScore('Arsenal', '1', 'Chelsea', '1');
    expect(determineOutcome(outcomes, score)).toBe('Draw');
  });

  it('returns null when draw outcome is not in the outcomes list', () => {
    const noDrawOutcomes = ['Arsenal', 'Chelsea'];
    const score = makeScore('Arsenal', '1', 'Chelsea', '1');
    expect(determineOutcome(noDrawOutcomes, score)).toBeNull();
  });

  it('returns null when scores are missing', () => {
    const score: OddsScore = {
      id: 'test',
      sport_key: 'soccer_epl',
      completed: true,
      scores: undefined,
    };
    expect(determineOutcome(outcomes, score)).toBeNull();
  });

  it('returns null when scores are not numeric', () => {
    const score = makeScore('Arsenal', 'N/A', 'Chelsea', '1');
    expect(determineOutcome(outcomes, score)).toBeNull();
  });

  it('returns null when winner name does not match any outcome', () => {
    const score = makeScore('Manchester City', '2', 'Chelsea', '0');
    expect(determineOutcome(outcomes, score)).toBeNull();
  });
});

