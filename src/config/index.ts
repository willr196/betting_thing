import { z } from 'zod';
import dotenv from 'dotenv';
import { logger } from '../logger.js';
import { normalizeEnvValue, normalizeProcessEnv } from './envUtils.js';

// Keep platform-injected vars authoritative while still supporting local `.env` files.
const rawNodeEnv = normalizeEnvValue(process.env.NODE_ENV, {
  emptyStringAsUndefined: false,
});

if (rawNodeEnv !== 'production') {
  dotenv.config();
}

const normalizedEnv = normalizeProcessEnv(process.env, {
  preserveEmptyKeys: ['NODE_ENV'],
});

if (normalizedEnv.NODE_ENV === '') {
  logger.fatal(
    'NODE_ENV is set to an empty string. Remove the blank override or set NODE_ENV=production in Render.'
  );
  process.exit(1);
}

// =============================================================================
// ENVIRONMENT SCHEMA
// =============================================================================
// Define and validate all environment variables at startup.
// App will fail fast if required variables are missing.

const trustProxySchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }

  return value;
}, z.union([z.boolean(), z.number().int().min(0)]).optional());

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  
  // Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().min(8).max(14).default(10),
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().min(1).max(90).default(30),
  
  // Application
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_URL: z.string().url().optional(),
  TRUST_PROXY: trustProxySchema,
  
  // Token Economy
  SIGNUP_BONUS_TOKENS: z.coerce.number().min(0).default(0),
  WEEKLY_START_TOKENS: z.coerce.number().min(1).default(5),
  DAILY_ALLOWANCE_TOKENS: z.coerce.number().min(1).default(1),
  MAX_ALLOWANCE_TOKENS: z.coerce.number().min(1).default(11),
  MIN_STAKE_AMOUNT: z.coerce.number().min(1).default(1),
  MAX_STAKE_AMOUNT: z.coerce.number().min(1).default(11),
  
  // Rate Limiting
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().default(15),
  LOGIN_LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCKOUT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),

  // The Odds API
  THE_ODDS_API_KEY: z.string().min(1, 'THE_ODDS_API_KEY is required'),
  THE_ODDS_API_REGIONS: z.string().default('uk'),
  THE_ODDS_API_MARKETS: z.string().default('h2h'),
  THE_ODDS_API_BASE_URL: z.string().url().default('https://api.the-odds-api.com/v4'),
  ODDS_SYNC_INTERVAL_SECONDS: z.coerce.number().min(30).default(900),
  SETTLEMENT_INTERVAL_SECONDS: z.coerce.number().min(30).default(900),
  ODDS_SYNC_LOOKAHEAD_HOURS: z.coerce.number().int().min(1).default(48),
  ODDS_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(300),
  ODDS_SCORES_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(120),
  ODDS_STALENESS_THRESHOLD_MINUTES: z.coerce.number().int().min(1).default(30),
  ODDS_API_MONTHLY_QUOTA: z.coerce.number().int().min(1).default(500),
  EVENT_IMPORT_INTERVAL_SECONDS: z.coerce.number().min(60).default(21600),
  AUTO_IMPORT_SPORTS: z.string().default('soccer_epl'),
  CASHOUT_STALENESS_THRESHOLD_MS: z.coerce.number().int().min(1).default(300000),
  CASHOUT_ODDS_DRIFT_THRESHOLD_PERCENT: z.coerce.number().min(0).max(100).default(5),

  // Email (SMTP) — optional; if unset, reset emails are logged to console in dev
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.preprocess((v) => v === 'true' || v === true, z.boolean()).default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('no-reply@predictionplatform.com'),
  PASSWORD_RESET_EXPIRES_MINUTES: z.coerce.number().int().min(5).default(60),
});

// Parse and validate environment
const parseResult = envSchema.safeParse(normalizedEnv);

if (!parseResult.success) {
  logger.fatal({ errors: parseResult.error.format() }, 'Invalid environment variables');
  process.exit(1);
}

const env = parseResult.data;

