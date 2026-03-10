import { Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { config } from '../config/index.js';
import { LedgerService } from './ledger.js';
import { AppError } from '../utils/index.js';
import { getStartOfISOWeek } from '../utils/week.js';

// =============================================================================
// TOKEN ALLOWANCE SERVICE
// =============================================================================

function getAllowanceWeekStart(date: Date): Date {
  return getStartOfISOWeek(date);
}

export const TokenAllowanceService = {
  /**
   * Read-mostly status lookup used by internal balance checks.
   */
  async getStatus(userId: string) {
    const weekStart = getAllowanceWeekStart(new Date());
    const [allowance, user] = await Promise.all([
      prisma.tokenAllowance.findUnique({
        where: { userId },
        select: { tokensRemaining: true, lastResetDate: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { tokenBalance: true },
      }),
    ]);

    if (!user) {
      throw AppError.notFound('User');
    }

    if (!allowance) {
      const created = await prisma.tokenAllowance.create({
        data: {
          userId,
          tokensRemaining: user.tokenBalance,
          lastResetDate: weekStart,
        },
        select: { tokensRemaining: true, lastResetDate: true },
      });

      return created;
    }

    if (allowance.tokensRemaining !== user.tokenBalance) {
      const repaired = await prisma.tokenAllowance.update({
        where: { userId },
        data: { tokensRemaining: user.tokenBalance },
        select: { tokensRemaining: true, lastResetDate: true },
      });

      return repaired;
    }

    return {
      tokensRemaining: allowance.tokensRemaining,
      lastResetDate: allowance.lastResetDate,
    };
  },

  /**
   * Read-write: ensures the allowance record exists and is up-to-date,
   * crediting any accrued daily tokens as needed.
   * Use on login, registration, or a dedicated daily-claim endpoint.
   */
  async getOrCreateStatus(userId: string, tx?: Prisma.TransactionClient) {
    if (tx) {
      return ensureAllowance(userId, tx);
    }
    return prisma.$transaction(async (client) => ensureAllowance(userId, client));
  },

  async consumeTokens(
    userId: string,
    amount: number,
    referenceId: string,
    tx?: Prisma.TransactionClient,
    options?: {
      referenceType?: string;
      description?: string;
    }
  ) {
    if (amount <= 0) {
      throw AppError.badRequest('Stake amount must be positive');
    }

    const work = async (client: Prisma.TransactionClient) => {
      const status = await ensureAllowance(userId, client);

      const result = await LedgerService.debit(
        {
          userId,
          amount,
          type: 'PREDICTION_STAKE',
          referenceType: options?.referenceType ?? 'PREDICTION',
          referenceId,
          description: options?.description ?? `Stake for prediction ${referenceId}`,
        },
        client
      );

      await upsertAllowance(client, userId, {
        tokensRemaining: result.newBalance,
        lastResetDate: status.lastResetDate,
      });

      return result;
    };

    if (tx) {
      return work(tx);
    }

    return prisma.$transaction(work);
  },

  async syncToLedgerBalance(userId: string, tx?: Prisma.TransactionClient) {
    const work = async (client: Prisma.TransactionClient) => {
      const [user] = await client.$queryRaw<
        Array<{ tokenBalance: number }>
      >`SELECT "tokenBalance" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;

      if (!user) {
        throw AppError.notFound('User');
      }

      await client.tokenAllowance.upsert({
        where: { userId },
        update: {
          tokensRemaining: user.tokenBalance,
        },
        create: {
          userId,
          tokensRemaining: user.tokenBalance,
          lastResetDate: getAllowanceWeekStart(new Date()),
        },
      });

      return user.tokenBalance;
    };

    if (tx) {
      return work(tx);
    }

    return prisma.$transaction(work);
  },
};

async function ensureAllowance(userId: string, tx: Prisma.TransactionClient) {
  const currentWeekStart = getAllowanceWeekStart(new Date());
  const currentBalance = await lockUserBalanceForUpdate(tx, userId);
  const allowance = await lockAllowanceForUser(tx, userId);

  if (!allowance) {
    const credit = await LedgerService.credit(
      {
        userId,
        amount: config.tokens.maxAllowance,
        type: 'DAILY_ALLOWANCE',
        description: 'Weekly token reset',
      },
      tx
    );

    await tx.tokenAllowance.create({
      data: {
        userId,
        tokensRemaining: credit.newBalance,
        lastResetDate: currentWeekStart,
      },
    });

    return { tokensRemaining: credit.newBalance, lastResetDate: currentWeekStart };
  }

  const normalizedLastResetDate = getAllowanceWeekStart(allowance.lastResetDate);
  const needsWeeklyReset = normalizedLastResetDate.getTime() < currentWeekStart.getTime();

  if (needsWeeklyReset) {
    const tokensToAdd = calculateWeeklyRefill(currentBalance);

    if (tokensToAdd > 0) {
      const credit = await LedgerService.credit(
        {
          userId,
          amount: tokensToAdd,
          type: 'DAILY_ALLOWANCE',
          description: 'Weekly token reset',
        },
        tx
      );

      await upsertAllowance(tx, userId, {
        tokensRemaining: credit.newBalance,
        lastResetDate: currentWeekStart,
      });

      return { tokensRemaining: credit.newBalance, lastResetDate: currentWeekStart };
    }

    await upsertAllowance(tx, userId, {
      tokensRemaining: currentBalance,
      lastResetDate: currentWeekStart,
    });

    return { tokensRemaining: currentBalance, lastResetDate: currentWeekStart };
  }

  if (
    allowance.tokensRemaining !== currentBalance ||
    allowance.lastResetDate.getTime() !== normalizedLastResetDate.getTime()
  ) {
    await upsertAllowance(tx, userId, {
      tokensRemaining: currentBalance,
      lastResetDate: normalizedLastResetDate,
    });
  }

  return { tokensRemaining: currentBalance, lastResetDate: normalizedLastResetDate };
}

async function upsertAllowance(
  tx: Prisma.TransactionClient,
  userId: string,
  data: { tokensRemaining: number; lastResetDate: Date }
) {
  return tx.tokenAllowance.upsert({
    where: { userId },
    update: data,
    create: {
      userId,
      tokensRemaining: data.tokensRemaining,
      lastResetDate: data.lastResetDate,
    },
  });
}

function calculateWeeklyRefill(tokensRemaining: number): number {
  return Math.max(0, config.tokens.maxAllowance - tokensRemaining);
}

async function lockAllowanceForUser(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<{ id: string; tokensRemaining: number; lastResetDate: Date } | null> {
  const [allowance] = await tx.$queryRaw<
    Array<{ id: string; tokensRemaining: number; lastResetDate: Date }>
  >`SELECT "id", "tokensRemaining", "lastResetDate"
    FROM "TokenAllowance"
    WHERE "userId" = ${userId}
    FOR UPDATE`;
  return allowance ?? null;
}

async function lockUserBalanceForUpdate(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<number> {
  const [user] = await tx.$queryRaw<Array<{ tokenBalance: number }>>`
    SELECT "tokenBalance"
    FROM "User"
    WHERE "id" = ${userId}
    FOR UPDATE
  `;

  if (!user) {
    throw AppError.notFound('User');
  }

  return user.tokenBalance;
}
