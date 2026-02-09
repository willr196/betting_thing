import { Prisma, type PointsTransaction } from '@prisma/client';
import { prisma } from './database.js';
import { createLedgerService } from './ledgerCore.js';
import type { PointsLedgerEntry } from '../types/index.js';

// =============================================================================
// POINTS LEDGER SERVICE
// =============================================================================
// Immutable ledger for points. All points changes must go through here.

const pointsLedgerCore = createLedgerService<
  PointsLedgerEntry,
  PointsTransaction,
  PointsLedgerEntry['type']
>({
  async getUserBalanceForUpdate(tx, userId) {
    const [user] = await tx.$queryRaw<
      Array<{ pointsBalance: number }>
    >`SELECT "pointsBalance" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    return user?.pointsBalance ?? null;
  },
  async updateUserBalance(tx, userId, newBalance) {
    await tx.user.update({
      where: { id: userId },
      data: { pointsBalance: newBalance },
      select: { pointsBalance: true },
    });
  },
  async createTransaction(tx, entry, newBalance) {
    return tx.pointsTransaction.create({
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
      select: { pointsBalance: true },
    });
    return user?.pointsBalance ?? null;
  },
  async aggregateBalance(userId) {
    const aggregate = await prisma.pointsTransaction.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    return aggregate._sum.amount ?? 0;
  },
  async listTransactions(userId, options) {
    const where: Prisma.PointsTransactionWhereInput = { userId };
    if (options.types && options.types.length > 0) {
      where.type = { in: options.types };
    }
    return prisma.pointsTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.limit,
      skip: options.offset,
    });
  },
  async countTransactions(userId, options) {
    const where: Prisma.PointsTransactionWhereInput = { userId };
    if (options.types && options.types.length > 0) {
      where.type = { in: options.types };
    }
    return prisma.pointsTransaction.count({ where });
  },
});

export const PointsLedgerService = {
  ...pointsLedgerCore,
};
