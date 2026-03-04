# Prediction Platform — Deep Optimisation & Feature Expansion Prompt

Use this prompt in a new Claude conversation (or Claude Code session) with full access to the `prediction-platform` repository. This prompt assumes Phase 1-2 security work is mostly done. It focuses on making the platform genuinely impressive, engaging, and production-ready.

---

## Context

You are working on **betting_thing**, a token-based sports prediction platform. Stack: TypeScript/Node.js/Express backend, PostgreSQL via Prisma, React/Vite/Tailwind frontend. Deployed on Railway (backend + Postgres) and Vercel (frontend). The Odds API (free tier, 500 req/month) provides live odds and scores.

**Hard constraints (never violate):**
- Ledger-first: `TokenTransaction` and `PointsTransaction` are immutable append-only. Balances derived, never directly mutated.
- Free-entry only: No token purchasing, no cash payouts. 5 free tokens/day, max 35 stacked.
- Dual currency: Tokens for staking, points for winnings/cashouts. Two separate ledgers.
- All balance ops use `$transaction` + `FOR UPDATE` row locks.
- Every schema change needs a Prisma migration. No exceptions.

**Current state:**
- Backend: `bettingthing-production.up.railway.app`
- Frontend: `willr196-bettingthing.vercel.app`
- Frontend pages: Login, Register, Events list, Event detail (place prediction), My Predictions (with cashout), Rewards, Wallet
- Backend services: Auth, Ledger, PointsLedger, Predictions (place/cashout), Events (CRUD/settle/cancel), Rewards/Redemptions, OddsSync, SettlementWorker, TokenAllowance
- No admin frontend — all admin ops are API-only
- No leaderboard, streaks, achievements, notifications, or social features
- No multi-sport filtering on frontend
- No transaction history page
- No structured logging or test suite

---

## Part 1: Odds API Survival Strategy

The free tier (500 req/month) gets burned in ~1 day at current polling rates. Fix this comprehensively.

### 1.1 In-Memory Cache Layer (`src/services/oddsApi.ts`)

Add a cache to `OddsApiService` that wraps all API calls:

```typescript
// Cache structure
interface CacheEntry<T> { data: T; timestamp: number; }
const cache = new Map<string, CacheEntry<any>>();

// Config via env vars
ODDS_CACHE_TTL_SECONDS=300        // 5 min for odds
SCORES_CACHE_TTL_SECONDS=120      // 2 min for scores
ODDS_STALENESS_THRESHOLD_MINUTES=30  // Fallback threshold
```

- `getOddsForSport()`: Check cache first. On hit, return cached. On miss, fetch, cache, return.
- `getEventOdds()`: Extract from the cached sport-level response if available — don't make a separate API call per event. This is the biggest quota saver.
- `getScores()`: Cache with shorter TTL.
- Read `x-requests-remaining` and `x-requests-used` headers from every Odds API response. Store them. Log them.
- Add `getRemainingQuota()` method that returns the last-known remaining requests.
- Add `clearCache(sportKey?: string)` for admin force-refresh.
- If `x-requests-remaining` drops below 50 (10%), disable background polling and log a warning. Still allow on-demand fetches for prediction placement.

### 1.2 Smart Polling (`src/services/oddsSync.ts` and `src/services/settlementWorker.ts`)

**OddsSyncService:**
- Only fetch odds for sports that have OPEN events starting within 48h (env: `ODDS_SYNC_LOOKAHEAD_HOURS=48`).
- If no eligible events exist, skip entirely and log "No events eligible for odds sync".
- After sync, log: `Odds sync complete: ${updatedEvents} updated, ${remaining} API requests remaining`.
- Default interval: 900s (15 min) instead of 300s.

**SettlementWorker:**
- Only fetch scores for LOCKED events whose `startsAt` is in the past (game should have started).
- Skip if no eligible events.
- Default interval: 900s.

### 1.3 Graceful Fallback for Predictions (`src/services/predictions.ts`)

In `PredictionService.place()`:
- Try live odds first.
- If the API call fails (network error, 401/429 quota exhausted), fall back to `event.currentOdds` from the database.
- Only accept cached odds if `event.oddsUpdatedAt` is within `ODDS_STALENESS_THRESHOLD_MINUTES` (default 30).
- If cached odds are too stale, throw a clear error: "Live odds unavailable and cached odds are too old. Please try again later."
- Apply the same fallback in `getCashoutValue()` and `executeCashout()`.

---

## Part 2: Engagement Features (make people want to come back)

### 2.1 Leaderboard System

