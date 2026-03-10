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
      dailyAllowance: 5,
      maxAllowance: 35,
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

  it('tops users back up to the weekly cap after Sunday has passed', async () => {
    vi.setSystemTime(new Date('2026-03-09T00:05:00.000Z'));

    queryRawMock
      .mockResolvedValueOnce([{ tokenBalance: 12 }])
      .mockResolvedValueOnce([
        {
          id: 'allowance_1',
          tokensRemaining: 12,
          lastResetDate: new Date('2026-03-02T00:00:00.000Z'),
        },
      ]);
    creditMock.mockResolvedValue({ transactionId: 'tx_credit', newBalance: 35 });
    tokenAllowanceUpsertMock.mockResolvedValue({});

    const result = await TokenAllowanceService.getOrCreateStatus('user_1');

    expect(creditMock).toHaveBeenCalledWith(
      {
        userId: 'user_1',
        amount: 23,
        type: 'DAILY_ALLOWANCE',
        description: 'Weekly token reset',
      },
      expect.anything()
    );
    expect(tokenAllowanceUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          tokensRemaining: 35,
          lastResetDate: new Date('2026-03-09T00:00:00.000Z'),
        }),
      })
    );
    expect(result).toEqual({
      tokensRemaining: 35,
      lastResetDate: new Date('2026-03-09T00:00:00.000Z'),
    });
  });

  it('normalizes same-week allowance records without crediting twice', async () => {
    vi.setSystemTime(new Date('2026-03-11T12:00:00.000Z'));

    queryRawMock
      .mockResolvedValueOnce([{ tokenBalance: 19 }])
      .mockResolvedValueOnce([
        {
          id: 'allowance_1',
          tokensRemaining: 17,
          lastResetDate: new Date('2026-03-11T08:30:00.000Z'),
        },
      ]);
    tokenAllowanceUpsertMock.mockResolvedValue({});

    const result = await TokenAllowanceService.getOrCreateStatus('user_1');

    expect(creditMock).not.toHaveBeenCalled();
    expect(tokenAllowanceUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          tokensRemaining: 19,
          lastResetDate: new Date('2026-03-09T00:00:00.000Z'),
        }),
      })
    );
    expect(result).toEqual({
      tokensRemaining: 19,
      lastResetDate: new Date('2026-03-09T00:00:00.000Z'),
    });
  });
});
