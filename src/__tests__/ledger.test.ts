import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryRawMock,
  userUpdateMock,
  tokenTransactionCreateMock,
  transactionMock,
} = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  userUpdateMock: vi.fn(),
  tokenTransactionCreateMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock('../services/database.js', () => ({
  prisma: {
    $transaction: transactionMock,
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    tokenTransaction: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { LedgerService } from '../services/ledger.js';

describe('LedgerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: queryRawMock,
        user: { update: userUpdateMock },
        tokenTransaction: { create: tokenTransactionCreateMock },
      })
    );
  });

  it('credits tokens and returns updated balance', async () => {
    queryRawMock.mockResolvedValue([{ tokenBalance: 10 }]);
    tokenTransactionCreateMock.mockResolvedValue({ id: 'tx_credit' });
    userUpdateMock.mockResolvedValue({});

    const result = await LedgerService.credit({
      userId: 'user_1',
      amount: 5,
      type: 'ADMIN_CREDIT',
    });

    expect(result).toEqual({ transactionId: 'tx_credit', newBalance: 15 });
    expect(tokenTransactionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user_1',
          amount: 5,
          balanceAfter: 15,
          type: 'ADMIN_CREDIT',
        }),
      })
    );
    expect(userUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user_1' },
        data: { tokenBalance: 15 },
      })
    );
  });

  it('throws INSUFFICIENT_BALANCE when debiting more than available', async () => {
    queryRawMock.mockResolvedValue([{ tokenBalance: 2 }]);

    await expect(
      LedgerService.debit({
        userId: 'user_1',
        amount: 5,
        type: 'PREDICTION_STAKE',
        referenceType: 'PREDICTION',
        referenceId: 'prediction_1',
      })
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
      statusCode: 400,
    });

    expect(tokenTransactionCreateMock).not.toHaveBeenCalled();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});
