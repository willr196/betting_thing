# Prediction Platform — Full Optimisation Prompt

Use this prompt in a new Claude conversation (or Claude Code session) with access to the `prediction-platform` repository.

---

## Context

You are working on **betting_thing**, a token-based sports prediction platform. The stack is TypeScript/Node.js/Express (backend), PostgreSQL via Prisma ORM, and React/Vite/Tailwind (frontend). It's deployed on Railway (backend + Postgres) and Vercel (frontend).

**Core architecture rules (non-negotiable):**
- **Ledger-first**: `TokenTransaction` and `PointsTransaction` tables are immutable, append-only. Balances are derived, never directly mutated.
- **Free-entry model**: No token purchasing, no cash payouts. Users get 5 free tokens/day (stacking to 35 max). Winnings pay out in points redeemable for rewards.
- **Dual currency**: Tokens for staking, points for winnings. Two separate ledgers.
- **Atomic operations**: All balance-changing operations must use Prisma `$transaction` with row-level locking (`FOR UPDATE`).

**External dependency**: The Odds API (free tier, 500 requests/month) provides live odds and scores for settlement. The current 5-minute polling interval burns through the quota in ~1 day. This is the immediate crisis.

---

## Task: Full Platform Optimisation

Work through the following tasks in order. For each change: explain what you're doing and why, make the code change, and confirm it compiles (`npm run typecheck`). Commit logically grouped changes together.

---

### 1. Odds API Request Optimisation (CRITICAL — do this first)

The platform is currently burning through its entire monthly Odds API quota in roughly a day. Fix this comprehensively:

**a) Add response caching with TTL to `OddsApiService` (`src/services/oddsApi.ts`)**
- Cache `getOddsForSport()` responses in memory with a configurable TTL (default 5 minutes).
- Cache `getEventOdds()` — if we already fetched odds for that sport recently, extract the event from the cached sport response instead of making a separate API call.
- Cache `getScores()` responses with a shorter TTL (default 2 minutes).
- Add a `remainingRequests` tracker by reading the `x-requests-remaining` header from Odds API responses and logging it.
- Add a `clearCache()` method for the admin sync endpoint to force-refresh.

**b) Smart polling in `OddsSyncService` (`src/services/oddsSync.ts`)**
- Only poll odds for events starting within the next 48 hours (configurable via env var `ODDS_SYNC_LOOKAHEAD_HOURS`, default 48).
- Increase the default polling interval to 15 minutes (`ODDS_SYNC_INTERVAL_SECONDS` default 900).
- Skip polling entirely if there are no active events with external mappings.
- Log the remaining API quota after each sync.

**c) Smart polling in `SettlementWorker` (`src/services/settlementWorker.ts`)**
- Only poll scores for events that are `LOCKED` and whose `startsAt` is in the past (the game should have started).
- Increase the default settlement interval to 15 minutes (`SETTLEMENT_INTERVAL_SECONDS` default 900).
- Skip polling if there are no eligible events.

**d) Fall back to cached odds for predictions (`src/services/predictions.ts`)**
- In `PredictionService.place()`, if the live API call fails (quota exhausted, network error), fall back to `event.currentOdds` from the database if it's less than 30 minutes old (configurable via env var `ODDS_STALENESS_THRESHOLD_MINUTES`, default 30).
- Only throw `ODDS_STALE` if the cached odds are older than the threshold.
- Apply the same fallback logic to `getCashoutValue()` and `executeCashout()`.

**e) Add a new env var `ODDS_API_MONTHLY_QUOTA` (default 500) and track usage**
- Log a warning when quota drops below 20%.
- Stop non-essential polling (odds sync) when quota drops below 10%, but still allow on-demand fetches for placing predictions.

---

### 2. Settlement Security Fixes (Phase 1 from CLAUDE.md)

**a) Add `FOR UPDATE` row locks to settlement (`src/services/events.ts`)**
- In `EventService.settle()`, lock the event row with `FOR UPDATE` before processing to prevent double-settlement race conditions.
- Lock each prediction row with `FOR UPDATE` before updating its status.

**b) Add `FOR UPDATE` to cancellation**
- Same pattern in `EventService.cancel()` — lock event and predictions before refunding.

**c) Cashout odds staleness guard**
- In `PredictionService.executeCashout()`, re-fetch odds inside the transaction and compare with the odds used to calculate the cashout value. If they've drifted more than 5% (configurable), abort with a clear error asking the user to retry.

---

### 3. Auth Hardening (Phase 2)

