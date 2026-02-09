import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // Create admin user
  const adminPassword = await bcrypt.hash('Admin123!', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      passwordHash: adminPassword,
      tokenBalance: 0,
      pointsBalance: 0,
      isAdmin: true,
      isVerified: true,
    },
  });
  console.log('✅ Admin user created:', admin.email);

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  await prisma.tokenTransaction.upsert({
    where: { id: 'admin-daily-allowance' },
    update: {},
    create: {
      id: 'admin-daily-allowance',
      userId: admin.id,
      amount: 5,
      balanceAfter: 5,
      type: 'DAILY_ALLOWANCE',
      description: 'Daily token allowance',
    },
  });

  await prisma.user.update({
    where: { id: admin.id },
    data: { tokenBalance: 5 },
  });

  await prisma.tokenAllowance.upsert({
    where: { id: 'admin-token-allowance' },
    update: {},
    create: {
      id: 'admin-token-allowance',
      userId: admin.id,
      tokensRemaining: 5,
      lastResetDate: todayUtc,
    },
  });

  // Create test user
  const testPassword = await bcrypt.hash('Test123!', 10);
  const testUser = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      email: 'test@example.com',
      passwordHash: testPassword,
      tokenBalance: 0,
      pointsBalance: 0,
      isAdmin: false,
      isVerified: true,
    },
  });
  console.log('✅ Test user created:', testUser.email);

  await prisma.tokenTransaction.upsert({
    where: { id: 'test-daily-allowance' },
    update: {},
    create: {
      id: 'test-daily-allowance',
      userId: testUser.id,
      amount: 5,
      balanceAfter: 5,
      type: 'DAILY_ALLOWANCE',
      description: 'Daily token allowance',
    },
  });

  await prisma.user.update({
    where: { id: testUser.id },
    data: { tokenBalance: 5 },
  });

  await prisma.tokenAllowance.upsert({
    where: { id: 'test-token-allowance' },
    update: {},
    create: {
      id: 'test-token-allowance',
      userId: testUser.id,
      tokensRemaining: 5,
      lastResetDate: todayUtc,
    },
  });

  // Create sample events
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const events = [
    {
      id: 'seed-event-premier-league',
      title: 'Premier League: Manchester United vs Liverpool',
      description: 'Big match at Old Trafford',
      startsAt: tomorrow,
      outcomes: ['Manchester United Wins', 'Liverpool Wins', 'Draw'],
      payoutMultiplier: 2.0,
      status: 'OPEN' as const,
      createdBy: admin.id,
    },
    {
      id: 'seed-event-nba-finals-g7',
      title: 'NBA Finals Game 7',
      description: 'The deciding game of the championship',
      startsAt: nextWeek,
      outcomes: ['Team A Wins', 'Team B Wins'],
      payoutMultiplier: 1.9,
      status: 'OPEN' as const,
      createdBy: admin.id,
    },
    {
      id: 'seed-event-tennis-final',
      title: 'Tennis Grand Slam Final',
      description: 'Championship match',
      startsAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      outcomes: ['Player A Wins', 'Player B Wins'],
      payoutMultiplier: 2.0,
      status: 'OPEN' as const,
      createdBy: admin.id,
    },
  ];

  for (const eventData of events) {
    const event = await prisma.event.upsert({
      where: { id: eventData.id },
      update: {},
      create: eventData,
    });
    console.log('✅ Event created:', event.title);
  }

  // Create sample rewards
  const rewards = [
    {
      id: 'seed-reward-amazon-10',
      name: '$10 Amazon Gift Card',
      description: 'Digital gift card delivered via email',
      pointsCost: 5000,
      stockLimit: 100,
      isActive: true,
    },
    {
      id: 'seed-reward-amazon-25',
      name: '$25 Amazon Gift Card',
      description: 'Digital gift card delivered via email',
      pointsCost: 12000,
      stockLimit: 50,
      isActive: true,
    },
    {
      id: 'seed-reward-amazon-50',
      name: '$50 Amazon Gift Card',
      description: 'Digital gift card delivered via email',
      pointsCost: 22000,
      stockLimit: 25,
      isActive: true,
    },
    {
      id: 'seed-reward-shirt',
      name: 'Platform T-Shirt',
      description: 'Exclusive branded merchandise',
      pointsCost: 3000,
      stockLimit: 200,
      isActive: true,
    },
    {
      id: 'seed-reward-vip-1mo',
      name: 'VIP Status (1 Month)',
      description: 'Get VIP badge and early access to events',
      pointsCost: 8000,
      stockLimit: null, // Unlimited
      isActive: true,
    },
  ];

  for (const rewardData of rewards) {
    const reward = await prisma.reward.upsert({
      where: { id: rewardData.id },
      update: {},
      create: rewardData,
    });
    console.log('✅ Reward created:', reward.name);
  }

  console.log('\n🎉 Seeding complete!\n');
  console.log('Test Accounts:');
  console.log('  Admin: admin@example.com / Admin123!');
  console.log('  User:  test@example.com / Test123!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
