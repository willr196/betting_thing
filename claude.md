# CLAUDE.md — Prediction Platform

## Project Overview

Token-based prediction platform. Users predict sports outcomes using free daily tokens, win points, redeem for rewards. Free-entry model — no real money, no gambling regulations.

- **Stack:** TypeScript, Node.js, Express, PostgreSQL (Prisma ORM), React/Vite frontend
- **Backend:** Railway (`bettingthing-production.up.railway.app`)
- **Frontend:** Vercel (`willr196-bettingthing.vercel.app`)
- **Repo:** `willr196/betting_thing`
- **Odds Data:** The Odds API (free tier, 500 credits/month)

## Architecture Principles

- **Ledger-first:** TokenTransaction and PointsTransaction tables are immutable, append-only. User balances are cached but the ledger is the source of truth.
- **Dual currency:** Tokens (free, given daily, used for staking) and Points (won from correct predictions, redeemable for rewards). These must NEVER be mixed up.
- **Atomic operations:** All balance-affecting operations must use Prisma `$transaction` with appropriate row locks (`FOR UPDATE`).
- **No real money:** No token purchases, no cash payouts, no withdrawals. This is a legal requirement.

## Key Files

```
src/services/eventImport.ts   — Imports events from The Odds API (NEW)
src/services/oddsSync.ts      — Updates odds on existing events
src/services/settlementWorker.ts — Auto-settles completed events
src/services/oddsApi.ts        — The Odds API client
src/services/events.ts         — Event CRUD and lifecycle (settle, cancel, lock)
src/services/predictions.ts    — Prediction placement and cashout
src/services/ledger.ts         — Token ledger (immutable, append-only)
src/services/pointsLedger.ts   — Points ledger (immutable, append-only)
src/services/tokenAllowance.ts — Daily token grants
src/routes/admin.ts            — Admin API routes
src/routes/auth.ts             — Auth routes (register, login, refresh)
src/routes/events.ts           — Public event routes
src/routes/predictions.ts      — Prediction routes
src/middleware/auth.ts          — JWT auth middleware
prisma/schema.prisma           — Database schema
scripts/importEvents.ts        — CLI script to import events from Odds API
```

## Common Commands

```bash
# Import events from The Odds API
npx tsx scripts/importEvents.ts --all
npx tsx scripts/importEvents.ts soccer_epl soccer_uefa_champs_league

# Run migrations
npx prisma migrate dev --name <name>
DATABASE_URL="<prod_url>" npx prisma migrate deploy

# Generate Prisma client after schema changes
npx prisma generate

# Build and run
npm run build && npm start
npm run dev  # development with hot reload

# Health check
curl https://bettingthing-production.up.railway.app/api/v1/health

# Deploy: push to main (Railway auto-deploys backend, Vercel auto-deploys frontend)
```

## Available Sport Keys

`soccer_epl`, `soccer_spain_la_liga`, `soccer_italy_serie_a`, `soccer_germany_bundesliga`, `soccer_france_ligue_one`, `soccer_uefa_champs_league`

Each API call costs ~1 credit. Free tier = 500/month.

---

## OUTSTANDING TASKS (Priority Order)

### PHASE 1 — CRITICAL SECURITY PATCHES (Must fix before any real users)

#### 1. Settlement Double-Pay Prevention
**File:** `src/services/events.ts` — `settle()` method
**Problem:** Event status check happens OUTSIDE the transaction. Two concurrent settlement calls can both pass the check and double-pay all winners. Predictions are also fetched outside the transaction, so a cashout could happen between fetch and processing.
**Fix:**
- Move the event fetch INSIDE the `$transaction` block
- Use `FOR UPDATE` row lock on the event: `SELECT ... FROM "Event" WHERE "id" = $1 FOR UPDATE`
- Re-check `status !== 'SETTLED'` inside the transaction
- Fetch predictions INSIDE the transaction with `status: 'PENDING'`
- Add per-prediction idempotency: check each prediction is still PENDING before crediting
- Add transaction timeout: `{ timeout: 30000 }`
**Test:** Try settling the same event twice concurrently — only one should succeed.

#### 2. Cancel Race Condition
**File:** `src/services/events.ts` — `cancel()` method
**Problem:** Same pattern as settle — status check and prediction fetch happen outside the transaction.
**Fix:** Same approach: lock event row with `FOR UPDATE` inside transaction, fetch predictions inside, re-check status.

#### 3. Cashout Odds Staleness Guard
**File:** `src/services/predictions.ts` — `getCashoutValue()` and `executeCashout()` methods
**Problem:** Cashout uses live odds but has no check that the odds are recent enough. If the API is slow or returns cached data, users could cash out on stale/manipulable odds.
**Fix:**
- After fetching odds, check the `oddsUpdatedAt` timestamp
- If odds are older than 5 minutes (configurable via env var `CASHOUT_STALENESS_THRESHOLD_MS`, default 300000), reject the cashout with a clear error
- Return error: "Odds data is too old to cashout safely. Please try again."

#### 4. Settlement Worker Resilience
**File:** `src/services/settlementWorker.ts` — `runOnce()` method
**Problem:** If one event fails to settle, the entire worker run throws and stops. Subsequent events don't get processed.
**Fix:**
- Wrap each event settlement in its own try/catch
- Log errors per event and continue with the rest
- Track `settledEvents` and `failedEvents` counts
- Return summary of successes and failures

### PHASE 2 — HIGH PRIORITY FIXES

#### 5. Auth Rate Limiting
**File:** `src/routes/auth.ts` or new middleware
**Problem:** Only global rate limiting exists. Auth endpoints (login, register) need stricter limits to prevent brute force.
**Fix:**
- Add endpoint-specific rate limiting: 5 attempts per 15 minutes on `/auth/login`
- Consider account lockout after 10 failed attempts (temporary, 30-minute lockout)
- Use `express-rate-limit` with a separate limiter instance for auth routes

