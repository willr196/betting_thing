import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './database.js';

type AchievementDefinition = {
  key: string;
  name: string;
  description: string;
  iconEmoji: string;
  category: string;
  threshold: number;
};

type AchievementMetrics = {
  totalPredictions: number;
  totalWins: number;
  totalCashouts: number;
  totalRedemptions: number;
  totalPositivePoints: number;
  currentStreak: number;
  longestStreak: number;
};

type AchievementStatusRow = AchievementDefinition & {
  unlockedAt: Date | null;
};

type ProgressItem = AchievementStatusRow & {
  currentValue: number;
  progress: number;
};

const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    key: 'first_prediction',
    name: 'First Blood',
    description: 'Place your first prediction',
    iconEmoji: '🎯',
    category: 'predictions',
    threshold: 1,
  },
  {
    key: 'first_win',
    name: 'Winner Winner',
    description: 'Win your first prediction',
    iconEmoji: '🏆',
    category: 'predictions',
    threshold: 1,
  },
  {
    key: '10_predictions',
    name: 'Getting Serious',
    description: 'Place 10 predictions',
    iconEmoji: '📊',
    category: 'predictions',
    threshold: 10,
  },
  {
    key: '10_wins',
    name: 'Veteran',
    description: 'Win 10 predictions',
    iconEmoji: '⭐',
    category: 'predictions',
    threshold: 10,
  },
  {
    key: '50_wins',
    name: 'Elite Predictor',
    description: 'Win 50 predictions',
    iconEmoji: '👑',
    category: 'predictions',
    threshold: 50,
  },
  {
    key: 'streak_3',
    name: 'Hat Trick',
    description: 'Reach a 3-win streak',
    iconEmoji: '🔥',
    category: 'streaks',
    threshold: 3,
  },
  {
    key: 'streak_5',
    name: 'On Fire',
    description: 'Reach a 5-win streak',
    iconEmoji: '🔥🔥',
    category: 'streaks',
    threshold: 5,
  },
  {
    key: 'streak_10',
    name: 'Unstoppable',
    description: 'Reach a 10-win streak',
    iconEmoji: '💎',
    category: 'streaks',
    threshold: 10,
  },
  {
    key: 'first_cashout',
    name: 'Early Bird',
    description: 'Cash out your first prediction',
    iconEmoji: '🐣',
    category: 'predictions',
    threshold: 1,
  },
  {
    key: 'first_redemption',
    name: 'Shopper',
    description: 'Redeem your first reward',
    iconEmoji: '🛍️',
    category: 'engagement',
    threshold: 1,
  },
  {
    key: 'points_1000',
    name: 'Point Collector',
    description: 'Earn 1,000 total points',
    iconEmoji: '💰',
    category: 'points',
    threshold: 1000,
  },
  {
    key: 'points_10000',
    name: 'High Roller',
    description: 'Earn 10,000 total points',
    iconEmoji: '💎',
    category: 'points',
    threshold: 10000,
  },
];

let definitionsEnsured = false;

function getCurrentValueForKey(metrics: AchievementMetrics, key: string): number {
  switch (key) {
    case 'first_prediction':
    case '10_predictions':
      return metrics.totalPredictions;
    case 'first_win':
    case '10_wins':
    case '50_wins':
      return metrics.totalWins;
    case 'streak_3':
    case 'streak_5':
    case 'streak_10':
      return metrics.longestStreak;
    case 'first_cashout':
      return metrics.totalCashouts;
    case 'first_redemption':
      return metrics.totalRedemptions;
    case 'points_1000':
    case 'points_10000':
      return metrics.totalPositivePoints;
    default:
      return 0;
  }
}

async function ensureDefinitions(tx: Prisma.TransactionClient) {
  if (definitionsEnsured) {
    return;
  }

  for (const definition of ACHIEVEMENT_DEFINITIONS) {
    await tx.$executeRaw`
      INSERT INTO "Achievement" ("id", "key", "name", "description", "iconEmoji", "category", "threshold")
      VALUES (
        ${randomUUID()},
        ${definition.key},
        ${definition.name},
        ${definition.description},
        ${definition.iconEmoji},
        ${definition.category},
        ${definition.threshold}
      )
      ON CONFLICT ("key")
      DO UPDATE SET
        "name" = EXCLUDED."name",
        "description" = EXCLUDED."description",
        "iconEmoji" = EXCLUDED."iconEmoji",
        "category" = EXCLUDED."category",
        "threshold" = EXCLUDED."threshold"
    `;
  }

  definitionsEnsured = true;
}

async function getMetrics(userId: string, tx: Prisma.TransactionClient): Promise<AchievementMetrics> {
  const [predictionStats] = await tx.$queryRaw<
    Array<{ totalPredictions: bigint; totalWins: bigint; totalCashouts: bigint }>
  >`
    SELECT
      COUNT(*)::bigint AS "totalPredictions",
      COUNT(*) FILTER (WHERE "status" = 'WON')::bigint AS "totalWins",
      COUNT(*) FILTER (WHERE "status" = 'CASHED_OUT')::bigint AS "totalCashouts"
    FROM "Prediction"
    WHERE "userId" = ${userId}
  `;

  const [redemptionStats] = await tx.$queryRaw<
    Array<{ totalRedemptions: bigint }>
  >`
    SELECT COUNT(*)::bigint AS "totalRedemptions"
    FROM "Redemption"
    WHERE "userId" = ${userId}
  `;

  const [pointsStats] = await tx.$queryRaw<
    Array<{ totalPositivePoints: bigint | null }>
  >`
    SELECT SUM("amount")::bigint AS "totalPositivePoints"
    FROM "PointsTransaction"
    WHERE "userId" = ${userId}
      AND "amount" > 0
  `;

  const [streakStats] = await tx.$queryRaw<
    Array<{ currentStreak: number; longestStreak: number }>
  >`
    SELECT "currentStreak", "longestStreak"
    FROM "Leaderboard"
    WHERE "userId" = ${userId}
      AND "period" = 'ALL_TIME'::"LeaderboardPeriod"
      AND "periodKey" = 'all-time'
    LIMIT 1
  `;

  return {
    totalPredictions: Number(predictionStats?.totalPredictions ?? 0n),
    totalWins: Number(predictionStats?.totalWins ?? 0n),
    totalCashouts: Number(predictionStats?.totalCashouts ?? 0n),
    totalRedemptions: Number(redemptionStats?.totalRedemptions ?? 0n),
    totalPositivePoints: Number(pointsStats?.totalPositivePoints ?? 0n),
    currentStreak: streakStats?.currentStreak ?? 0,
    longestStreak: streakStats?.longestStreak ?? 0,
  };
}