**Schema additions:**
```prisma
model Leaderboard {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  period    LeaderboardPeriod
  periodKey String   // e.g. "2026-W10", "2026-03", "all-time"
  
  totalPredictions Int @default(0)
  wins             Int @default(0)
  losses           Int @default(0)
  totalPointsWon   Int @default(0)
  winRate          Float @default(0)
  longestStreak    Int @default(0)
  currentStreak    Int @default(0)
  
  updatedAt DateTime @updatedAt
  
  @@unique([userId, period, periodKey])
  @@index([period, periodKey, totalPointsWon])
}

enum LeaderboardPeriod {
  WEEKLY
  MONTHLY
  ALL_TIME
}
```

**Backend:**
- `LeaderboardService` with `updateAfterSettlement(userId, won: boolean, pointsWon: number)` — called from `EventService.settle()` after each prediction is processed.
- `getLeaderboard(period, periodKey, limit=20)` — returns top users for that period.
- `getUserRank(userId, period, periodKey)` — returns the user's position.
- Weekly period key format: `YYYY-WXX` (ISO week). Monthly: `YYYY-MM`.
- API endpoints: `GET /leaderboard?period=weekly` (public), `GET /leaderboard/me` (authenticated).

**Frontend:**
- New `/leaderboard` page with tabs for Weekly / Monthly / All-Time.
- Show rank, username (anonymised first 3 chars of email + "***"), win rate, points won, current streak.
- Highlight the logged-in user's row.
- Add a "Leaderboard" nav item.

### 2.2 Streak Tracking & Bonus System

**Logic (inside LeaderboardService):**
- Track `currentStreak` (consecutive wins) and `longestStreak` per user.
- On settlement: if won, increment `currentStreak`. If lost, reset to 0.
- **Streak bonus**: When a user hits a 3-win streak, award bonus tokens via the ledger:
  - 3-win streak: +2 bonus tokens
  - 5-win streak: +5 bonus tokens
  - 10-win streak: +10 bonus tokens
- Add a new `TransactionType`: `STREAK_BONUS`
- Log the streak bonus in the transaction description: "3-win streak bonus!"

**Frontend:**
- Show current streak on the Wallet page and in the nav bar (flame emoji + count when streak >= 2).
- Show streak milestone notifications (toast) when bonus is awarded.

### 2.3 Achievement / Badge System

**Schema:**
```prisma
model Achievement {
  id          String @id @default(cuid())
  key         String @unique   // e.g. "first_prediction", "10_wins", "streak_5"
  name        String           // "First Blood", "Veteran", "Hot Streak"
  description String
  iconEmoji   String           // "🎯", "🏆", "🔥"
  category    String           // "predictions", "streaks", "social"
  threshold   Int              // e.g. 10 for "10 wins"
}

model UserAchievement {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  achievementId String
  achievement   Achievement @relation(fields: [achievementId], references: [id])
  unlockedAt    DateTime @default(now())
  
  @@unique([userId, achievementId])
}
```

**Seed achievements:**
- `first_prediction` — "First Blood" — Place your first prediction 🎯
- `first_win` — "Winner Winner" — Win your first prediction 🏆
- `10_predictions` — "Getting Serious" — Place 10 predictions 📊
- `10_wins` — "Veteran" — Win 10 predictions ⭐
- `50_wins` — "Elite Predictor" — Win 50 predictions 👑
- `streak_3` — "Hat Trick" — 3-win streak 🔥
- `streak_5` — "On Fire" — 5-win streak 🔥🔥
- `streak_10` — "Unstoppable" — 10-win streak 💎
- `first_cashout` — "Early Bird" — Cash out a prediction 🐣
- `first_redemption` — "Shopper" — Redeem a reward 🛍️
- `points_1000` — "Point Collector" — Earn 1,000 total points 💰
- `points_10000` — "High Roller" — Earn 10,000 total points 💎

**Backend:**
- `AchievementService.checkAndAward(userId, context)` — called after predictions, settlements, cashouts, redemptions. Checks if any unearned achievements should be unlocked.
- `GET /achievements` — list all achievements with user's unlock status.
- `GET /achievements/me` — list user's unlocked achievements.

**Frontend:**
- Achievements section on the Wallet/Profile page — grid of badges (greyed out if locked, coloured if unlocked, with unlock date).
- Toast notification when an achievement is unlocked: "🏆 Achievement Unlocked: First Blood!"

### 2.4 User Stats Dashboard (enhance Wallet page)

The current Wallet page is basic. Make it a proper stats dashboard:

- **Prediction stats**: Total predictions, wins, losses, win rate %, total points earned, total tokens staked.
- **Streak info**: Current streak (with flame animation if >= 3), longest ever streak.
- **Recent activity**: Last 5 transactions (tokens and points combined), with type badges and relative timestamps.
- **Achievement progress**: Next 3 closest-to-unlocking achievements with progress bars.
- **Daily allowance status**: Tokens remaining today, next reset time, days until max stack.

---

## Part 3: Multi-Sport & Event Discovery

### 3.1 Sport Categories

**Schema addition:**
```prisma
// Add to Event model:
sportCategory  String?  // e.g. "Football", "Basketball", "Tennis"
sportLeague    String?  // e.g. "Premier League", "NBA", "ATP"
```

**Frontend — Events page overhaul:**
- Add a sport category filter bar at the top: All | Football | Basketball | Tennis | etc.
- Auto-derive categories from existing events' `externalSportKey` mapping (e.g. `soccer_epl` → "Football", "Premier League").
- Add a utility function that maps Odds API sport keys to display names and emoji:
  ```
  soccer_epl → ⚽ Premier League
  basketball_nba → 🏀 NBA
  tennis_atp → 🎾 ATP
  americanfootball_nfl → 🏈 NFL
  ```
- Show the sport emoji on event cards.
- Add match time countdown on event cards ("Starts in 2h 15m" / "Live" / "Finished").
- Add a simple search/filter: type to filter events by team name.

### 3.2 Event Detail Enhancements

- **Odds comparison**: If multiple bookmakers are in the API response, show a comparison table (currently only using the first bookmaker).
- **Odds movement**: Store historical odds snapshots and show a simple "odds moved from X to Y" indicator.
- **Social proof**: "X people predicted this outcome" as a bar chart on each outcome.
- **Countdown timer**: Live countdown to event start with auto-lock when it hits zero.

---

## Part 4: Admin Dashboard (Frontend)

Currently all admin operations require API calls. Build a proper admin panel.

### 4.1 Admin Layout & Routing

- Add admin routes behind `/admin/*` (protected by `isAdmin` check).
- Add an "Admin" link in the nav bar (only visible to admins).
- Pages: Dashboard, Events, Users, Rewards, Redemptions, System.

### 4.2 Admin Dashboard Page (`/admin`)

- **Platform stats**: Users, events (open/locked/settled/cancelled), predictions, total tokens in circulation, total points awarded. Use the existing `GET /admin/stats` endpoint.
- **Quick actions**: Sync odds, run settlement, auto-lock events — buttons that call the existing admin endpoints.
- **API quota**: Show remaining Odds API requests (add a new endpoint `GET /admin/odds/quota`).
- **Recent activity**: Last 10 settlements, last 10 new users.

### 4.3 Admin Event Management (`/admin/events`)

- **Event list** with status filters and bulk actions.
- **Create event form** with sport key dropdown (from Odds API sport list), external event ID search.
- **Import events button**: Trigger event import from the Odds API for a selected sport.
- **Settle/Lock/Cancel buttons** on each event row.
- **View predictions** for an event — table of all predictions with user, outcome, stake, odds.

### 4.4 Admin User Management (`/admin/users`)

- User list with search by email.
- View user details: balance (token + points), prediction history, transaction log.
- **Credit tokens** button (calls existing endpoint).
- **Verify balance** button (calls existing verify/repair endpoints).

### 4.5 Admin Rewards & Redemptions (`/admin/rewards`)

- CRUD for rewards.
- Redemption queue with "Fulfil" and "Cancel" actions.
- Show fulfilment notes.

---

## Part 5: Real-Time & Notifications

### 5.1 Server-Sent Events (SSE) for Live Updates

Add SSE endpoint for real-time updates without WebSocket complexity:

```typescript
// GET /api/v1/events/live
// Streams: odds updates, event status changes, settlement results
```

- When odds sync runs, push updated odds to connected clients.
- When an event is settled, push the result.
- When an event is auto-locked, push the status change.
- Frontend: `EventSource` hook that updates event data in real-time on the Events and Event Detail pages.

### 5.2 Toast Notification System (Frontend)

Build a notification context/provider:
- Queue-based: notifications stack and auto-dismiss after 5s.
- Types: success (green), error (red), info (blue), achievement (gold).
- Animate in from top-right.
- Use for: prediction placed, cashout success, achievement unlocked, settlement result, streak bonus, errors.

---

## Part 6: Production Hardening

### 6.1 Structured Logging

Replace all `console.log`/`console.error` with `pino`:
```bash
npm install pino pino-http
```

- Request logging via `pino-http` middleware: method, url, status, response time, user ID.
- Service-level logging with child loggers: `logger.child({ service: 'settlement' })`.
- Log all settlement operations, odds syncs, auth events, and ledger operations as structured JSON.
- In production, output JSON. In development, use `pino-pretty`.