**a) Ensure `failedLoginAttempts` and `lockedUntil` are properly used**
- The migration added `failedLoginAttempts` and `lockedUntil` columns. Make sure `AuthService.login()` increments `failedLoginAttempts` on failed login, locks the account for 15 minutes after 5 consecutive failures, and resets the counter on successful login.

**b) Add rate limiting middleware**
- Add `express-rate-limit` to auth endpoints: 10 attempts per 15 minutes per IP for `/auth/login` and `/auth/register`.
- Add a general rate limiter: 100 requests per 15 minutes per IP for all other endpoints.
- Use the existing `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MINUTES` env vars.

**c) Remove dead code**
- Check if `LedgerService.creditPredictionWin()` is still referenced anywhere. If not, remove it (winnings now go through the points ledger).

---

### 4. Token Allowance Accuracy (Phase 2)

**a) Fix `tokensRemaining` in `TokenAllowance`**
- The `tokensRemaining` field can drift from the actual ledger balance. After any token operation (stake, refund, daily credit), ensure `tokensRemaining` is updated to match the user's actual `tokenBalance` from the ledger.
- Add a reconciliation check in `TokenAllowanceService.getStatus()` that compares `tokensRemaining` with the user's cached balance and auto-repairs if they differ.

---

### 5. Event Lifecycle Automation (Phase 3)

**a) Auto-lock events on startup and on a schedule**
- On server startup (`src/index.ts`), call `EventService.autoLockStartedEvents()`.
- Add it to the settlement worker interval so events are auto-locked on each tick.

**b) Auto-import events on startup (if the API has quota)**
- On startup, if there are fewer than 5 OPEN events and the API quota allows, trigger the event import for configured sports.
- Make the auto-import sports list configurable via env var `AUTO_IMPORT_SPORTS` (default: `soccer_epl`).

**c) Stale event cleanup**
- Add a cleanup job that runs daily (or on each settlement tick): for events that are `OPEN` and `startsAt` is more than 24 hours in the past with no predictions, auto-cancel them.
- For events with predictions that are past start time, auto-lock them.

---

### 6. Frontend Polish (Phase 4)

**a) Error toast notifications**
- Replace `window.alert()` and inline error messages with a toast notification system. Use a simple React context + provider pattern (no external library needed).
- Show toasts for: prediction placed, cashout success, login errors, network errors.

**b) Cashout without page reload**
- After a successful cashout in `PredictionDetailPage` or `MyPredictionsPage`, update the prediction status in local state without requiring a full page reload.

**c) Transaction history page**
- Add a `/transactions` page that shows the user's token and points transaction history with type badges, timestamps, and running balance.

---

### 7. Production Hardening (Phase 5)

**a) Structured logging**
- Replace all `console.log` / `console.error` calls with a lightweight structured logger (use `pino` — it's fast and JSON-native).
- Log request ID, user ID, and timing for each request.
- Log all settlement and odds sync operations with structured data.

**b) Add Vitest test suite**
- Set up Vitest with a test config.
- Write unit tests for:
  - `LedgerService.credit()` and `LedgerService.debit()` — test balance calculations, insufficient balance errors
  - `determinOutcome()` in settlement worker — test win/loss/draw mapping
  - `calculateCashoutValue()` — test the cashout formula
  - Odds API cache — test TTL expiry, cache hits/misses
- Write integration tests for:
  - Auth flow: register → login → get profile
  - Prediction flow: get events → place prediction → verify balance deducted

**c) Database backups**
- Add a note to `CLAUDE.md` about setting up Railway's automatic backup feature or a pg_dump cron job.

**d) CSP headers**
- Add `helmet` middleware with sensible Content Security Policy defaults.

---

### 8. Update CLAUDE.md

After completing the above, update `CLAUDE.md` to reflect:
- What was completed and when
- Any new env vars added
- Any architectural decisions made
- Remaining work items (if any)

---

## Important Notes

- **Never skip migrations**: If you modify the Prisma schema, always generate a migration (`npx prisma migrate dev --name descriptive-name`). The production incident caused by the missing `failedLoginAttempts` migration must not repeat.
- **Test before committing**: Run `npm run typecheck` after each change. Run `npm run build` before the final commit.
- **Don't expose secrets**: Never log or return API keys, database URLs, or JWT secrets.
- **Preserve the ledger pattern**: All token/points movements must go through `LedgerService` or `PointsLedgerService`. Never update `tokenBalance` or `pointsBalance` directly.
- **Railway env var hygiene**: Don't use quotes around values in Railway's env var editor — this has caused production incidents before.
- **The Odds API free tier is 500 requests/month**: Every API call counts. Design accordingly.
