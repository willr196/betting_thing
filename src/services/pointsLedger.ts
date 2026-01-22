import { Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { AppError } from '../utils/index.js';
import type { PointsLedgerEntry, BalanceCheck } from '../types/index.js';

// =============================================================================
// POINTS LEDGER SERVICE
// =============================================================================
// Immutable ledger for points. All points changes must go through here.

export const PointsLedgerService = {
  async credit(
    entry: PointsLedgerEntry,
    tx?: Prisma.TransactionClient
  ): Promise<{ transactionId: string; newBalance: number }> {
    if (entry.amount <= 0) {
      throw AppError.badRequest('Credit amount must be positive');
    }

    if (tx) {
      return executeAtomicPointsChange(tx, entry);
    }

    return prisma.$transaction(async (client) => executeAtomicPointsChange(client, entry));
  },

  async debit(
    entry: PointsLedgerEntry,
    tx?: Prisma.TransactionClient
  ): Promise<{ transactionId: string; newBalance: number }> {
    const debitEntry = {
      ...entry,
      amount: entry.amount > 0 ? -entry.amount : entry.amount,
    };

    if (tx) {
      return executeAtomicPointsChange(tx, debitEntry);
    }

    return prisma.$transaction(async (client) => executeAtomicPointsChange(client, debitEntry));
  },

  async getBalance(userId: string): Promise<{ cached: number; calculated: number }> {
    const [user, aggregate] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { pointsBalance: true },
      }),
      prisma.pointsTransaction.aggregate({
        where: { userId },
        _sum: { amount: true },
      }),
    ]);

    if (!user) {
      throw AppError.notFound('User');
    }

    return {
      cached: user.pointsBalance,
      calculated: aggregate._sum.amount ?? 0,
    };
  },

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

  async getHistory(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      types?: PointsLedgerEntry['type'][];
    } = {}
  ) {
    const { limit = 50, offset = 0, types } = options;

    const where: Prisma.PointsTransactionWhereInput = { userId };
    if (types && types.length > 0) {
      where.type = { in: types };
    }

    const [transactions, total] = await Promise.all([
      prisma.pointsTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.pointsTransaction.count({ where }),
    ]);

    return { transactions, total };
  },
};

async function executeAtomicPointsChange(
  client: Prisma.TransactionClient,
  entry: PointsLedgerEntry
): Promise<{ transactionId: string; newBalance: number }> {
  const [user] = await client.$queryRaw<
    Array<{ pointsBalance: number }>
  >`SELECT "pointsBalance" FROM "User" WHERE "id" = ${entry.userId} FOR UPDATE`;

  if (!user) {
    throw AppError.notFound('User');
  }

  const newBalance = user.pointsBalance + entry.amount;
  if (newBalance < 0) {
    throw AppError.insufficientBalance(Math.abs(entry.amount), user.pointsBalance);
  }

  const transaction = await client.pointsTransaction.create({
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
    data: { pointsBalance: newBalance },
    select: { pointsBalance: true },
  });

  return {
    transactionId: transaction.id,
    newBalance,
  };
}
