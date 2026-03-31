import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;
const FORCE_FLAG = '--force';
const RESET_TRANSACTION_TIMEOUT_MS = 30000;
const SEEDED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() || 'admin@example.com';
const SEEDED_USER_EMAIL = process.env.SEED_USER_EMAIL?.trim().toLowerCase() || 'user@example.com';
const SEEDED_PASSWORD = process.env.SEED_PASSWORD?.trim() || randomBytes(12).toString('base64url');

function getStartOfISOWeek(date: Date): Date {
  const day = date.getUTCDay() || 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

function getSeedAllowance(date: Date): { amount: number; lastResetDate: Date } {
  const weekStart = getStartOfISOWeek(date);
  const elapsedDays = Math.max(0, Math.floor((date.getTime() - weekStart.getTime()) / MS_IN_DAY));

  return {
    amount: Math.min(11, 5 + elapsedDays),
    lastResetDate: weekStart,
  };
}

async function confirmReset(): Promise<boolean> {
  if (process.argv.includes(FORCE_FLAG)) {
    return true;
  }

  if (!process.stdin.isTTY) {
    console.error(`Refusing to run without an interactive prompt. Re-run with ${FORCE_FLAG} to skip confirmation.`);
    return false;
  }

  const rl = createInterface({ input, output });

  try {
    const answer = await rl.question(
      'Type RESET to delete all user data and recreate the seeded baseline accounts: '
    );

    return answer.trim() === 'RESET';
  } finally {
    rl.close();
  }
}

async function seedBaselineUsers(): Promise<void> {
  const today = new Date();
  const allowanceSeed = getSeedAllowance(
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  );

  const adminPassword = await bcrypt.hash(SEEDED_PASSWORD, BCRYPT_ROUNDS);
  const admin = await prisma.user.create({
    data: {
      email: SEEDED_ADMIN_EMAIL,
      passwordHash: adminPassword,
      tokenBalance: allowanceSeed.amount,
      pointsBalance: 0,
      isAdmin: true,
      isVerified: true,
    },
  });

  await prisma.tokenTransaction.create({
    data: {
      id: 'admin-daily-allowance',
      userId: admin.id,
      amount: allowanceSeed.amount,
      balanceAfter: allowanceSeed.amount,
      type: 'DAILY_ALLOWANCE',
      description: 'Weekly token allowance',
    },
  });

  await prisma.tokenAllowance.create({
    data: {
      id: 'admin-token-allowance',
      userId: admin.id,
      tokensRemaining: allowanceSeed.amount,
      lastResetDate: allowanceSeed.lastResetDate,
    },
  });

  const testPassword = await bcrypt.hash(SEEDED_PASSWORD, BCRYPT_ROUNDS);
  const testUser = await prisma.user.create({
    data: {
      email: SEEDED_USER_EMAIL,
      passwordHash: testPassword,
      tokenBalance: allowanceSeed.amount,
      pointsBalance: 0,
      isAdmin: false,
      isVerified: true,
    },
  });

  await prisma.tokenTransaction.create({
    data: {
      id: 'test-daily-allowance',
      userId: testUser.id,
      amount: allowanceSeed.amount,
      balanceAfter: allowanceSeed.amount,
      type: 'DAILY_ALLOWANCE',
      description: 'Weekly token allowance',
    },
  });

  await prisma.tokenAllowance.create({
    data: {
      id: 'test-token-allowance',
      userId: testUser.id,
      tokensRemaining: allowanceSeed.amount,
      lastResetDate: allowanceSeed.lastResetDate,
    },
  });

  console.log(`✅ Recreated admin account: ${SEEDED_ADMIN_EMAIL}`);
  console.log(`✅ Recreated user account: ${SEEDED_USER_EMAIL}`);
  console.log(`✅ Password: ${SEEDED_PASSWORD}`);
}

async function main() {
  console.log('🗑️  Deleting all user data...\n');

  const confirmed = await confirmReset();
  if (!confirmed) {
    console.log('Aborted.');
    return;
  }

  const users = await prisma.user.findMany({
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  const result = await prisma.$transaction(
    async (tx) => {
      const createdByCleared = userIds.length
        ? await tx.event.updateMany({
            where: { createdBy: { in: userIds } },
            data: { createdBy: null },
          })
        : { count: 0 };

      const settledByCleared = userIds.length
        ? await tx.event.updateMany({
            where: { settledBy: { in: userIds } },
            data: { settledBy: null },
          })
        : { count: 0 };

      const adminAuditLogs = await tx.adminAuditLog.deleteMany();
      const leagueStandings = await tx.leagueStanding.deleteMany();
      const leagueMemberships = await tx.leagueMembership.deleteMany();
      const leagues = await tx.league.deleteMany();
      const accumulatorLegs = await tx.accumulatorLeg.deleteMany();
      const accumulators = await tx.accumulator.deleteMany();
      const predictions = await tx.prediction.deleteMany();
      const redemptions = await tx.redemption.deleteMany();
      const userAchievements = await tx.userAchievement.deleteMany();
      const leaderboards = await tx.leaderboard.deleteMany();
      const passwordResetTokens = await tx.passwordResetToken.deleteMany();
      const pointsTransactions = await tx.pointsTransaction.deleteMany();
      const tokenTransactions = await tx.tokenTransaction.deleteMany();
      const tokenAllowances = await tx.tokenAllowance.deleteMany();
      const deletedUsers = await tx.user.deleteMany();

      return {
        createdByCleared: createdByCleared.count,
        settledByCleared: settledByCleared.count,
        adminAuditLogs: adminAuditLogs.count,
        leagueStandings: leagueStandings.count,
        leagueMemberships: leagueMemberships.count,
        leagues: leagues.count,
        accumulatorLegs: accumulatorLegs.count,
        accumulators: accumulators.count,
        predictions: predictions.count,
        redemptions: redemptions.count,
        userAchievements: userAchievements.count,
        leaderboards: leaderboards.count,
        passwordResetTokens: passwordResetTokens.count,
        pointsTransactions: pointsTransactions.count,
        tokenTransactions: tokenTransactions.count,
        tokenAllowances: tokenAllowances.count,
        users: deletedUsers.count,
      };
    },
    {
      timeout: RESET_TRANSACTION_TIMEOUT_MS,
    }
  );

  console.log('Deleted records:');
  console.log(`  Users: ${result.users}`);
  console.log(`  Predictions: ${result.predictions}`);
  console.log(`  Accumulators: ${result.accumulators}`);
  console.log(`  Accumulator legs: ${result.accumulatorLegs}`);
  console.log(`  Token transactions: ${result.tokenTransactions}`);
  console.log(`  Points transactions: ${result.pointsTransactions}`);
  console.log(`  Token allowances: ${result.tokenAllowances}`);
  console.log(`  Redemptions: ${result.redemptions}`);
  console.log(`  Leaderboards: ${result.leaderboards}`);
  console.log(`  User achievements: ${result.userAchievements}`);
  console.log(`  Password reset tokens: ${result.passwordResetTokens}`);
  console.log(`  League memberships: ${result.leagueMemberships}`);
  console.log(`  League standings: ${result.leagueStandings}`);
  console.log(`  Leagues: ${result.leagues}`);
  console.log(`  Admin audit logs: ${result.adminAuditLogs}`);
  console.log(`  Events with cleared createdBy: ${result.createdByCleared}`);
  console.log(`  Events with cleared settledBy: ${result.settledByCleared}`);
  console.log('');

  await seedBaselineUsers();

  console.log('\n🎉 User reset complete.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
