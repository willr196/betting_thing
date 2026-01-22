import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// =============================================================================
// ENVIRONMENT SCHEMA
// =============================================================================
// Define and validate all environment variables at startup.
// App will fail fast if required variables are missing.

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  
  // Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().min(8).max(14).default(10),
  
  // Application
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_URL: z.string().url().optional(),
  
  // Token Economy
  SIGNUP_BONUS_TOKENS: z.coerce.number().min(0).default(0),
  DAILY_ALLOWANCE_TOKENS: z.coerce.number().min(1).default(5),
  MAX_ALLOWANCE_TOKENS: z.coerce.number().min(1).default(35),
  MIN_STAKE_AMOUNT: z.coerce.number().min(1).default(1),
  MAX_STAKE_AMOUNT: z.coerce.number().min(1).default(35),
  
  // Rate Limiting
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().default(15),

  // The Odds API
  THE_ODDS_API_KEY: z.string().min(1, 'THE_ODDS_API_KEY is required'),
  THE_ODDS_API_REGIONS: z.string().default('uk'),
  THE_ODDS_API_MARKETS: z.string().default('h2h'),
  THE_ODDS_API_BASE_URL: z.string().url().default('https://api.the-odds-api.com/v4'),
  ODDS_SYNC_INTERVAL_SECONDS: z.coerce.number().min(30).default(300),
  SETTLEMENT_INTERVAL_SECONDS: z.coerce.number().min(30).default(300),
});

// Parse and validate environment
const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parseResult.error.format());
  process.exit(1);
}

const env = parseResult.data;

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
  },
  
  // Token Economy Rules
  tokens: {
    signupBonus: env.SIGNUP_BONUS_TOKENS,
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
  },
} as const;

// Type export for use in other modules
export type Config = typeof config;
