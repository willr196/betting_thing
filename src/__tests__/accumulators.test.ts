import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

const {
  eventFindManyMock,
  transactionMock,
  tokenConsumeMock,
  tokenSyncMock,
  pointsCreditMock,
  ledgerCreditMock,
} = vi.hoisted(() => ({
  eventFindManyMock: vi.fn(),
  transactionMock: vi.fn(),
  tokenConsumeMock: vi.fn(),
  tokenSyncMock: vi.fn(),
  pointsCreditMock: vi.fn(),
  ledgerCreditMock: vi.fn(),
}));

vi.mock('../services/database.js', () => ({
  prisma: {
    event: {
      findMany: eventFindManyMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock('../services/tokenAllowance.js', () => ({
  TokenAllowanceService: {
    consumeTokens: tokenConsumeMock,
    syncToLedgerBalance: tokenSyncMock,
  },
}));

vi.mock('../services/pointsLedger.js', () => ({
  PointsLedgerService: {
    credit: pointsCreditMock,
  },
}));

vi.mock('../services/ledger.js', () => ({
  LedgerService: {
    credit: ledgerCreditMock,
  },
}));

import { AccumulatorService } from '../services/accumulators.js';

describe('AccumulatorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('places accumulator with duplicate legs on the same event', async () => {
    const startsAt = new Date(Date.now() + 60 * 60 * 1000);
    const queryRawMock = vi.fn().mockResolvedValue([
      { id: 'event_1', status: 'OPEN', startsAt },
    ]);
    const accumulatorCreateMock = vi.fn().mockResolvedValue({
      id: 'acc_1',
      userId: 'user_1',
      stakeAmount: 5,
      potentialPayout: 31,
      legs: [],
    });

    eventFindManyMock.mockResolvedValue([
      {
        id: 'event_1',
        title: 'Match 1',
        status: 'OPEN',
        startsAt,
        outcomes: ['Home', 'Away'],
        payoutMultiplier: 2,
        currentOdds: {
          outcomes: [{ name: 'Home', price: 2.5 }],
        },
      },
    ]);

    transactionMock.mockImplementation(
      async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback({
          $queryRaw: queryRawMock,
          accumulator: { create: accumulatorCreateMock },
        } as unknown as Prisma.TransactionClient)
    );

    tokenConsumeMock.mockResolvedValue({ transactionId: 'tx_1', newBalance: 20 });

    await AccumulatorService.place({
      userId: 'user_1',
      legs: [
        { eventId: 'event_1', predictedOutcome: 'Home' },
        { eventId: 'event_1', predictedOutcome: 'Home' },
      ],
      stakeAmount: 5,
    });

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(accumulatorCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user_1',
          stakeAmount: 5,
          legs: {
            create: expect.arrayContaining([
              expect.objectContaining({ eventId: 'event_1', predictedOutcome: 'Home' }),
              expect.objectContaining({ eventId: 'event_1', predictedOutcome: 'Home' }),
            ]),
          },
        }),
      })
    );
    expect(tokenConsumeMock).toHaveBeenCalledWith(
      'user_1',
      5,
      'acc_1',
      expect.anything(),
      expect.objectContaining({
        referenceType: 'ACCUMULATOR',
      })
    );
  });

  it('settles accumulator as LOST when any leg loses', async () => {
    const accumulatorLegUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const accumulatorFindUniqueMock = vi.fn().mockResolvedValue({
      id: 'acc_1',
      userId: 'user_1',
      status: 'PENDING',
      potentialPayout: 40,
      combinedOdds: { toString: () => '4.00' },
      legs: [{ status: 'WON' }, { status: 'LOST' }],
    });
    const accumulatorUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });

    const tx = {
      accumulatorLeg: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'leg_1', accumulatorId: 'acc_1', predictedOutcome: 'Home' },
          { id: 'leg_2', accumulatorId: 'acc_1', predictedOutcome: 'Away' },
        ]),
        updateMany: accumulatorLegUpdateManyMock,
      },
      accumulator: {
        findUnique: accumulatorFindUniqueMock,
        updateMany: accumulatorUpdateManyMock,
      },
    } as unknown as Prisma.TransactionClient;

    await AccumulatorService.settleLegsForEvent('event_1', 'Home', tx);

    expect(accumulatorUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acc_1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'LOST', payout: 0 }),
      })
    );
    expect(pointsCreditMock).not.toHaveBeenCalled();
  });

  it('settles accumulator as WON and credits points when all legs win', async () => {
    const accumulatorLegUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const accumulatorFindUniqueMock = vi.fn().mockResolvedValue({
      id: 'acc_2',
      userId: 'user_2',
      status: 'PENDING',
      potentialPayout: 96,
      combinedOdds: { toString: () => '9.60' },
      legs: [{ status: 'WON' }, { status: 'WON' }],
    });
    const accumulatorUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });

    const tx = {
      accumulatorLeg: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'leg_3', accumulatorId: 'acc_2', predictedOutcome: 'Home' },
        ]),
        updateMany: accumulatorLegUpdateManyMock,
      },
      accumulator: {
        findUnique: accumulatorFindUniqueMock,
        updateMany: accumulatorUpdateManyMock,
      },
    } as unknown as Prisma.TransactionClient;

    await AccumulatorService.settleLegsForEvent('event_2', 'Home', tx);

    expect(accumulatorUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acc_2', status: 'PENDING' },
        data: expect.objectContaining({ status: 'WON', payout: 96 }),
      })
    );
    expect(pointsCreditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_2',
        amount: 96,
        referenceType: 'ACCUMULATOR',
        referenceId: 'acc_2',
      }),
      tx
    );
  });

  it('cancels accumulator and refunds stake when all legs are cancelled', async () => {
    const accumulatorUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });

    const tx = {
      accumulatorLeg: {
        findMany: vi.fn().mockResolvedValue([{ accumulatorId: 'acc_3' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      accumulator: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'acc_3',
          userId: 'user_3',
          status: 'PENDING',
          stakeAmount: 12,
          legs: [
            { status: 'REFUNDED', odds: { toNumber: () => 2 } },
            { status: 'REFUNDED', odds: { toNumber: () => 1.8 } },
          ],
        }),
        updateMany: accumulatorUpdateManyMock,
      },
    } as unknown as Prisma.TransactionClient;

    await AccumulatorService.cancelLegsForEvent('event_3', tx);

    expect(accumulatorUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acc_3', status: 'PENDING' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      })
    );
    expect(ledgerCreditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_3',
        amount: 12,
        referenceType: 'ACCUMULATOR',
        referenceId: 'acc_3',
      }),
      tx
    );
    expect(tokenSyncMock).toHaveBeenCalledWith('user_3', tx);
  });
});