if (env.NODE_ENV === 'production' && !env.FRONTEND_URL) {
  logger.fatal('FRONTEND_URL is required when NODE_ENV=production');
  process.exit(1);
}

const PLACEHOLDER_JWT_PATTERNS = [
  'change-this', 'change_this', 'changeme', 'your-secret', 'your_secret',
  'example', 'placeholder', 'secret', 'insecure',
];

if (env.NODE_ENV === 'production') {
  const jwtLower = env.JWT_SECRET.toLowerCase();
  if (PLACEHOLDER_JWT_PATTERNS.some((p) => jwtLower.includes(p))) {
    logger.fatal(
      'JWT_SECRET appears to be a placeholder value. Generate a secure secret with: openssl rand -base64 48'
    );
    process.exit(1);
  }
}

// =============================================================================
// CONFIGURATION OBJECT
// =============================================================================
// Structured config derived from environment variables.
// This is what the rest of the application imports.

export const config = {
  // Environment
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  
  // Server
  server: {
    port: env.PORT,
    frontendUrl: env.FRONTEND_URL,
    trustProxy: env.TRUST_PROXY,
  },
  
  // Database
  database: {
    url: env.DATABASE_URL,
  },
  
  // Authentication
  auth: {
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    bcryptRounds: env.BCRYPT_SALT_ROUNDS,
    refreshTokenExpiresDays: env.REFRESH_TOKEN_EXPIRES_DAYS,
    loginLockout: {
      maxAttempts: env.LOGIN_LOCKOUT_MAX_ATTEMPTS,
      windowMinutes: env.LOGIN_LOCKOUT_WINDOW_MINUTES,
    },
  },
  
  // Token Economy Rules
  tokens: {
    signupBonus: env.SIGNUP_BONUS_TOKENS,
    weeklyStart: env.WEEKLY_START_TOKENS,
    dailyAllowance: env.DAILY_ALLOWANCE_TOKENS,
    maxAllowance: env.MAX_ALLOWANCE_TOKENS,
    minStake: env.MIN_STAKE_AMOUNT,
    maxStake: env.MAX_STAKE_AMOUNT,
  },
  
  // Rate Limiting
  rateLimit: {
    max: env.RATE_LIMIT_MAX,
    windowMinutes: env.RATE_LIMIT_WINDOW_MINUTES,
  },

  oddsApi: {
    key: env.THE_ODDS_API_KEY,
    regions: env.THE_ODDS_API_REGIONS,
    markets: env.THE_ODDS_API_MARKETS,
    baseUrl: env.THE_ODDS_API_BASE_URL,
    syncIntervalSeconds: env.ODDS_SYNC_INTERVAL_SECONDS,
    settlementIntervalSeconds: env.SETTLEMENT_INTERVAL_SECONDS,
    syncLookaheadHours: env.ODDS_SYNC_LOOKAHEAD_HOURS,
    cacheTtlMs: env.ODDS_CACHE_TTL_SECONDS * 1000,
    scoresCacheTtlMs: env.ODDS_SCORES_CACHE_TTL_SECONDS * 1000,
    stalenessThresholdMs: env.ODDS_STALENESS_THRESHOLD_MINUTES * 60 * 1000,
    monthlyQuota: env.ODDS_API_MONTHLY_QUOTA,
    importIntervalSeconds: env.EVENT_IMPORT_INTERVAL_SECONDS,
    autoImportSports: env.AUTO_IMPORT_SPORTS.split(',')
      .map((sport) => sport.trim())
      .filter((sport) => sport.length > 0),
  },
  cashout: {
    stalenessThresholdMs: env.CASHOUT_STALENESS_THRESHOLD_MS,
    oddsDriftThresholdPercent: env.CASHOUT_ODDS_DRIFT_THRESHOLD_PERCENT,
  },
  email: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
    passwordResetExpiresMinutes: env.PASSWORD_RESET_EXPIRES_MINUTES,
  },
} as const;

// Type export for use in other modules
export type Config = typeof config;
