import { TransactionType, Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { AppError } from '../utils/index.js';
import type { LedgerEntry, BalanceCheck } from '../types/index.js';

// =============================================================================
// LEDGER SERVICE
// =============================================================================
// This service is the SINGLE source of truth for all token movements.
// Every token change MUST go through this service.
//
// Key invariants:
// 1. TokenTransaction records are NEVER updated or deleted
// 2. User.tokenBalance is a cached value that MUST equal SUM(transactions)
// 3. All operations are atomic (using Prisma transactions)
// 4. Balance can NEVER go negative
// =============================================================================

export const LedgerService = {
  /**
   * Credit tokens to a user's account.
   * Creates a ledger entry and updates cached balance atomically.
   */
  async credit(
    entry: LedgerEntry,
    tx?: Prisma.TransactionClient
  ): Promise<{ transactionId: string; newBalance: number }> {
    if (entry.amount <= 0) {
      throw AppError.badRequest('Credit amount must be positive');
    }

    if (tx) {
      return executeAtomicBalanceChange(tx, entry);
    }

    return prisma.$transaction(async (client) => executeAtomicBalanceChange(client, entry));
  },

  /**
   * Debit tokens from a user's account.
   * Validates sufficient balance, creates ledger entry, updates cached balance.
   * FAILS if balance would go negative.
   */
  async debit(
    entry: LedgerEntry,
    tx?: Prisma.TransactionClient
  ): Promise<{ transactionId: string; newBalance: number }> {
    // Ensure amount is negative for debits
    const debitEntry = {
      ...entry,
      amount: entry.amount > 0 ? -entry.amount : entry.amount,
    };

    if (tx) {
      return executeAtomicBalanceChange(tx, debitEntry);
    }

    return prisma.$transaction(async (client) => executeAtomicBalanceChange(client, debitEntry));
  },

  /**
   * Get a user's current balance.
   * Returns both cached and calculated values for verification.
   */
  async getBalance(userId: string): Promise<{ cached: number; calculated: number }> {
    const [user, aggregate] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { tokenBalance: true },
      }),
      prisma.tokenTransaction.aggregate({
        where: { userId },
        _sum: { amount: true },
      }),
    ]);

    if (!user) {
      throw AppError.notFound('User');
    }

    return {
      cached: user.tokenBalance,
      calculated: aggregate._sum.amount ?? 0,
    };
  },

  /**
   * Verify that a user's cached balance matches their ledger sum.
   * Use this for auditing and debugging.
   */
  async verifyBalance(userId: string): Promise<BalanceCheck> {
    const { cached, calculated } = await this.getBalance(userId);
    
    return {
      userId,
      cachedBalance: cached,
      calculatedBalance: calculated,
      isValid: cached === calculated,
      discrepancy: cached - calculated,
    };
  },

  /**
   * Repair a user's cached balance by recalculating from ledger.
   * Use only in exceptional circumstances after investigation.
   */
  async repairBalance(userId: string): Promise<BalanceCheck> {
    const aggregate = await prisma.tokenTransaction.aggregate({
      where: { userId },
      _sum: { amount: true },
    });

    const calculatedBalance = aggregate._sum.amount ?? 0;

    await prisma.user.update({
      where: { id: userId },
      data: { tokenBalance: calculatedBalance },
    });

    return {
      userId,
      cachedBalance: calculatedBalance,
      calculatedBalance,
      isValid: true,
      discrepancy: 0,
    };
  },

  /**
   * Get transaction history for a user.
   */
  async getHistory(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      types?: TransactionType[];
    } = {}
  ) {
    const { limit = 50, offset = 0, types } = options;

    const where: Prisma.TokenTransactionWhereInput = { userId };
    if (types && types.length > 0) {
      where.type = { in: types };
    }

    const [transactions, total] = await Promise.all([
      prisma.tokenTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.tokenTransaction.count({ where }),
    ]);

    return { transactions, total };
  },

  /**
   * Create signup bonus for a new user.
   * Called during user registration.
   */
  async createSignupBonus(
    userId: string,
    amount: number,
    tx?: Prisma.TransactionClient
  ): Promise<{ transactionId: string; newBalance: number }> {
    return this.credit(
      {
        userId,
        amount,
        type: 'SIGNUP_BONUS',
        description: 'Welcome bonus tokens',
      },
      tx
    );
  },

  /**
   * Debit stake for a prediction.
   * Called when user places a prediction.
   */
  async stakeForPrediction(
    userId: string,
    amount: number,
    predictionId: string,
    tx?: Prisma.TransactionClient
  ): Promise<{ transactionId: string; newBalance: number }> {
    return this.debit(
      {
        userId,
        amount,
        type: 'PREDICTION_STAKE',
        referenceType: 'PREDICTION',
        referenceId: predictionId,
        description: `Stake for prediction ${predictionId}`,
      },
      tx
    );
  },

  /**
   * Credit winnings for a successful prediction.
   * Called during event settlement.
   */
  async creditPredictionWin(
    userId: string,
    amount: number,
    predictionId: string,
    tx?: Prisma.TransactionClient
  ): Promise<{ transactionId: string; newBalance: number }> {
    return this.credit(
      {
        userId,
        amount,
        type: 'PREDICTION_WIN',
        referenceType: 'PREDICTION',
        referenceId: predictionId,
        description: `Winnings for prediction ${predictionId}`,
      },
      tx
    );
  },

  /**
   * Refund stake for a cancelled event.
   * Called when an event is cancelled.
   */
  async refundPrediction(
    userId: string,
    amount: number,
    predictionId: string,
    tx?: Prisma.TransactionClient
  ): Promise<{ transactionId: string; newBalance: number }> {
    return this.credit(
      {
        userId,
        amount,
        type: 'PREDICTION_REFUND',
        referenceType: 'PREDICTION',
        referenceId: predictionId,
        description: `Refund for cancelled prediction ${predictionId}`,
      },
      tx
    );
  },

  /**
   * Debit tokens for reward redemption.
   * Called when user redeems a reward.
   */
  async debitForRedemption(
    userId: string,
    amount: number,
    redemptionId: string,
    tx?: Prisma.TransactionClient
  ): Promise<{ transactionId: string; newBalance: number }> {
    return this.debit(
      {
        userId,
        amount,
        type: 'REDEMPTION',
        referenceType: 'REDEMPTION',
        referenceId: redemptionId,
        description: `Redemption ${redemptionId}`,
      },
      tx
    );
  },
};

// =============================================================================
// INTERNAL HELPER
// =============================================================================

/**
 * Execute an atomic balance change.
 * Creates the transaction record and updates cached balance in a single DB transaction.
 */
async function executeAtomicBalanceChange(
  client: Prisma.TransactionClient,
  entry: LedgerEntry
): Promise<{ transactionId: string; newBalance: number }> {
  const [user] = await client.$queryRaw<
    Array<{ tokenBalance: number }>
  >`SELECT "tokenBalance" FROM "User" WHERE "id" = ${entry.userId} FOR UPDATE`;

  if (!user) {
    throw AppError.notFound('User');
  }

  const newBalance = user.tokenBalance + entry.amount;
  if (newBalance < 0) {
    throw AppError.insufficientBalance(Math.abs(entry.amount), user.tokenBalance);
  }

  const transaction = await client.tokenTransaction.create({
    data: {
      userId: entry.userId,
      amount: entry.amount,
      balanceAfter: newBalance,
      type: entry.type,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      description: entry.description,
    },
  });

  await client.user.update({
    where: { id: entry.userId },
    data: { tokenBalance: newBalance },
    select: { tokenBalance: true },
  });

  return {
    transactionId: transaction.id,
    newBalance,
  };
}
