import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  ledgerDebitMock,
  tokenSyncMock,
  restoreAccumulatorMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  ledgerDebitMock: vi.fn(),
  tokenSyncMock: vi.fn(),
  restoreAccumulatorMock: vi.fn(),
}));

vi.mock('../services/database.js', () => ({
  prisma: {
    $transaction: transactionMock,
  },
}));

vi.mock('../services/ledger.js', () => ({
  LedgerService: {
    debit: ledgerDebitMock,
  },
}));

vi.mock('../services/tokenAllowance.js', () => ({
  TokenAllowanceService: {
    syncToLedgerBalance: tokenSyncMock,
  },
}));

vi.mock('../services/accumulators.js', () => ({
  AccumulatorService: {
    restoreCancelledLegsForEvent: restoreAccumulatorMock,
  },
}));

import { EventService } from '../services/events.js';

describe('EventService.uncancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ledgerDebitMock.mockResolvedValue({ transactionId: 'txn_1', newBalance: 5 });
    tokenSyncMock.mockResolvedValue(5);
    restoreAccumulatorMock.mockResolvedValue({
      restoredLegs: 0,
      restoredAccumulators: 0,
      affectedUserIds: [],
    });
  });

  it('restores refunded predictions and reopens a future event', async () => {
    const futureStartsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const tx = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([
          { id: 'event_1', status: 'CANCELLED', startsAt: futureStartsAt },
        ])
        .mockResolvedValueOnce([
          { id: 'prediction_1', userId: 'user_1', stakeAmount: 5, status: 'REFUNDED' },
        ]),
      prediction: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      event: {
        update: vi.fn().mockResolvedValue({ id: 'event_1' }),
      },
    };

    transactionMock.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) =>
      callback(tx)
    );

    const result = await EventService.uncancel('event_1');

    expect(tx.prediction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prediction_1', status: 'REFUNDED' },
        data: expect.objectContaining({
          status: 'PENDING',
          payout: null,
          settledAt: null,
        }),
      })
    );
    expect(ledgerDebitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        amount: 5,
        type: 'PREDICTION_STAKE',
        referenceType: 'PREDICTION',
        referenceId: 'prediction_1',
      }),
      tx
    );
    expect(tx.event.update).toHaveBeenCalledWith({
      where: { id: 'event_1' },
      data: {
        status: 'OPEN',
        settledBy: null,
        settledAt: null,
      },
    });
    expect(tokenSyncMock).toHaveBeenCalledWith('user_1', tx);
    expect(result).toEqual({
      restoredStatus: 'OPEN',
      restoredPredictions: 1,
      restoredAccumulators: 0,
    });
  });

  it('rejects uncancel requests for events that are not cancelled', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValueOnce([
        { id: 'event_2', status: 'OPEN', startsAt: new Date(Date.now() + 1000) },
      ]),
    };

    transactionMock.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) =>
      callback(tx)
    );

    await expect(EventService.uncancel('event_2')).rejects.toThrow(
      'Cannot uncancel event with status OPEN'
    );

    expect(ledgerDebitMock).not.toHaveBeenCalled();
    expect(restoreAccumulatorMock).not.toHaveBeenCalled();
    expect(tokenSyncMock).not.toHaveBeenCalled();
  });
});
