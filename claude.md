# CLAUDE.md — Prediction Platform

## Project Overview

Token-based sports prediction platform. Users stake free daily tokens on outcomes and earn points for wins/cashouts. No real-money flows.

- Stack: TypeScript, Node.js, Express, PostgreSQL (Prisma), React/Vite frontend
- Backend deploy: Railway
- Frontend deploy: Vercel
- Odds provider: The Odds API (free tier target: 500/month)

## Core Architecture Rules

1. Ledger-first: `TokenTransaction` and `PointsTransaction` are append-only sources of truth.
2. Dual currency: tokens for staking, points for rewards. Never mix ledgers.
3. Atomicity: all balance-changing operations run inside Prisma transactions with row locks.
4. Free-entry model: no token purchasing and no cash payouts.

## Optimisation Update (March 4, 2026)

### Completed

1. Odds API optimisation
- Added in-memory TTL caching in `src/services/oddsApi.ts`:
  - sport odds cache (default 5m)
  - scores cache (default 2m)
  - `getEventOdds()` now reuses cached sport odds (no extra event-specific call when cached)
- Added quota tracking via `x-requests-remaining` with structured logs.
- Added quota safeguards:
  - warning below 20%
  - non-essential polling pause below 10%
- Added `OddsApiService.clearCache()` for forced admin sync refresh.
- `src/services/oddsSync.ts` now:
  - syncs only mapped events within lookahead window (default 48h)
  - skips when no eligible mapped events
  - skips when quota is critically low
  - logs quota status after each run
- `src/services/settlementWorker.ts` now:
  - polls only `LOCKED` events that have started
  - skips when no eligible events
- Prediction odds resilience (`src/services/predictions.ts`):
  - live odds fetch attempted first
  - fallback to DB cached odds when live fetch fails
  - stale threshold enforced via env-configurable limit
  - cashout path uses same fallback model

2. Settlement and cashout hardening
- Settlement and cancel paths already use row-level locking and transactional idempotency in `src/services/events.ts`.
- Added cashout revalidation in `PredictionService.cashout()`:
  - re-fetches odds inside transaction
  - compares against preview odds
  - aborts when drift exceeds threshold (default 5%)

3. Auth/rate-limit hardening
- Updated login lockout defaults to 5 attempts / 15 minutes.
- Improved lockout counter handling in `src/services/auth.ts`:
  - failed attempts increment correctly
  - lockout applied after threshold
  - counter reset after successful login
- Added stricter auth endpoint limiters:
  - `/auth/login`: 10 per 15m
  - `/auth/register`: 10 per 15m
- Global limiter remains env-driven and skips login/register routes.

4. Token allowance accuracy
- `TokenAllowanceService` now reconciles allowance against user ledger balance in `getStatus()`.
- Added `syncToLedgerBalance()` to realign `tokensRemaining` after ledger changes.
- Stake consumption now writes `tokensRemaining` from authoritative post-debit balance.
- Event cancellation now syncs allowance after each refund.

5. Event lifecycle automation
- On startup (`src/index.ts`):
  - auto-lock started events
  - cleanup stale unpredicted events
  - auto-import events only when OPEN inventory is low and quota permits
- Settlement worker now also runs lifecycle automation each tick:
  - auto-lock started events
  - stale event cleanup
- Startup auto-import sports list is env-configurable.

6. Frontend polish
- Replaced `sonner` with internal toast system:
  - `frontend/src/context/ToastContext.tsx`
  - wired into login, register, prediction placement/cashout, rewards, wallet errors
- Added `/transactions` page:
  - merged token + points history
  - type/currency badges
  - timestamps
  - running balances
- Cashout state updates in prediction list remain local-state based (no page reload).

7. Tests and logging
- Added unit tests:
  - `src/__tests__/ledger.test.ts` for credit/debit balance behavior
  - `src/__tests__/oddsApi.test.ts` for cache TTL hit/miss behavior
- Added opt-in integration flow tests:
  - `src/__tests__/integration.flows.test.ts`
  - enabled only when `RUN_INTEGRATION_TESTS=true`
- Request logging now includes request ID, user ID (when available), status code, and duration.

8. Engagement phase (leaderboard, streaks, achievements, wallet dashboard)
- Added persistent leaderboard model + period rankings (weekly, monthly, all-time) with streak tracking.
- Settlement now updates leaderboard records for every settled prediction.
- Added streak bonus awarding logic (3/5/10 win streak milestones) with ledger credits.
- Added leaderboard API routes:
  - `GET /leaderboard?period=weekly|monthly|all-time`
  - `GET /leaderboard/me`
- Added frontend leaderboard page and navigation entry.
- Added achievement system:
  - `Achievement` + `UserAchievement` schema and migrations
  - award checks on prediction placement, settlement, cashout, and redemption
  - endpoints: `GET /achievements`, `GET /achievements/me`, `GET /achievements/progress`
- Added wallet dashboard endpoint (`GET /auth/dashboard`) and frontend enhancements:
  - prediction performance stats
  - current/longest streak
  - combined recent activity feed
  - closest achievements with progress bars
  - full achievements grid with unlocked state
- Added achievement toast notifications on user-triggered unlock events.

### New/Updated Environment Variables

- `ODDS_SYNC_INTERVAL_SECONDS` (default `900`)
- `SETTLEMENT_INTERVAL_SECONDS` (default `900`)
- `ODDS_SYNC_LOOKAHEAD_HOURS` (default `48`)
- `ODDS_CACHE_TTL_SECONDS` (default `300`)
- `ODDS_SCORES_CACHE_TTL_SECONDS` (default `120`)
- `ODDS_STALENESS_THRESHOLD_MINUTES` (default `30`)
- `ODDS_API_MONTHLY_QUOTA` (default `500`)
- `AUTO_IMPORT_SPORTS` (default `soccer_epl`, comma-separated)
- `CASHOUT_ODDS_DRIFT_THRESHOLD_PERCENT` (default `5`)

## Production Notes

### Database Backups

Enable one of the following for production resilience:

1. Railway managed backups (recommended): configure automated backup cadence and retention in Railway Postgres settings.
2. External `pg_dump` cron: run scheduled dumps to durable object storage (S3-compatible) with tested restore procedure.

Do not treat this as optional before scaling user traffic.

### Security and Operations

- Keep `JWT_SECRET` strong and non-placeholder in production.
- Do not quote env var values in Railway when editing config.
- Keep Odds API usage budget-aware; every request counts toward monthly quota.

## Remaining Work Items

1. Expand integration coverage to full HTTP route-level scenarios if CI/database test infrastructure is added.
2. Add CI workflow to enforce lint/typecheck/test gates on pull requests.
3. Continue frontend error-state cleanup where inline fallback UI is still used for full-page load failures.
