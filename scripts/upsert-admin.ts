import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function printHelp() {
  console.log(`Usage:
  npm run admin:upsert -- --email admin@example.com --password 'StrongPassword123!'

Optional flags:
  --email <email>
  --password <password>
  --display-name <name>

Environment variable fallbacks:
  DATABASE_URL         Required
  ADMIN_EMAIL          Fallback email
  ADMIN_PASSWORD       Fallback password
  ADMIN_DISPLAY_NAME   Fallback display name
  SEED_ADMIN_EMAIL     Final email fallback
  SEED_PASSWORD        Final password fallback

Behavior:
  - Creates the user if it does not exist
  - Promotes the user to admin
  - Sets isVerified=true
  - Resets lockout state and clears existing refresh tokens
  - Updates the password to the supplied or generated value
`);
}

function getStartOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const adminEmail = (
    getArgValue('--email')
    ?? process.env.ADMIN_EMAIL
    ?? process.env.SEED_ADMIN_EMAIL
    ?? 'admin@example.com'
  ).trim().toLowerCase();

  if (!adminEmail) {
    throw new Error('Admin email cannot be empty');
  }

  const passwordInput =
    getArgValue('--password')
    ?? process.env.ADMIN_PASSWORD
    ?? process.env.SEED_PASSWORD;

  const adminPassword = passwordInput?.trim() || randomBytes(18).toString('base64url');
  const displayName = (
    getArgValue('--display-name')
    ?? process.env.ADMIN_DISPLAY_NAME
  )?.trim();

  if (adminPassword.length < 8) {
    throw new Error('Admin password must be at least 8 characters');
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const existingUser = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: {
      id: true,
      isAdmin: true,
      tokenBalance: true,
    },
  });

  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          passwordHash,
          isAdmin: true,
          isVerified: true,
          failedLoginAttempts: 0,
          loginLockoutUntil: null,
          refreshTokenHash: null,
          refreshTokenExpiresAt: null,
          ...(displayName ? { displayName } : {}),
        },
        select: {
          id: true,
          email: true,
          isAdmin: true,
          tokenBalance: true,
          createdAt: true,
        },
      })
    : await prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash,
          displayName: displayName || null,
          isAdmin: true,
          isVerified: true,
        },
        select: {
          id: true,
          email: true,
          isAdmin: true,
          tokenBalance: true,
          createdAt: true,
        },
      });

  await prisma.tokenAllowance.upsert({
    where: { userId: user.id },
    update: {
      tokensRemaining: user.tokenBalance,
    },
    create: {
      userId: user.id,
      tokensRemaining: user.tokenBalance,
      lastResetDate: getStartOfDay(new Date()),
    },
  });

  console.log(existingUser ? 'Updated existing user and ensured admin access.' : 'Created new admin user.');
  console.log(`Email: ${user.email}`);
  console.log(`Password: ${adminPassword}`);
  console.log(`User ID: ${user.id}`);
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