async function getUserUnlockedKeys(userId: string, tx: Prisma.TransactionClient): Promise<Set<string>> {
  const rows = await tx.$queryRaw<Array<{ key: string }>>`
    SELECT a."key"
    FROM "UserAchievement" ua
    INNER JOIN "Achievement" a ON a."id" = ua."achievementId"
    WHERE ua."userId" = ${userId}
  `;
  return new Set(rows.map((row) => row.key));
}

function computeEligibleKeys(metrics: AchievementMetrics): string[] {
  return ACHIEVEMENT_DEFINITIONS.filter((definition) => {
    const currentValue = getCurrentValueForKey(metrics, definition.key);
    return currentValue >= definition.threshold;
  }).map((definition) => definition.key);
}

export const AchievementService = {
  async checkAndAward(
    userId: string,
    tx?: Prisma.TransactionClient
  ): Promise<{ unlocked: Array<{ key: string; name: string; iconEmoji: string }> }> {
    const work = async (client: Prisma.TransactionClient) => {
      await ensureDefinitions(client);

      const [metrics, unlockedKeys] = await Promise.all([
        getMetrics(userId, client),
        getUserUnlockedKeys(userId, client),
      ]);

      const eligibleKeys = computeEligibleKeys(metrics);
      const pendingKeys = eligibleKeys.filter((key) => !unlockedKeys.has(key));
      if (pendingKeys.length === 0) {
        return { unlocked: [] };
      }

      const unlocked: Array<{ key: string; name: string; iconEmoji: string }> = [];
      for (const key of pendingKeys) {
        const [inserted] = await client.$queryRaw<
          Array<{ key: string; name: string; iconEmoji: string }>
        >`
          WITH inserted AS (
            INSERT INTO "UserAchievement" ("id", "userId", "achievementId", "unlockedAt")
            SELECT ${randomUUID()}, ${userId}, a."id", NOW()
            FROM "Achievement" a
            WHERE a."key" = ${key}
            ON CONFLICT ("userId", "achievementId") DO NOTHING
            RETURNING "achievementId"
          )
          SELECT a."key", a."name", a."iconEmoji"
          FROM inserted i
          INNER JOIN "Achievement" a ON a."id" = i."achievementId"
        `;

        if (inserted) {
          unlocked.push(inserted);
        }
      }

      return { unlocked };
    };

    if (tx) {
      return work(tx);
    }

    return prisma.$transaction(work);
  },

  async getAll(userId: string): Promise<{
    achievements: Array<AchievementStatusRow & { currentValue: number; progress: number }>;
  }> {
    return prisma.$transaction(async (tx) => {
      await ensureDefinitions(tx);
      const metrics = await getMetrics(userId, tx);

      const rows = await tx.$queryRaw<Array<AchievementStatusRow>>`
        SELECT
          a."key",
          a."name",
          a."description",
          a."iconEmoji",
          a."category",
          a."threshold",
          ua."unlockedAt"
        FROM "Achievement" a
        LEFT JOIN "UserAchievement" ua
          ON ua."achievementId" = a."id"
          AND ua."userId" = ${userId}
        ORDER BY a."category" ASC, a."threshold" ASC, a."name" ASC
      `;

      const achievements = rows.map((row) => {
        const currentValue = getCurrentValueForKey(metrics, row.key);
        const progress =
          row.threshold <= 0 ? 100 : Math.min(100, Math.round((currentValue / row.threshold) * 100));
        return {
          ...row,
          currentValue,
          progress,
        };
      });

      return { achievements };
    });
  },

  async getUnlocked(userId: string) {
    return prisma.$transaction(async (tx) => {
      await ensureDefinitions(tx);
      const unlocked = await tx.$queryRaw<Array<AchievementStatusRow>>`
        SELECT
          a."key",
          a."name",
          a."description",
          a."iconEmoji",
          a."category",
          a."threshold",
          ua."unlockedAt"
        FROM "UserAchievement" ua
        INNER JOIN "Achievement" a ON a."id" = ua."achievementId"
        WHERE ua."userId" = ${userId}
        ORDER BY ua."unlockedAt" DESC
      `;

      return { achievements: unlocked };
    });
  },

  async getProgress(userId: string, limit = 3): Promise<{ next: ProgressItem[] }> {
    const { achievements } = await this.getAll(userId);
    const locked = achievements.filter((achievement) => !achievement.unlockedAt);

    const next = locked
      .sort((a, b) => {
        if (b.progress !== a.progress) {
          return b.progress - a.progress;
        }
        return b.currentValue - a.currentValue;
      })
      .slice(0, limit);

    return { next };
  },

  async getMetrics(userId: string): Promise<AchievementMetrics> {
    return prisma.$transaction(async (tx) => {
      await ensureDefinitions(tx);
      return getMetrics(userId, tx);
    });
  },
};
