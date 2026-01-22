import { Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { config } from '../config/index.js';
import { LedgerService } from './ledger.js';
import { AppError } from '../utils/index.js';

// =============================================================================
// TOKEN ALLOWANCE SERVICE
// =============================================================================

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export const TokenAllowanceService = {
  async getStatus(userId: string, tx?: Prisma.TransactionClient) {
    if (tx) {
      return ensureAllowance(userId, tx);
    }
    return prisma.$transaction(async (client) => ensureAllowance(userId, client));
  },

  async consumeTokens(userId: string, amount: number, referenceId: string, tx?: Prisma.TransactionClient) {
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
          referenceType: 'PREDICTION',
          referenceId,
          description: `Stake for prediction ${referenceId}`,
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
};

async function ensureAllowance(userId: string, tx: Prisma.TransactionClient) {
  const today = startOfUtcDay(new Date());

  const [allowance] = await tx.$queryRaw<
    Array<{ id: string; tokensRemaining: number; lastResetDate: Date }>
  >`SELECT "id", "tokensRemaining", "lastResetDate"
    FROM "TokenAllowance"
    WHERE "userId" = ${userId}
    FOR UPDATE`;

  if (!allowance) {
    const credit = await LedgerService.credit(
      {
        userId,
        amount: config.tokens.dailyAllowance,
        type: 'DAILY_ALLOWANCE',
        description: 'Daily token allowance',
      },
      tx
    );

    await tx.tokenAllowance.create({
      data: {
        userId,
        tokensRemaining: credit.newBalance,
        lastResetDate: today,
      },
    });

    return { tokensRemaining: credit.newBalance, lastResetDate: today };
  }

  const daysSinceReset = daysBetween(startOfUtcDay(allowance.lastResetDate), today);

  if (daysSinceReset > 0) {
    const tokensToAdd = Math.min(
      daysSinceReset * config.tokens.dailyAllowance,
      Math.max(0, config.tokens.maxAllowance - allowance.tokensRemaining)
    );

    if (tokensToAdd > 0) {
      const credit = await LedgerService.credit(
        {
          userId,
          amount: tokensToAdd,
          type: 'DAILY_ALLOWANCE',
          description: 'Daily token allowance',
        },
        tx
      );

      await upsertAllowance(tx, userId, {
        tokensRemaining: credit.newBalance,
        lastResetDate: today,
      });

      return { tokensRemaining: credit.newBalance, lastResetDate: today };
    }

    await upsertAllowance(tx, userId, {
      tokensRemaining: allowance.tokensRemaining,
      lastResetDate: today,
    });
  }

  return { tokensRemaining: allowance.tokensRemaining, lastResetDate: allowance.lastResetDate };
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
