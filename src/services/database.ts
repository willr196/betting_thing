import { PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';
import { logger } from '../logger.js';

// =============================================================================
// PRISMA CLIENT SINGLETON
// =============================================================================
// We use a singleton pattern to avoid creating multiple connections
// during development with hot reloading.

declare global {
  var __prisma: PrismaClient | undefined;
}

const prismaClientOptions: ConstructorParameters<typeof PrismaClient>[0] = {
  log: config.isDev 
    ? ['query', 'info', 'warn', 'error'] 
    : ['error'],
};

// In development, use a global variable to preserve the client across hot reloads
// In production, always create a new instance
export const prisma: PrismaClient = 
  globalThis.__prisma ?? new PrismaClient(prismaClientOptions);

if (config.isDev) {
  globalThis.__prisma = prisma;
}

// =============================================================================
// CONNECTION HELPERS
// =============================================================================

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (error) {
    logger.error({ err: error }, 'Database connection failed');
    process.exit(1);
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}

// =============================================================================
// HEALTH CHECK
// =============================================================================

export async function isDatabaseHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
