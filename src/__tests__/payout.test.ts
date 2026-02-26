import { describe, it, expect } from 'vitest';
import { calculatePayout } from '../services/events.js';
import { calculateCashoutValue } from '../services/predictions.js';

// =============================================================================
// PAYOUT CALCULATION
// =============================================================================

describe('calculatePayout', () => {
  it('floors the result', () => {
    // 3 tokens × 1.5 odds = 4.5 → floored to 4
    expect(calculatePayout(3, 1.5)).toBe(4);
  });

  it('handles whole-number odds correctly', () => {
    expect(calculatePayout(10, 2)).toBe(20);
    expect(calculatePayout(5, 3)).toBe(15);
  });

  it('returns 0 for zero stake', () => {
    expect(calculatePayout(0, 2.5)).toBe(0);
  });

  it('handles fractional odds below 1', () => {
    // odds < 1 means losing money — payout < stake
    expect(calculatePayout(10, 0.5)).toBe(5);
  });
});

// =============================================================================
// CASHOUT CALCULATION
// =============================================================================

describe('calculateCashoutValue', () => {
  it('applies 5% margin before event starts', () => {
    // stake=10, originalOdds=2.0, currentOdds=2.0 → 10*(2/2)*0.95 = 9
    expect(calculateCashoutValue(10, 2.0, 2.0, false)).toBe(9);
  });

  it('applies 10% margin after event starts', () => {
    // stake=10, originalOdds=2.0, currentOdds=2.0 → 10*(2/2)*0.90 = 9
    expect(calculateCashoutValue(10, 2.0, 2.0, true)).toBe(9);
  });

  it('returns higher cashout when odds have drifted in your favour', () => {
    // originalOdds=3.0, currentOdds=2.0 → odds shortened (you're winning)
    // 10 * (3/2) * 0.95 = 14.25 → 14
    expect(calculateCashoutValue(10, 3.0, 2.0, false)).toBe(14);
  });

  it('returns lower cashout when odds have moved against you', () => {
    // originalOdds=2.0, currentOdds=3.0 → odds lengthened (you're losing)
    // 10 * (2/3) * 0.95 = 6.333... → 6
    expect(calculateCashoutValue(10, 2.0, 3.0, false)).toBe(6);
  });

  it('never returns a negative value', () => {
    // Extremely bad odds movement
    expect(calculateCashoutValue(1, 1.1, 100, false)).toBe(0);
  });

  it('floors fractional results', () => {
    // 7 * (2/2) * 0.95 = 6.65 → 6
    expect(calculateCashoutValue(7, 2.0, 2.0, false)).toBe(6);
  });
});
