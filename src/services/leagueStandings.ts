import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './database.js';
import { getISOWeekKey, getWeekDateRange } from '../utils/week.js';

type LeaguePeriod = 'WEEKLY' | 'ALL_TIME';

type ActiveMembershipRow = {
  userId: string;
  joinedAt: Date;
};

type WindowStats = {
  pointsEarned: number;
  predictionsWon: number;
  predictionsLost: number;
  totalPredictions: number;
};

const ZERO_STATS: WindowStats = {
  pointsEarned: 0,
  predictionsWon: 0,
  predictionsLost: 0,
  totalPredictions: 0,
};

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

async function calculateWindowStats(
  tx: Prisma.TransactionClient,
  userId: string,
  startAt: Date,
  endAt?: Date
): Promise<WindowStats> {
  const pointsDateFilter = endAt
    ? Prisma.sql`AND "createdAt" >= ${startAt} AND "createdAt" <= ${endAt}`
    : Prisma.sql`AND "createdAt" >= ${startAt}`;
  const settledDateFilter = endAt
    ? Prisma.sql`AND "settledAt" >= ${startAt} AND "settledAt" <= ${endAt}`
    : Prisma.sql`AND "settledAt" >= ${startAt}`;

  const [pointsRow] = await tx.$queryRaw<Array<{ pointsEarned: number }>>`
    SELECT COALESCE(SUM("amount"), 0)::int AS "pointsEarned"
    FROM "PointsTransaction"
    WHERE
      "userId" = ${userId}
      AND "type" IN ('PREDICTION_WIN', 'CASHOUT')
      ${pointsDateFilter}
  `;

  const [predictionRow] = await tx.$queryRaw<
    Array<{ predictionsWon: number; predictionsLost: number }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE "status" = 'WON')::int AS "predictionsWon",
      COUNT(*) FILTER (WHERE "status" = 'LOST')::int AS "predictionsLost"
    FROM "Prediction"
    WHERE
      "userId" = ${userId}
      AND "settledAt" IS NOT NULL
      ${settledDateFilter}
  `;

  const predictionsWon = predictionRow?.predictionsWon ?? 0;
  const predictionsLost = predictionRow?.predictionsLost ?? 0;

  return {
    pointsEarned: pointsRow?.pointsEarned ?? 0,
    predictionsWon,
    predictionsLost,
    totalPredictions: predictionsWon + predictionsLost,
  };
}

async function upsertStanding(
  tx: Prisma.TransactionClient,
  data: {
    leagueId: string;
    userId: string;
    period: LeaguePeriod;
    periodKey: string;
    stats: WindowStats;
  }
): Promise<void> {
  const { leagueId, userId, period, periodKey, stats } = data;

  await tx.$executeRaw`
    INSERT INTO "LeagueStanding" (
      "id",
      "leagueId",
      "userId",
      "period",
      "periodKey",
      "pointsEarned",
      "predictionsWon",
      "predictionsLost",
      "totalPredictions",
      "rank",
      "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${leagueId},
      ${userId},
      ${period}::"LeaguePeriod",
      ${periodKey},
      ${stats.pointsEarned},
      ${stats.predictionsWon},
      ${stats.predictionsLost},
      ${stats.totalPredictions},
      0,
      NOW()
    )
    ON CONFLICT ("leagueId", "userId", "period", "periodKey")
    DO UPDATE SET
      "pointsEarned" = EXCLUDED."pointsEarned",
      "predictionsWon" = EXCLUDED."predictionsWon",
      "predictionsLost" = EXCLUDED."predictionsLost",
      "totalPredictions" = EXCLUDED."totalPredictions",
      "updatedAt" = NOW()
  `;
}

async function rerankPeriod(
  tx: Prisma.TransactionClient,
  leagueId: string,
  period: LeaguePeriod,
  periodKey: string
): Promise<void> {
  await tx.$executeRaw`
    WITH ranked AS (
      SELECT
        "id",
        ROW_NUMBER() OVER (
          ORDER BY
            "pointsEarned" DESC,
            "predictionsWon" DESC,
            "totalPredictions" ASC,
            "userId" ASC
        ) AS "nextRank"
      FROM "LeagueStanding"
      WHERE
        "leagueId" = ${leagueId}
        AND "period" = ${period}::"LeaguePeriod"
        AND "periodKey" = ${periodKey}
    )
    UPDATE "LeagueStanding" ls
    SET "rank" = ranked."nextRank"
    FROM ranked
    WHERE ls."id" = ranked."id"
  `;
}

export const LeagueStandingsService = {
  async recalculateLeague(leagueId: string): Promise<void> {
    const weekKey = getISOWeekKey();
    const { start: weekStart, end: weekEnd } = getWeekDateRange(weekKey);

    await prisma.$transaction(async (tx) => {
      const memberships = await tx.$queryRaw<Array<ActiveMembershipRow>>`
        SELECT "userId", "joinedAt"
        FROM "LeagueMembership"
        WHERE "leagueId" = ${leagueId} AND "isActive" = true
      `;

      if (memberships.length === 0) {
        await tx.$executeRaw`
          DELETE FROM "LeagueStanding"
          WHERE
            "leagueId" = ${leagueId}
            AND (
              ("period" = 'WEEKLY'::"LeaguePeriod" AND "periodKey" = ${weekKey})
              OR ("period" = 'ALL_TIME'::"LeaguePeriod" AND "periodKey" = 'all-time')
            )
        `;
        return;
      }

      const activeUserIds = memberships.map((membership) => membership.userId);
      await tx.$executeRaw`
        DELETE FROM "LeagueStanding"
        WHERE
          "leagueId" = ${leagueId}
          AND (
            ("period" = 'WEEKLY'::"LeaguePeriod" AND "periodKey" = ${weekKey})
            OR ("period" = 'ALL_TIME'::"LeaguePeriod" AND "periodKey" = 'all-time')
          )
          AND "userId" NOT IN (${Prisma.join(activeUserIds)})
      `;

      for (const membership of memberships) {
        const weeklyStart = maxDate(weekStart, membership.joinedAt);
        const weeklyStats =
          weeklyStart.getTime() > weekEnd.getTime()
            ? ZERO_STATS
            : await calculateWindowStats(tx, membership.userId, weeklyStart, weekEnd);
        const allTimeStats = await calculateWindowStats(tx, membership.userId, membership.joinedAt);

        await upsertStanding(tx, {
          leagueId,
          userId: membership.userId,
          period: 'WEEKLY',
          periodKey: weekKey,
          stats: weeklyStats,
        });

        await upsertStanding(tx, {
          leagueId,
          userId: membership.userId,
          period: 'ALL_TIME',
          periodKey: 'all-time',
          stats: allTimeStats,
        });
      }

      await rerankPeriod(tx, leagueId, 'WEEKLY', weekKey);
      await rerankPeriod(tx, leagueId, 'ALL_TIME', 'all-time');
    });
  },

  async recalculateForUsers(userIds: string[]): Promise<{ recalculatedLeagues: number }> {
    const uniqueUserIds = Array.from(new Set(userIds.filter((userId) => userId.length > 0)));
    if (uniqueUserIds.length === 0) {
      return { recalculatedLeagues: 0 };
    }

    const leagueRows = await prisma.$queryRaw<Array<{ leagueId: string }>>`
      SELECT DISTINCT "leagueId"
      FROM "LeagueMembership"
      WHERE "isActive" = true AND "userId" IN (${Prisma.join(uniqueUserIds)})
    `;

    for (const row of leagueRows) {
      await this.recalculateLeague(row.leagueId);
    }

    return { recalculatedLeagues: leagueRows.length };
  },

  async recalculateAll(): Promise<{ recalculatedLeagues: number }> {
    const leagueRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT l."id"
      FROM "League" l
      INNER JOIN "LeagueMembership" lm
        ON lm."leagueId" = l."id"
      WHERE lm."isActive" = true
    `;

    for (const league of leagueRows) {
      await this.recalculateLeague(league.id);
    }

    return { recalculatedLeagues: leagueRows.length };
  },
};
