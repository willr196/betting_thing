import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  creditMock,
  tokenAllowanceCreateMock,
  tokenAllowanceUpsertMock,
  userFindUniqueMock,
  tokenAllowanceFindUniqueMock,
  tokenAllowanceUpdateMock,
  queryRawMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  creditMock: vi.fn(),
  tokenAllowanceCreateMock: vi.fn(),
  tokenAllowanceUpsertMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  tokenAllowanceFindUniqueMock: vi.fn(),
  tokenAllowanceUpdateMock: vi.fn(),
  queryRawMock: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  config: {
    tokens: {
      weeklyStart: 5,
      dailyAllowance: 1,
      maxAllowance: 11,
    },
  },
}));

vi.mock('../services/database.js', () => ({
  prisma: {
    $transaction: transactionMock,
    user: {
      findUnique: userFindUniqueMock,
    },
    tokenAllowance: {
      findUnique: tokenAllowanceFindUniqueMock,
      create: tokenAllowanceCreateMock,
      update: tokenAllowanceUpdateMock,
      upsert: tokenAllowanceUpsertMock,
    },
  },
}));

vi.mock('../services/ledger.js', () => ({
  LedgerService: {
    credit: creditMock,
  },
}));

import { TokenAllowanceService } from '../services/tokenAllowance.js';

describe('TokenAllowanceService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: queryRawMock,
        tokenAllowance: {
          create: tokenAllowanceCreateMock,
          upsert: tokenAllowanceUpsertMock,
        },
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('grants the weekly opening allowance when no allowance record exists', async () => {
    vi.setSystemTime(new Date('2026-03-09T09:15:00.000Z'));

    queryRawMock
      .mockResolvedValueOnce([{ tokenBalance: 0 }])
      .mockResolvedValueOnce([]);
    creditMock.mockResolvedValue({ transactionId: 'tx_credit', newBalance: 5 });
    tokenAllowanceCreateMock.mockResolvedValue({});

    const result = await TokenAllowanceService.getOrCreateStatus('user_1');

    expect(creditMock).toHaveBeenCalledWith(
      {
        userId: 'user_1',
        amount: 5,
        type: 'DAILY_ALLOWANCE',
        description: 'Weekly token allowance',
      },
      expect.anything()
    );
    expect(tokenAllowanceCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user_1',
          tokensRemaining: 5,
          lastResetDate: new Date('2026-03-09T00:00:00.000Z'),
        }),
      })
    );
    expect(result).toEqual({
      tokensRemaining: 5,
      lastResetDate: new Date('2026-03-09T00:00:00.000Z'),
    });
  });

  it('tops the user up to the current weekly entitlement after a week rollover', async () => {
    vi.setSystemTime(new Date('2026-03-18T12:00:00.000Z'));

    queryRawMock
      .mockResolvedValueOnce([{ tokenBalance: 3 }])
      .mockResolvedValueOnce([
        {
          id: 'allowance_1',
          tokensRemaining: 6,
          lastResetDate: new Date('2026-03-15T00:00:00.000Z'),
        },
      ]);
    creditMock.mockResolvedValue({ transactionId: 'tx_credit', newBalance: 7 });
    tokenAllowanceUpsertMock.mockResolvedValue({});

    const result = await TokenAllowanceService.getOrCreateStatus('user_1');

    expect(creditMock).toHaveBeenCalledWith(
      {
        userId: 'user_1',
        amount: 4,
        type: 'DAILY_ALLOWANCE',
        description: 'Weekly token allowance',
      },
      expect.anything()
    );
    expect(tokenAllowanceUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          tokensRemaining: 7,
          lastResetDate: new Date('2026-03-18T00:00:00.000Z'),
        }),
      })
    );
    expect(result).toEqual({
      tokensRemaining: 7,
      lastResetDate: new Date('2026-03-18T00:00:00.000Z'),
    });
  });

  it('adds one token per missed day within the same week', async () => {
    vi.setSystemTime(new Date('2026-03-12T12:00:00.000Z'));

    queryRawMock
      .mockResolvedValueOnce([{ tokenBalance: 6 }])
      .mockResolvedValueOnce([
        {
          id: 'allowance_1',
          tokensRemaining: 6,
          lastResetDate: new Date('2026-03-10T00:00:00.000Z'),
        },
      ]);
    creditMock.mockResolvedValue({ transactionId: 'tx_credit', newBalance: 8 });
    tokenAllowanceUpsertMock.mockResolvedValue({});

    const result = await TokenAllowanceService.getOrCreateStatus('user_1');

    expect(creditMock).toHaveBeenCalledWith(
      {
        userId: 'user_1',
        amount: 2,
        type: 'DAILY_ALLOWANCE',
        description: 'Daily token allowance',
      },
      expect.anything()
    );
    expect(tokenAllowanceUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          tokensRemaining: 8,
          lastResetDate: new Date('2026-03-12T00:00:00.000Z'),
        }),
      })
    );
    expect(result).toEqual({
      tokensRemaining: 8,
      lastResetDate: new Date('2026-03-12T00:00:00.000Z'),
    });
  });

  it('normalizes same-day allowance records without crediting twice', async () => {
    vi.setSystemTime(new Date('2026-03-11T12:00:00.000Z'));

    queryRawMock
      .mockResolvedValueOnce([{ tokenBalance: 9 }])
      .mockResolvedValueOnce([
        {
          id: 'allowance_1',
          tokensRemaining: 7,
          lastResetDate: new Date('2026-03-11T08:30:00.000Z'),
        },
      ]);
    tokenAllowanceUpsertMock.mockResolvedValue({});

    const result = await TokenAllowanceService.getOrCreateStatus('user_1');

    expect(creditMock).not.toHaveBeenCalled();
    expect(tokenAllowanceUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          tokensRemaining: 9,
          lastResetDate: new Date('2026-03-11T00:00:00.000Z'),
        }),
      })
    );
    expect(result).toEqual({
      tokensRemaining: 9,
      lastResetDate: new Date('2026-03-11T00:00:00.000Z'),
    });
  });
});
