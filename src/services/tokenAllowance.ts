import { Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { config } from '../config/index.js';
import { LedgerService } from './ledger.js';
import { AppError } from '../utils/index.js';
import { getStartOfISOWeek } from '../utils/week.js';

// =============================================================================
// TOKEN ALLOWANCE SERVICE
// =============================================================================

const MS_IN_DAY = 24 * 60 * 60 * 1000;

function getAllowanceDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function getAllowanceWeekStart(date: Date): Date {
  return getStartOfISOWeek(date);
}

export function getNextAllowanceRefillAt(date: Date = new Date()): Date {
  const next = getAllowanceDayStart(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export const TokenAllowanceService = {
  /**
   * Read-mostly status lookup used by internal balance checks.
   */
  async getStatus(userId: string) {
    const dayStart = getAllowanceDayStart(new Date());
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
          lastResetDate: dayStart,
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
        tokensRemaining: Math.max(0, status.tokensRemaining - amount),
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
          lastResetDate: getAllowanceDayStart(new Date()),
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
  const currentDayStart = getAllowanceDayStart(new Date());
  const currentWeekStart = getAllowanceWeekStart(currentDayStart);
  const currentBalance = await lockUserBalanceForUpdate(tx, userId);
  const allowance = await lockAllowanceForUser(tx, userId);

  if (!allowance) {
    const initialEntitlement = calculateCurrentWeekEntitlement(currentDayStart);
    const initialCredit = Math.max(0, initialEntitlement - currentBalance);
    const newBalance = await creditAllowanceIfNeeded(
      tx,
      userId,
      currentBalance,
      initialCredit,
      'Weekly token allowance'
    );

    await tx.tokenAllowance.create({
      data: {
        userId,
        tokensRemaining: newBalance,
        lastResetDate: currentDayStart,
      },
    });

    return { tokensRemaining: newBalance, lastResetDate: currentDayStart };
  }

  const normalizedLastResetDate = getAllowanceDayStart(allowance.lastResetDate);
  const lastWeekStart = getAllowanceWeekStart(normalizedLastResetDate);
  const elapsedDays = getElapsedDays(normalizedLastResetDate, currentDayStart);

  if (lastWeekStart.getTime() < currentWeekStart.getTime()) {
    const weeklyEntitlement = calculateCurrentWeekEntitlement(currentDayStart);
    const tokensToAdd = Math.max(0, weeklyEntitlement - currentBalance);
    const newBalance = await creditAllowanceIfNeeded(
      tx,
      userId,
      currentBalance,
      tokensToAdd,
      'Weekly token allowance'
    );

    await upsertAllowance(tx, userId, {
      tokensRemaining: newBalance,
      lastResetDate: currentDayStart,
    });

    return { tokensRemaining: newBalance, lastResetDate: currentDayStart };
  }

  if (elapsedDays > 0) {
    const tokensToAdd = calculateDailyAccrual(elapsedDays, currentBalance);
    const newBalance = await creditAllowanceIfNeeded(
      tx,
      userId,
      currentBalance,
      tokensToAdd,
      'Daily token allowance'
    );

    await upsertAllowance(tx, userId, {
      tokensRemaining: newBalance,
      lastResetDate: currentDayStart,
    });

    return { tokensRemaining: newBalance, lastResetDate: currentDayStart };
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

function calculateDailyAccrual(elapsedDays: number, tokensRemaining: number): number {
  if (elapsedDays <= 0) {
    return 0;
  }

  const availableHeadroom = Math.max(0, config.tokens.maxAllowance - tokensRemaining);
  return Math.min(availableHeadroom, elapsedDays * config.tokens.dailyAllowance);
}

function calculateCurrentWeekEntitlement(currentDayStart: Date): number {
  const weekStart = getAllowanceWeekStart(currentDayStart);
  const elapsedDaysInWeek = getElapsedDays(weekStart, currentDayStart);
  return Math.min(
    config.tokens.maxAllowance,
    config.tokens.weeklyStart + elapsedDaysInWeek * config.tokens.dailyAllowance
  );
}

function getElapsedDays(previousDayStart: Date, currentDayStart: Date): number {
  return Math.max(0, Math.floor((currentDayStart.getTime() - previousDayStart.getTime()) / MS_IN_DAY));
}

async function creditAllowanceIfNeeded(
  tx: Prisma.TransactionClient,
  userId: string,
  currentBalance: number,
  tokensToAdd: number,
  description: string
): Promise<number> {
  if (tokensToAdd <= 0) {
    return currentBalance;
  }

  const credit = await LedgerService.credit(
    {
      userId,
      amount: tokensToAdd,
      type: 'DAILY_ALLOWANCE',
      description,
    },
    tx
  );

  return credit.newBalance;
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
