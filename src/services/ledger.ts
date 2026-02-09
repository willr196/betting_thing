import { TransactionType, Prisma, type TokenTransaction } from '@prisma/client';
import { prisma } from './database.js';
import { createLedgerService } from './ledgerCore.js';
import type { LedgerEntry } from '../types/index.js';

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

const ledgerCore = createLedgerService<LedgerEntry, TokenTransaction, TransactionType>({
  async getUserBalanceForUpdate(tx, userId) {
    const [user] = await tx.$queryRaw<
      Array<{ tokenBalance: number }>
    >`SELECT "tokenBalance" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    return user?.tokenBalance ?? null;
  },
  async updateUserBalance(tx, userId, newBalance) {
    await tx.user.update({
      where: { id: userId },
      data: { tokenBalance: newBalance },
      select: { tokenBalance: true },
    });
  },
  async createTransaction(tx, entry, newBalance) {
    return tx.tokenTransaction.create({
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
  },
  async getCachedBalance(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenBalance: true },
    });
    return user?.tokenBalance ?? null;
  },
  async aggregateBalance(userId) {
    const aggregate = await prisma.tokenTransaction.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    return aggregate._sum.amount ?? 0;
  },
  async listTransactions(userId, options) {
    const where: Prisma.TokenTransactionWhereInput = { userId };
    if (options.types && options.types.length > 0) {
      where.type = { in: options.types };
    }
    return prisma.tokenTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.limit,
      skip: options.offset,
    });
  },
  async countTransactions(userId, options) {
    const where: Prisma.TokenTransactionWhereInput = { userId };
    if (options.types && options.types.length > 0) {
      where.type = { in: options.types };
    }
    return prisma.tokenTransaction.count({ where });
  },
});

export const LedgerService = {
  ...ledgerCore,

  /**
   * Repair a user's cached balance by recalculating from ledger.
   * Use only in exceptional circumstances after investigation.
   */
  async repairBalance(userId: string) {
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
   * Use only if rewards are token-based.
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
