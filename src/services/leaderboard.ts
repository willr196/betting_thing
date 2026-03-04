import { prisma } from './database.js';
import { AppError } from '../utils/index.js';

type RankedUserRow = {
  rank: number | bigint;
  userId: string;
  email: string;
  points: number | bigint;
};

type RankedPointsRow = {
  rank: number | bigint;
  points: number | bigint;
};

function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function obfuscateEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) {
    return `${email.slice(0, 2)}***`;
  }

  const visiblePrefix = localPart.slice(0, 2);
  const maskedLength = Math.max(1, localPart.length - visiblePrefix.length);
  return `${visiblePrefix}${'*'.repeat(maskedLength)}@${domain}`;
}

function toWinRate(wins: number, settled: number): number {
  if (settled <= 0) {
    return 0;
  }
  return Number((wins / settled).toFixed(2));
}

export const LeaderboardService = {
  async getLeaderboard(userId: string, requestedLimit = 50) {
    const limit = Math.min(Math.max(requestedLimit, 1), 100);

    const rankedUsers = await prisma.$queryRaw<Array<RankedUserRow>>`
      WITH ranked AS (
        SELECT
          "id" AS "userId",
          "email",
          "pointsBalance" AS "points",
          ROW_NUMBER() OVER (
            ORDER BY "pointsBalance" DESC, "createdAt" ASC, "id" ASC
          ) AS "rank"
        FROM "User"
      )
      SELECT "rank", "userId", "email", "points"
      FROM ranked
      ORDER BY "rank"
      LIMIT ${limit}
    `;

    const topUserIds = rankedUsers.map((row) => row.userId);
    const [winsByUser, settledByUser] = topUserIds.length
      ? await Promise.all([
          prisma.prediction.groupBy({
            by: ['userId'],
            where: {
              userId: { in: topUserIds },
              status: 'WON',
            },
            _count: { _all: true },
          }),
          prisma.prediction.groupBy({
            by: ['userId'],
            where: {
              userId: { in: topUserIds },
              status: { in: ['WON', 'LOST'] },
            },
            _count: { _all: true },
          }),
        ])
      : [[], []];

    const winsMap = new Map(winsByUser.map((row) => [row.userId, row._count._all]));
    const settledMap = new Map(settledByUser.map((row) => [row.userId, row._count._all]));

    const leaderboard = rankedUsers.map((row) => {
      const wins = winsMap.get(row.userId) ?? 0;
      const settled = settledMap.get(row.userId) ?? 0;

      return {
        rank: toNumber(row.rank),
        userId: row.userId,
        displayName: obfuscateEmail(row.email),
        points: toNumber(row.points),
        predictionsWon: wins,
        winRate: toWinRate(wins, settled),
      };
    });

    const [currentUserRank] = await prisma.$queryRaw<Array<RankedPointsRow>>`
      WITH ranked AS (
        SELECT
          "id" AS "userId",
          "pointsBalance" AS "points",
          ROW_NUMBER() OVER (
            ORDER BY "pointsBalance" DESC, "createdAt" ASC, "id" ASC
          ) AS "rank"
        FROM "User"
      )
      SELECT "rank", "points"
      FROM ranked
      WHERE "userId" = ${userId}
      LIMIT 1
    `;

    if (!currentUserRank) {
      throw AppError.notFound('User');
    }

    const userRankValue = toNumber(currentUserRank.rank);
    const userPoints = toNumber(currentUserRank.points);
    let pointsToNextRank = 0;

    if (userRankValue > 1) {
      const [nextRankUser] = await prisma.$queryRaw<Array<{ points: number | bigint }>>`
        WITH ranked AS (
          SELECT
            "id" AS "userId",
            "pointsBalance" AS "points",
            ROW_NUMBER() OVER (
              ORDER BY "pointsBalance" DESC, "createdAt" ASC, "id" ASC
            ) AS "rank"
          FROM "User"
        )
        SELECT "points"
        FROM ranked
        WHERE "rank" = ${userRankValue - 1}
        LIMIT 1
      `;

      const pointsAbove = nextRankUser ? toNumber(nextRankUser.points) : userPoints;
      pointsToNextRank = Math.max(0, pointsAbove - userPoints);
    }

    return {
      leaderboard,
      userRank: {
        rank: userRankValue,
        points: userPoints,
        pointsToNextRank,
      },
    };
  },
};
