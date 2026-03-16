import { Prisma, TransactionType as PrismaTransactionType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from './database.js';
import { LedgerService } from './ledger.js';
import { TokenAllowanceService } from './tokenAllowance.js';
import { AppError } from '../utils/index.js';
import { calculateWinRateRatio } from '../utils/winRate.js';

type RankedLeaderboardRow = {
  rank: number | bigint;
  userId: string;
  email: string;
  totalPredictions: number;
  wins: number;
  losses: number;
  totalPointsWon: number;
  winRate: number;
  currentStreak: number;
  longestStreak: number;
};

type LeaderboardPeriod = 'WEEKLY' | 'MONTHLY' | 'ALL_TIME';

type LeaderboardRecord = {
  totalPredictions: number;
  wins: number;
  losses: number;
  totalPointsWon: number;
  winRate: number;
  currentStreak: number;
  longestStreak: number;
};

function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function toLeaderboardEntry(row: RankedLeaderboardRow) {
  return {
    rank: toNumber(row.rank),
    userId: row.userId,
    displayName: anonymizeEmail(row.email),
    totalPredictions: row.totalPredictions,
    wins: row.wins,
    losses: row.losses,
    totalPointsWon: row.totalPointsWon,
    winRate: row.winRate,
    currentStreak: row.currentStreak,
    longestStreak: row.longestStreak,
  };
}

function anonymizeEmail(email: string): string {
  const localPart = email.split('@')[0] ?? email;
  const prefix = localPart.slice(0, 3);
  return `${prefix}***`;
}

function formatIsoWeekKey(date: Date): string {
  // ISO week-year + week number (YYYY-WXX)
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function formatMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function periodKeyFor(period: LeaderboardPeriod, now = new Date()): string {
  if (period === 'WEEKLY') {
    return formatIsoWeekKey(now);
  }
  if (period === 'MONTHLY') {
    return formatMonthKey(now);
  }
  return 'all-time';
}

function streakBonusFor(streak: number): number {
  if (streak === 10) return 10;
  if (streak === 5) return 5;
  if (streak === 3) return 2;
  return 0;
}

function supportsStreakBonusType(): boolean {
  return (Object.values(PrismaTransactionType) as string[]).includes('STREAK_BONUS');
}

async function updateLeaderboardPeriod(
  tx: Prisma.TransactionClient,
  userId: string,
  period: LeaderboardPeriod,
  won: boolean,
  pointsWon: number,
  now: Date
): Promise<{ currentStreak: number }> {
  const periodKey = periodKeyFor(period, now);
  const [existing] = await tx.$queryRaw<Array<LeaderboardRecord>>`
    SELECT
      "totalPredictions",
      "wins",
      "losses",
      "totalPointsWon",
      "winRate",
      "currentStreak",
      "longestStreak"
    FROM "Leaderboard"
    WHERE "userId" = ${userId}
      AND "period" = ${period}::"LeaderboardPeriod"
      AND "periodKey" = ${periodKey}
    LIMIT 1
  `;

  const totalPredictions = (existing?.totalPredictions ?? 0) + 1;
  const wins = (existing?.wins ?? 0) + (won ? 1 : 0);
  const losses = (existing?.losses ?? 0) + (won ? 0 : 1);
  const totalPointsWon = (existing?.totalPointsWon ?? 0) + pointsWon;
  const currentStreak = won ? (existing?.currentStreak ?? 0) + 1 : 0;
  const longestStreak = Math.max(existing?.longestStreak ?? 0, currentStreak);
  const winRate = calculateWinRateRatio(wins, losses);

  await tx.$executeRaw`
    INSERT INTO "Leaderboard" (
      "id",
      "userId",
      "period",
      "periodKey",
      "totalPredictions",
      "wins",
      "losses",
      "totalPointsWon",
      "winRate",
      "currentStreak",
      "longestStreak",
      "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${userId},
      ${period}::"LeaderboardPeriod",
      ${periodKey},
      ${totalPredictions},
      ${wins},
      ${losses},
      ${totalPointsWon},
      ${winRate},
      ${currentStreak},
      ${longestStreak},
      NOW()
    )
    ON CONFLICT ("userId", "period", "periodKey")
    DO UPDATE SET
      "totalPredictions" = EXCLUDED."totalPredictions",
      "wins" = EXCLUDED."wins",
      "losses" = EXCLUDED."losses",
      "totalPointsWon" = EXCLUDED."totalPointsWon",
      "winRate" = EXCLUDED."winRate",
      "currentStreak" = EXCLUDED."currentStreak",
      "longestStreak" = EXCLUDED."longestStreak",
      "updatedAt" = NOW()
  `;

  return { currentStreak };
}

async function findUserRank(
  userId: string,
  period: LeaderboardPeriod,
  periodKey = periodKeyFor(period)
) {
  const [row] = await prisma.$queryRaw<Array<RankedLeaderboardRow>>`
    WITH ranked AS (
      SELECT
        lb."userId",
        u."email",
        lb."totalPredictions",
        lb."wins",
        lb."losses",
        lb."totalPointsWon",
        lb."winRate",
        lb."currentStreak",
        lb."longestStreak",
        ROW_NUMBER() OVER (
          ORDER BY
            lb."totalPointsWon" DESC,
            lb."wins" DESC,
            lb."winRate" DESC,
            lb."userId" ASC
        ) AS "rank"
      FROM "Leaderboard" lb
      INNER JOIN "User" u ON u."id" = lb."userId"
      WHERE lb."period" = ${period}::"LeaderboardPeriod"
        AND lb."periodKey" = ${periodKey}
    )
    SELECT *
    FROM ranked
    WHERE "userId" = ${userId}
    LIMIT 1
  `;

  if (!row) {
    return null;
  }

  return {
    ...toLeaderboardEntry(row),
    period,
    periodKey,
  };
}

export const LeaderboardService = {
  async updateAfterSettlement(
    userId: string,
    won: boolean,
    pointsWon: number,
    tx?: Prisma.TransactionClient
  ): Promise<{ bonusAwarded: number; streak: number }> {
    const work = async (client: Prisma.TransactionClient) => {
      const now = new Date();
      const periods: LeaderboardPeriod[] = ['WEEKLY', 'MONTHLY', 'ALL_TIME'];

      let allTimeStreak = 0;
      for (const period of periods) {
        const updated = await updateLeaderboardPeriod(client, userId, period, won, pointsWon, now);
        if (period === 'ALL_TIME') {
          allTimeStreak = updated.currentStreak;
        }
      }

      const bonusAwarded = won ? streakBonusFor(allTimeStreak) : 0;
      if (bonusAwarded > 0) {
        const ledgerType = supportsStreakBonusType() ? 'STREAK_BONUS' : 'ADMIN_CREDIT';
        await LedgerService.credit(
          {
            userId,
            amount: bonusAwarded,
            type: ledgerType as never,
            description: `${allTimeStreak}-win streak bonus!`,
          },
          client
        );
        await TokenAllowanceService.syncToLedgerBalance(userId, client);
      }

      return { bonusAwarded, streak: allTimeStreak };
    };

    if (tx) {
      return work(tx);
    }

    return prisma.$transaction(work);
  },

  async getLeaderboard(
    period: LeaderboardPeriod,
    periodKey = periodKeyFor(period),
    requestedLimit = 20,
    currentUserId?: string
  ) {
    const limit = Math.min(Math.max(requestedLimit, 1), 100);

    const rows = await prisma.$queryRaw<Array<RankedLeaderboardRow>>`
      WITH ranked AS (
        SELECT
          lb."userId",
          u."email",
          lb."totalPredictions",
          lb."wins",
          lb."losses",
          lb."totalPointsWon",
          lb."winRate",
          lb."currentStreak",
          lb."longestStreak",
          ROW_NUMBER() OVER (
            ORDER BY
              lb."totalPointsWon" DESC,
              lb."wins" DESC,
              lb."winRate" DESC,
              lb."userId" ASC
          ) AS "rank"
        FROM "Leaderboard" lb
        INNER JOIN "User" u ON u."id" = lb."userId"
        WHERE lb."period" = ${period}::"LeaderboardPeriod"
          AND lb."periodKey" = ${periodKey}
      )
      SELECT *
      FROM ranked
      ORDER BY "rank"
      LIMIT ${limit}
    `;

    const leaderboard = rows.map(toLeaderboardEntry);

    const userRank = currentUserId
      ? await findUserRank(currentUserId, period, periodKey)
      : null;

    return {
      period,
      periodKey,
      leaderboard,
      userRank,
    };
  },

  async findUserRank(
    userId: string,
    period: LeaderboardPeriod,
    periodKey = periodKeyFor(period)
  ) {
    return findUserRank(userId, period, periodKey);
  },

  async getUserRank(
    userId: string,
    period: LeaderboardPeriod,
    periodKey = periodKeyFor(period)
  ) {
    const rank = await findUserRank(userId, period, periodKey);
    if (!rank) {
      throw AppError.notFound('Leaderboard entry');
    }
    return rank;
  },

  getCurrentPeriodKey(period: LeaderboardPeriod) {
    return periodKeyFor(period);
  },
};