#### 6. Remove Dead Code
**File:** `src/services/ledger.ts`
**Problem:** `LedgerService.creditPredictionWin()` still exists but settlement correctly uses `PointsLedgerService.credit()`. The dead method credits TOKENS instead of POINTS — if anyone accidentally calls it, the economy breaks.
**Fix:** Delete `creditPredictionWin()` from `LedgerService`. Verify nothing references it with a project-wide search.

#### 7. Fix tokensRemaining Accuracy
**File:** `src/services/tokenAllowance.ts` — `consumeTokens()` method
**Problem:** Sets `tokensRemaining` to `result.newBalance` (total token balance from ledger) instead of actual remaining daily allowance.
**Fix:** Replace `tokensRemaining: result.newBalance` with `tokensRemaining: Math.max(0, status.tokensRemaining - amount)`

#### 8. Admin Stats — Add Points Metrics
**File:** `src/routes/admin.ts` — GET `/admin/stats` endpoint
**Problem:** Reports `tokensInCirculation` but not points metrics.
**Fix:** Add `pointsInCirculation`, `totalPointsPaidOut`, `totalPointsRedeemed` to the stats response by aggregating from PointsTransaction table.

### PHASE 3 — AUTO-SYNC AND EVENT LIFECYCLE

#### 9. Auto-Import Events on Server Startup
**File:** `src/index.ts` and new `src/services/eventImport.ts`
**Problem:** Events must be manually imported. The `OddsSyncService` only updates odds on existing events — it never creates new ones.
**Fix:**
- Create `src/services/eventImport.ts` (use `scripts/importEvents.ts` as reference but adapted as a service)
- On server startup (in `src/index.ts`), run initial import
- Set up interval to re-import every 6 hours (configurable)
- Add admin route `POST /admin/events/import` for manual trigger
- The import should skip events that already exist (match by `externalEventId`)
- Update odds on existing events while importing

#### 10. Auto-Lock Events at Start Time
**Already exists** as `EventService.autoLockStartedEvents()` — verify it's being called on an interval. It should run every minute or on each settlement worker cycle.

#### 11. Cleanup Stale Events
**New task:** Events that have been OPEN for a long time but whose `startsAt` has passed should be auto-locked. Events that are LOCKED but have no score data after 24 hours should be flagged for manual review or auto-cancelled.

### PHASE 4 — FRONTEND POLISH

#### 12. Error Toasts
**Files:** Frontend components
**Problem:** Errors show as inline text or console logs. Need user-facing toast notifications.
**Fix:** Add a toast library (e.g., react-hot-toast or sonner) and wire it into API error handlers.

#### 13. Cashout Without Page Reload
**File:** `frontend/src/pages/` — prediction detail or list page
**Problem:** After cashout, the page requires a manual reload to reflect the updated state.
**Fix:** After successful cashout API call, update local state immediately and refresh user balance.

#### 14. Transaction/Points History Display
**Files:** Frontend — new page or component
**Problem:** Users can't see their token/points transaction history in the UI.
**Fix:** Add a history page that calls `GET /auth/transactions` and `GET /points/transactions` and displays them in a timeline or table.

### PHASE 5 — PRODUCTION HARDENING

#### 15. Structured Logging
Replace `console.log` / `console.error` with Pino or Winston. Add request correlation IDs.

#### 16. Test Suite
Add Vitest. Priority test targets:
- Ledger services (credit, debit, balance integrity)
- Settlement logic (winners get points, losers don't, double-settle prevention)
- Cashout calculation
- Auth flows (register, login, token refresh)

#### 17. CI/CD Pipeline
GitHub Actions: lint, type-check, test on PR. Auto-deploy on merge to main.

#### 18. Database Backups
Configure Railway's automatic backups or pg_dump cron.

#### 19. Content Security Policy
Configure Helmet CSP headers properly for the frontend origin.

#### 20. API Versioning
Prefix all routes with `/api/v1/` for future-proofing.

---

## Environment Variables

Key vars (see `.env.example` for full list):
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — JWT signing secret (use a strong random value in production)
- `THE_ODDS_API_KEY` — The Odds API key
- `FRONTEND_URL` — CORS origin for frontend
- `ODDS_SYNC_INTERVAL_SECONDS` — How often to update odds (default 300)
- `SETTLEMENT_INTERVAL_SECONDS` — How often to check for completed events (default 300)
- `DAILY_ALLOWANCE_TOKENS` — Daily free tokens (default 5)
- `MAX_ALLOWANCE_TOKENS` — Max stacked tokens (default 35)
- `MIN_STAKE_AMOUNT` / `MAX_STAKE_AMOUNT` — Stake bounds (default 1/35)

## Event Lifecycle

```
OPEN → LOCKED → SETTLED
                ↘ CANCELLED (at any point before SETTLED)
```

- **OPEN:** Accepting predictions. Auto-created by import service.
- **LOCKED:** Event has started, no more predictions. Auto-locked when `startsAt` passes.
- **SETTLED:** Outcome determined, winners credited points, losers marked. Done by settlement worker using Odds API scores.
- **CANCELLED:** Event cancelled, all PENDING predictions refunded tokens.

## Important Rules

1. NEVER credit tokens for prediction wins — always use PointsLedgerService
2. NEVER allow token purchases — free-entry model only
3. ALL balance changes must go through the ledger services, never direct DB updates
4. ALL financial operations must be in Prisma transactions with appropriate locks
5. The ledger tables (TokenTransaction, PointsTransaction) are IMMUTABLE — never update or delete rows