import { describe, expect, it } from 'vitest';
import { calculateWinRatePercent, calculateWinRateRatio } from '../utils/winRate.js';

describe('win rate helpers', () => {
  it('returns zero when there are no resolved predictions', () => {
    expect(calculateWinRateRatio(0, 0)).toBe(0);
    expect(calculateWinRatePercent(0, 0)).toBe(0);
  });

  it('uses settled wins and losses as the denominator', () => {
    expect(calculateWinRateRatio(7, 3)).toBe(0.7);
    expect(calculateWinRatePercent(7, 3)).toBe(70);
  });

  it('rounds ratio and percent outputs predictably', () => {
    expect(calculateWinRateRatio(2, 1)).toBe(0.6667);
    expect(calculateWinRatePercent(2, 1)).toBe(66.67);
  });
});