### 6.2 Vitest Test Suite

```bash
npm install -D vitest @vitest/coverage-v8
```

**Unit tests:**
- Ledger credit/debit balance calculations
- `determineOutcome()` in settlement worker — win/loss/draw edge cases
- `calculateCashoutValue()` formula
- Odds API cache hit/miss/expiry
- Achievement threshold checks
- Streak bonus calculations

**Integration tests (with test database):**
- Auth flow: register → login → get profile → change password
- Prediction flow: create event → place prediction → verify balance → settle → verify points
- Cashout flow: place prediction → get cashout value → execute cashout → verify points
- Reward flow: create reward → redeem → verify points deducted → fulfil

### 6.3 Security Headers

Add `helmet` middleware:
```bash
npm install helmet
```
- CSP headers, HSTS, X-Frame-Options, etc.
- Configure CSP to allow the Vercel frontend origin.

### 6.4 API Versioning Prep

The API is already at `/api/v1/`. Add a version header to all responses:
```
X-API-Version: 1.0.0
```
This makes future versioning transitions smoother.

### 6.5 Database Index Review

Add missing indexes for common query patterns:
```prisma
// On Prediction
@@index([userId, status])
@@index([eventId, status])
@@index([userId, createdAt])

// On TokenTransaction
@@index([userId, type])
@@index([userId, createdAt])

// On PointsTransaction
@@index([userId, type])
@@index([userId, createdAt])

// On Redemption
@@index([userId, status])
@@index([status])
```

### 6.6 Graceful Error Recovery

- Add retry logic (exponential backoff, max 3 attempts) to Odds API calls.
- Add circuit breaker pattern: if 5 consecutive API calls fail, stop trying for 5 minutes.
- Health endpoint should reflect Odds API status in addition to database.

---

## Part 7: Polish & UX

### 7.1 Landing Page

Currently unauthenticated users just see the login page. Add a proper landing page at `/`:
- Hero section: "Predict. Win. Redeem." with a call-to-action to sign up.
- How it works: 3-step visual (Get free tokens → Make predictions → Win points & redeem rewards).
- Live stats: Total predictions made, total points awarded, active events count (fetch from a public stats endpoint).
- Sign up button.

### 7.2 Mobile Responsiveness Audit

- Ensure all pages work well on mobile (the Layout already has mobile nav).
- Event cards: stack to single column on small screens.
- Prediction cards: ensure cashout buttons are tappable.
- Admin pages: responsive tables with horizontal scroll.

### 7.3 Loading States & Skeleton Screens

Replace spinner-only loading states with skeleton screens for:
- Events list (card-shaped skeletons)
- Predictions list
- Wallet stats
- Leaderboard table

### 7.4 Dark Mode (Optional / Stretch)

Add a dark mode toggle using Tailwind's `dark:` classes and a theme context. Store preference in localStorage.

---

## Execution Order

Work through these in priority order. For each change: explain what you're doing, make the change, verify with `npm run typecheck`, and commit logically.

1. **Part 1** (Odds API survival) — without this nothing works
2. **Part 6.5** (Database indexes) — quick win, prevents slow queries as data grows  
3. **Part 5.2** (Toast notifications) — needed by everything else
4. **Part 2.1-2.2** (Leaderboard + streaks) — core engagement loop
5. **Part 2.3** (Achievements) — engagement depth
6. **Part 2.4** (Stats dashboard) — enhanced wallet
7. **Part 3** (Multi-sport + event discovery) — content richness
8. **Part 4** (Admin dashboard) — operational control
9. **Part 5.1** (SSE live updates) — real-time feel
10. **Part 7.1** (Landing page) — first impressions
11. **Part 6.1-6.3** (Logging, tests, security) — production readiness
12. **Part 6.4, 6.6** (API versioning, error recovery) — resilience
13. **Part 7.2-7.4** (Mobile, skeletons, dark mode) — polish

---

## Important Rules

- **Always generate Prisma migrations** for schema changes: `npx prisma migrate dev --name descriptive-name`
- **Run `npm run typecheck`** after every change
- **Run `npm run build`** before final commit
- **Never log secrets** (API keys, DB URLs, JWT secrets)
- **Never mutate balances directly** — always through LedgerService/PointsLedgerService
- **Railway env vars**: no quotes around values
- **The Odds API free tier is 500 requests/month** — every call counts, cache aggressively
- **Preserve the append-only ledger pattern** — this is the architectural foundation
- **Keep the frontend single-file per page** — no separate CSS files
- **Use Tailwind utility classes** — no custom CSS unless absolutely necessary
