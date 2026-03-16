import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRawMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
}));

vi.mock('../services/database.js', () => ({
  prisma: {
    $queryRaw: queryRawMock,
    $transaction: vi.fn(),
  },
}));

vi.mock('../services/ledger.js', () => ({
  LedgerService: {
    credit: vi.fn(),
  },
}));

vi.mock('../services/tokenAllowance.js', () => ({
  TokenAllowanceService: {
    syncToLedgerBalance: vi.fn(),
  },
}));

import { LeaderboardService } from '../services/leaderboard.js';

describe('LeaderboardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a null user rank when the current user is not on the leaderboard yet', async () => {
    queryRawMock
      .mockResolvedValueOnce([
        {
          rank: 1n,
          userId: 'leader_1',
          email: 'leader@example.com',
          totalPredictions: 8,
          wins: 6,
          losses: 2,
          totalPointsWon: 42,
          winRate: 0.75,
          currentStreak: 3,
          longestStreak: 4,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await LeaderboardService.getLeaderboard(
      'WEEKLY',
      '2026-W12',
      20,
      'current_user'
    );

    expect(result).toEqual({
      period: 'WEEKLY',
      periodKey: '2026-W12',
      leaderboard: [
        {
          rank: 1,
          userId: 'leader_1',
          displayName: 'lea***',
          totalPredictions: 8,
          wins: 6,
          losses: 2,
          totalPointsWon: 42,
          winRate: 0.75,
          currentStreak: 3,
          longestStreak: 4,
        },
      ],
      userRank: null,
    });
  });

  it('returns null from findUserRank when no entry exists', async () => {
    queryRawMock.mockResolvedValueOnce([]);

    await expect(
      LeaderboardService.findUserRank('missing_user', 'MONTHLY', '2026-03')
    ).resolves.toBeNull();
  });

  it('keeps getUserRank as a strict lookup for callers that require an entry', async () => {
    queryRawMock.mockResolvedValueOnce([]);

    await expect(
      LeaderboardService.getUserRank('missing_user', 'ALL_TIME', 'all-time')
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Leaderboard entry not found',
      statusCode: 404,
    });
  });
});
