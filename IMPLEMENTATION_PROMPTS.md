# betting_thing — Post-Verification Implementation Prompts

Use these prompts sequentially in Claude Code sessions. After each session, run `/clear` before starting the next one. Each prompt is self-contained with full context.

---
---

## SESSION 1: Frontend Polish — Toast System, Inline Cashout, Transaction History

### Context

You are working on **betting_thing**, a token-based sports prediction platform. Stack: TypeScript/Node.js/Express backend (Render web service), PostgreSQL via Prisma (Render managed Postgres), React/Vite/Tailwind frontend (Render static site).

**Hard constraints (never violate):**
- Ledger-first: `TokenTransaction` and `PointsTransaction` are immutable append-only. Balances derived, never directly mutated.
- Free-entry only: No token purchasing, no cash payouts. 5 free tokens/day, max 35 stacked.
- Dual currency: Tokens for staking, points for winnings/cashouts. Two separate ledgers.
- All balance ops use `$transaction` + `FOR UPDATE` row locks.
- Every schema change needs a Prisma migration run BEFORE deploying code.
- The Odds API free tier = 500 req/month. Never add new live API calls on user actions.

**Current frontend pages:** Login, Register, Events list, Event detail (place prediction), My Predictions (with cashout), Rewards, Wallet. All in `frontend/src/pages/`. UI components in `frontend/src/components/ui/`. API client in `frontend/src/lib/api.ts`. Types in `frontend/src/types/index.ts`. Auth context in `frontend/src/context/AuthContext.tsx`. Router in `frontend/src/App.tsx`.

**Current frontend issues:**
- Errors fail silently — `catch` blocks log to console but user sees nothing
- Cashout on PredictionsPage requires full page reload to reflect new state
- No transaction history page — users can't see their token/points movements
- Success messages are inline green text that disappears on re-render

### Task 1.1: Global Toast Notification System

Create a toast system that any component can use. No external dependencies.

**Create `frontend/src/context/ToastContext.tsx`:**
- `ToastProvider` wrapping the app, renders toast container
- `useToast()` hook returning `{ showToast(message, type, duration?) }`
- Types: `success`, `error`, `info`, `warning`
- Default duration: 4 seconds for success/info, 6 seconds for error/warning
- Toasts stack from bottom-right, max 3 visible, oldest dismissed first
- Each toast has a close button and auto-dismisses
- Animate in (slide from right) and out (fade + slide)
- Use Tailwind classes only, no CSS modules

**Wire it in `frontend/src/App.tsx`:**
- Wrap the `AuthProvider` children with `ToastProvider`

**Replace all silent error handling across every page:**
- `EventDetailPage.tsx` — prediction placement success/error, odds fetch failure
- `PredictionsPage.tsx` — cashout success/error, data load failure
- `RewardsPage.tsx` — redemption success/error
- `WalletPage.tsx` — any data load failure
- `LoginPage.tsx` / `RegisterPage.tsx` — keep inline errors for form validation, but add toast for network errors

For each page: find every `catch` block and every `setError()` / `setSuccess()` call. Replace with `showToast()`. Remove the inline error/success `<div>` elements where they're now redundant. Keep form validation errors inline (they relate to specific fields).

### Task 1.2: Inline Cashout Without Page Reload

**In `PredictionsPage.tsx`:**
- After a successful cashout API call, update the local `predictions` state directly:
  - Find the prediction in the array by ID
  - Set its `status` to `CASHED_OUT`, `cashoutAmount` to the returned value, `cashedOutAt` to now
  - This avoids a full `loadData()` call
- Also call `refreshUser()` from AuthContext to update the header balance display
- Show a success toast: "Cashed out for X points!"

**In `PredictionCard` component (or wherever the cashout button lives):**
- Add a loading spinner on the cashout button while the API call is in flight
- Disable the button during the request
- On error, show error toast and re-enable the button

### Task 1.3: Transaction History Page

**Create `frontend/src/pages/TransactionHistoryPage.tsx`:**

This page shows a unified view of all token and points movements.

**Layout:**
- Tab bar at top: "Tokens" | "Points" (default: Tokens)
- Each tab shows a chronological list of transactions, newest first
- Paginated — load 20 at a time with a "Load more" button at the bottom

**Token transaction list item:**
- Date/time (relative, e.g. "2 hours ago" or "Mar 15")
- Type badge (colour-coded): DAILY_ALLOWANCE (green), PREDICTION_STAKE (red), PREDICTION_REFUND (blue), ADMIN_CREDIT (purple), etc.
- Description text
- Amount: green with + prefix for credits, red with - prefix for debits
- Running balance shown on the right

**Points transaction list item:**
- Same layout as tokens
- Type badges: PREDICTION_WIN (green), CASHOUT (blue), REDEMPTION (red), ADMIN_CREDIT (purple)

**API calls needed (these already exist):**
- `GET /auth/transactions?limit=20&offset=0` — token transactions
- `GET /points/transactions?limit=20&offset=0` — points transactions (check if this endpoint exists; if not, create it)

**Check if `GET /points/transactions` exists in `src/routes/points.ts`.** If it doesn't:
- Add a `GET /points/transactions` route that mirrors the pattern in `src/routes/auth.ts` for token transactions
- Query `PointsTransaction` ordered by `createdAt DESC` with pagination
- Add the corresponding `getPointsTransactions` method to `frontend/src/lib/api.ts`
- Add `PointsTransaction` to `frontend/src/types/index.ts` if not already there

**Add to router in `frontend/src/App.tsx`:**
- Route: `/transactions` (protected)
- Add to the nav in `frontend/src/components/Layout.tsx`

**After all changes, run `npm run build` in the frontend directory to verify no TypeScript errors.**

---
---

## SESSION 2: Admin Frontend Panel

`/clear` then paste this prompt.

### Context

You are working on **betting_thing**, a token-based sports prediction platform. Stack: TypeScript/Node.js/Express backend (Render web service), PostgreSQL via Prisma (Render managed Postgres), React/Vite/Tailwind frontend (Render static site).

**Hard constraints (never violate):**
- Ledger-first: `TokenTransaction` and `PointsTransaction` are immutable append-only.
- Free-entry only: No token purchasing, no cash payouts.
- Dual currency: Tokens for staking, points for winnings/cashouts.
- All balance ops use `$transaction` + `FOR UPDATE` row locks.
- Every schema change needs a Prisma migration run BEFORE deploying code.
- The Odds API free tier = 500 req/month. Never add new live API calls on user actions.

**Current state:** All admin operations are API-only (no frontend). Admin routes are in `src/routes/admin.ts` and include: create/lock/settle/cancel events, CRUD rewards, fulfil/cancel redemptions, list users, credit tokens, get platform stats, trigger odds sync, trigger settlement, get settlement status. Auth context has `user.isAdmin` boolean.

**Frontend structure:** Pages in `frontend/src/pages/`, components in `frontend/src/components/`, API client in `frontend/src/lib/api.ts`, types in `frontend/src/types/index.ts`, router in `frontend/src/App.tsx`, layout in `frontend/src/components/Layout.tsx`.

### Task 2.1: Admin Layout & Route Guard

**Create `frontend/src/components/AdminLayout.tsx`:**
- Sidebar nav with sections: Dashboard, Events, Rewards, Users, System
- Content area to the right
- If `!user?.isAdmin`, redirect to `/events`
- Mobile: sidebar collapses to a hamburger menu

**Add admin routes to `frontend/src/App.tsx`:**
- `/admin` → Dashboard
- `/admin/events` → Event management
- `/admin/rewards` → Reward management
- `/admin/users` → User list
- `/admin/system` → Settlement & odds controls
- All wrapped in a `ProtectedRoute` + admin check

**Add admin API methods to `frontend/src/lib/api.ts`:**
- `getAdminStats()` → `GET /admin/stats`
- `getAdminUsers(limit, offset)` → `GET /admin/users`
- `getAdminEvents(limit, offset)` → `GET /admin/events` (check if this exists; if not, add a list endpoint to `src/routes/admin.ts` that returns all events regardless of status)
- `settleEvent(eventId, finalOutcome)` → `POST /admin/events/:id/settle`
- `cancelEvent(eventId)` → `POST /admin/events/:id/cancel`
- `lockEvent(eventId)` → `POST /admin/events/:id/lock`
- `triggerOddsSync()` → `POST /admin/odds/sync`
- `triggerSettlement()` → `POST /admin/settlement/run`
- `getSettlementStatus()` → `GET /admin/settlement/status`
- `createReward(data)` → `POST /admin/rewards`
- `updateReward(id, data)` → `PATCH /admin/rewards/:id`
- `getAdminRedemptions(status?, limit, offset)` → `GET /admin/redemptions`
- `fulfilRedemption(id, note)` → `POST /admin/redemptions/:id/fulfil`
- `cancelRedemption(id)` → `POST /admin/redemptions/:id/cancel`
- `creditTokens(userId, amount, description)` → `POST /admin/tokens/credit`
- `verifyUserBalance(userId)` → `GET /admin/users/:id/balance`
- `repairUserBalance(userId)` → `POST /admin/users/:id/balance/repair`
- `autoLockEvents()` → `POST /admin/events/auto-lock`

### Task 2.2: Admin Dashboard Page

**Create `frontend/src/pages/admin/AdminDashboardPage.tsx`:**

Fetches `GET /admin/stats` and displays:
- Stat cards in a grid: Total users, Open events, Total predictions, Pending redemptions, Tokens in circulation
- Quick action buttons: "Sync Odds", "Run Settlement", "Auto-Lock Events" — each triggers the corresponding API call and shows a toast with the result
- Settlement worker status indicator (poll `GET /admin/settlement/status` on mount)

### Task 2.3: Admin Events Page

**Create `frontend/src/pages/admin/AdminEventsPage.tsx`:**

- Table listing all events with columns: Title, Sport, Starts At, Status, Predictions count, Actions
- Status shown as colour-coded badge (OPEN=green, LOCKED=yellow, SETTLED=grey, CANCELLED=red)
- Action buttons per row based on status:
  - OPEN: Lock, Cancel
  - LOCKED: Settle (opens modal to select outcome from event.outcomes), Cancel
  - SETTLED/CANCELLED: no actions, just view
- Settle modal: dropdown of event.outcomes + confirm button
- Pagination at the bottom
- Clicking an event row expands to show prediction breakdown (outcome counts, total staked)

**Check:** Does `GET /admin/events` exist? If `src/routes/admin.ts` doesn't have a list-all-events endpoint, add one:
```typescript
router.get('/events', async (req, res, next) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  const status = req.query.status as string | undefined;
  const where: any = {};
  if (status) where.status = status;
  const [events, total] = await Promise.all([
    prisma.event.findMany({ where, orderBy: { startsAt: 'desc' }, take: limit, skip: offset, include: { _count: { select: { predictions: true } } } }),
    prisma.event.count({ where }),
  ]);
  sendSuccess(res, { events, total });
});
```

### Task 2.4: Admin Users Page

**Create `frontend/src/pages/admin/AdminUsersPage.tsx`:**

- Table: Email, Token Balance, Points Balance (add to admin users query if missing), Predictions count, Admin badge, Created date
- Click a user row to expand: shows "Verify Balance" and "Repair Balance" buttons, "Credit Tokens" form (amount + description)
- Search/filter by email at the top

**Check:** The admin users endpoint currently doesn't return `pointsBalance`. If the Prisma query in `src/routes/admin.ts` `GET /admin/users` doesn't include it, add `pointsBalance: true` to the `select` block.

### Task 2.5: Admin Rewards & Redemptions Page

**Create `frontend/src/pages/admin/AdminRewardsPage.tsx`:**

Two tabs: "Rewards" | "Redemptions"

**Rewards tab:**
- List of all rewards with: Name, Points cost, Stock (claimed/limit), Active status, Actions
- "Create Reward" button → modal with form fields: name, description, pointsCost, stockLimit, imageUrl
- Edit button per reward → same modal pre-filled
- Toggle active/inactive per reward

**Redemptions tab:**
- List of all redemptions with: User email, Reward name, Points cost, Status, Date, Actions
- Filter by status (All, Pending, Fulfilled, Cancelled)
- Pending redemptions show: "Fulfil" button (opens note input) and "Cancel" button
- Fulfilled shows the fulfilment note

### Task 2.6: Admin System Page

**Create `frontend/src/pages/admin/AdminSystemPage.tsx`:**

- Settlement worker status card (running/stopped, last run time)
- "Run Settlement Now" button with result display
- "Sync Odds Now" button with result display (show remaining quota from response)
- "Auto-Lock Started Events" button with count of locked events
- Odds API quota display (if available from the cache — check if `GET /admin/odds/quota` or similar exists; if the in-memory cache tracks `x-requests-remaining`, expose it via a new admin endpoint)

**If no quota endpoint exists, add to `src/routes/admin.ts`:**
```typescript
router.get('/odds/quota', async (_req, res, next) => {
  try {
    const quota = OddsApiService.getRemainingQuota(); // should already exist from caching work
    sendSuccess(res, { quota });
  } catch (error) {
    next(error);
  }
});
```

**After all changes, run `npm run build` in both root and frontend directories to verify no TypeScript errors.**

---
---

## SESSION 3: Gameday Experience — Live Feel & Engagement

`/clear` then paste this prompt.

### Context

You are working on **betting_thing**, a token-based sports prediction platform. Stack: TypeScript/Node.js/Express backend (Render web service), PostgreSQL via Prisma (Render managed Postgres), React/Vite/Tailwind frontend (Render static site). SSE (Server-Sent Events) infrastructure already exists for live updates.

**Hard constraints (never violate):**
- Ledger-first: `TokenTransaction` and `PointsTransaction` are immutable append-only.
- Free-entry only: No token purchasing, no cash payouts.
- Dual currency: Tokens for staking, points for winnings/cashouts.
- All balance ops use `$transaction` + `FOR UPDATE` row locks.
- Every schema change needs a Prisma migration run BEFORE deploying code.
- The Odds API free tier = 500 req/month. Never add new live API calls on user actions. All odds come from cache or scheduled sync.

**Current engagement features:** Leaderboard, streaks, achievements, private leagues with invite codes, bet slip / accumulator system. These were built via Claude Code prompts and should exist in the codebase — verify they're wired into the frontend before building on top of them.

### Task 3.1: Verify Existing Engagement Features Are Wired In

Before building anything new, check that these features are actually accessible from the frontend:

1. **Leaderboard** — is there a `/leaderboard` route in the frontend router? Is there a page component? If not, check if the backend endpoint exists (`GET /leaderboard` or similar) and create the frontend page.

2. **Streaks** — check if streak data is returned in the user profile or predictions stats. Is it displayed anywhere in the UI?

3. **Achievements** — same check. Backend endpoints? Frontend display?

4. **Private leagues** — is there a leagues page? Can users create/join leagues? Check backend routes and frontend pages.

5. **Bet slip / accumulators** — is there a bet slip component? Can users add multiple selections? Check if the accumulator endpoint exists.

For each: if the backend exists but frontend doesn't, create the frontend page/component. If neither exists, skip it (we'll note it as still outstanding). If both exist, move on.

**Document what you find** by adding a comment at the top of the relevant files noting the status.

### Task 3.2: Events Page — "Today's Matches" Section

**Modify `frontend/src/pages/EventsPage.tsx`:**

- Add a "Today's Matches" section at the top that filters events where `startsAt` is today
- Show these in a more prominent card layout with:
  - Team names large and bold
  - Kick-off time in big text
  - Current odds displayed inline (from `event.currentOdds`)
  - Quick-predict buttons — click an outcome to go to event detail with that outcome pre-selected
  - If user already has a prediction on this event, show a "You predicted: [outcome]" badge instead of buttons
- Below "Today's Matches", show "Upcoming" section with the regular event list
- If no matches today, show "No matches today — check back soon" with the next match date

### Task 3.3: Event Detail Page — Live Odds Display

**Modify `frontend/src/pages/EventDetailPage.tsx`:**

- Display odds for each outcome in a clear, visual format:
  - Outcome name, decimal odds, implied probability as a percentage bar
  - Highlight the outcome with the shortest odds (favourite) with a subtle indicator
- If odds are stale (check `event.oddsUpdatedAt` > 30 mins ago), show a subtle "Odds may be delayed" note
- Show the total number of predictions and breakdown by outcome (from `getEventStats`)
- After placing a prediction, show a confirmation card with: your pick, stake, potential payout, odds locked at

### Task 3.4: My Predictions Page — Active Predictions Dashboard

**Modify `frontend/src/pages/PredictionsPage.tsx`:**

- Add a stats summary card at the top: total predictions, win rate, total points won, current streak
- Active predictions (PENDING) shown prominently at the top with:
  - Event name, your pick, stake, current odds, potential payout
  - Cashout button with current cashout value displayed (fetched once on page load, not per-interaction to save API calls)
  - Time until event starts (countdown if < 24 hours)
- Settled predictions below, grouped by date
- Each settled prediction shows: your pick, result, points won/lost

### Task 3.5: Homepage Summary Card

**If no homepage exists beyond the events list, modify the events page header or create a dashboard-style top section:**

- Greeting: "Hey [user first part of email]!" with token balance and points balance
- "Your predictions today" — count of active predictions for today's events
- Quick link to leaderboard position: "You're #X on the leaderboard"
- Current streak display if streak feature is wired in

**After all changes, run `npm run build` in the frontend directory to verify no TypeScript errors.**

---
---

## SESSION 4: Auth Hardening & Backend Cleanup

`/clear` then paste this prompt.

### Context

You are working on **betting_thing**, a token-based sports prediction platform. Stack: TypeScript/Node.js/Express backend (Render web service), PostgreSQL via Prisma (Render managed Postgres), React/Vite/Tailwind frontend (Render static site).

**Hard constraints (never violate):**
- Ledger-first: `TokenTransaction` and `PointsTransaction` are immutable append-only.
- All balance ops use `$transaction` + `FOR UPDATE` row locks.
- Every schema change needs a Prisma migration run BEFORE deploying code. Run `npx prisma migrate dev --name <name>` locally, then `DATABASE_URL="<prod_url>" npx prisma migrate deploy` against production BEFORE pushing code.
- The Odds API free tier = 500 req/month.

**Key files:**
- Auth routes: `src/routes/auth.ts`
- Auth middleware: `src/middleware/auth.ts`
- Ledger service: `src/services/ledger.ts`
- Points ledger: `src/services/pointsLedger.ts`
- Token allowance: `src/services/tokenAllowance.ts`
- Events service: `src/services/events.ts`
- Predictions service: `src/services/predictions.ts`
- Admin routes: `src/routes/admin.ts`
- Config: `src/config/index.ts`

### Task 4.1: Auth Rate Limiting

**Install `express-rate-limit` if not already present:**
```bash
npm install express-rate-limit
```

**Create `src/middleware/rateLimiter.ts`:**

```typescript
import rateLimit from 'express-rate-limit';

// Strict limiter for auth endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many attempts. Please try again later.' } },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
});

// Stricter limiter for login specifically
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 login attempts per 15 min
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many login attempts. Please try again in 15 minutes.' } },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
});

// General API limiter
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests. Please slow down.' } },
  standardHeaders: true,
  legacyHeaders: false,
});
```

**Apply in `src/routes/auth.ts`:**
- `loginLimiter` on `POST /auth/login`
- `authLimiter` on `POST /auth/register`
- `authLimiter` on `POST /auth/change-password`

**Apply in `src/app.ts`:**
- `apiLimiter` on the `/api` prefix (general protection)

### Task 4.2: Fix tokensRemaining Accuracy

**File: `src/services/tokenAllowance.ts` — `consumeTokens` method**

**Problem:** After a ledger debit, `tokensRemaining` is set to `result.newBalance` — but `newBalance` is the user's total token balance (signup bonus + all allowances - all stakes), not the remaining daily allowance.

**Fix:** `tokensRemaining` should track how many of the user's *allowance* tokens remain, not their total balance. After consuming tokens:
```typescript
// WRONG:
tokensRemaining: result.newBalance

// RIGHT: decrement the allowance tracking value
tokensRemaining: Math.max(0, status.tokensRemaining - amount)
```

The `TokenAllowance.tokensRemaining` field tracks "how many more tokens can this user receive from daily grants before hitting the cap", NOT "how many tokens does this user have". Review the `ensureAllowance` function to make sure the reset logic is also correct — on a new day, `tokensRemaining` should be set based on how many tokens can be granted up to `MAX_ALLOWANCE_TOKENS`, considering the user's current balance.

### Task 4.3: Remove Dead Code

**Check for and remove:**
1. `LedgerService.creditPredictionWin()` — if this exists in `src/services/ledger.ts`, it's dead code. All prediction wins go through `PointsLedgerService.credit()` now. Remove the method. Check for any imports or references and remove those too.
2. Any other unused exports in the services — run `npx tsc --noEmit` and check for unused warnings if your tsconfig has `noUnusedLocals`.

### Task 4.4: Add Points Metrics to Admin Stats

**File: `src/routes/admin.ts` — `GET /admin/stats`**

The current stats endpoint doesn't include points data. Add:
```typescript
const totalPointsInCirculation = await prisma.user.aggregate({ _sum: { pointsBalance: true } });
const totalPointsEarned = await prisma.pointsTransaction.aggregate({
  where: { amount: { gt: 0 } },
  _sum: { amount: true },
});
const totalPointsSpent = await prisma.pointsTransaction.aggregate({
  where: { amount: { lt: 0 } },
  _sum: { amount: true },
});
```

Add to the response:
```typescript
points: {
  inCirculation: totalPointsInCirculation._sum.pointsBalance ?? 0,
  totalEarned: totalPointsEarned._sum.amount ?? 0,
  totalSpent: Math.abs(totalPointsSpent._sum.amount ?? 0),
},
```

### Task 4.5: Structured Logging Foundation

Replace `console.log` / `console.error` with a minimal structured logger. No external dependencies needed for now.

**Create `src/utils/logger.ts`:**
```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = (process.env.LOG_LEVEL || 'info') as LogLevel;

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (LOG_LEVELS[level] < LOG_LEVELS[CURRENT_LEVEL]) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const output = JSON.stringify(entry);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
```

**Then do a find-and-replace across the backend `src/` directory:**
- Replace `console.log(` with `logger.info(` (review each one — some may be `debug` level)
- Replace `console.error(` with `logger.error(`
- Add `import { logger } from '../utils/logger.js';` to each affected file

**Don't replace console statements in scripts/ directory — those are CLI tools, plain console is fine.**

**After all changes, run `npm run build` in the root directory to verify no TypeScript errors.**

---
---

## SESSION 5: Multi-Sport Expansion & Final Polish

`/clear` then paste this prompt.

### Context

You are working on **betting_thing**, a token-based sports prediction platform. Stack: TypeScript/Node.js/Express backend (Render web service), PostgreSQL via Prisma (Render managed Postgres), React/Vite/Tailwind frontend (Render static site).

**Hard constraints (never violate):**
- Ledger-first: `TokenTransaction` and `PointsTransaction` are immutable append-only.
- Free-entry only: No token purchasing, no cash payouts.
- Dual currency: Tokens for staking, points for winnings/cashouts.
- All balance ops use `$transaction` + `FOR UPDATE` row locks.
- Every schema change needs a Prisma migration run BEFORE deploying code.
- The Odds API free tier = 500 req/month. Every new sport key costs credits. Be conservative.

**Available sport keys (The Odds API):**
- `soccer_epl` — English Premier League
- `soccer_spain_la_liga` — La Liga
- `soccer_italy_serie_a` — Serie A
- `soccer_germany_bundesliga` — Bundesliga
- `soccer_france_ligue_one` — Ligue 1
- `soccer_uefa_champs_league` — Champions League

**Current state:** Backend already supports multiple sport keys via `externalSportKey` on the Event model. The import script (`scripts/importEvents.ts`) can import from any sport key. The odds sync worker polls a configured set of sport keys. Frontend currently shows all events in one list with no sport filtering.

### Task 5.1: Sport Configuration

**Create or update `src/config/sports.ts`:**
```typescript
export interface SportConfig {
  key: string;         // The Odds API sport key
  name: string;        // Display name
  shortName: string;   // Short display name
  emoji: string;       // Visual identifier
  enabled: boolean;    // Whether to sync odds for this sport
  priority: number;    // Sync order (lower = first)
}

export const SPORTS: SportConfig[] = [
  { key: 'soccer_epl', name: 'Premier League', shortName: 'EPL', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', enabled: true, priority: 1 },
  { key: 'soccer_uefa_champs_league', name: 'Champions League', shortName: 'UCL', emoji: '🏆', enabled: true, priority: 2 },
  { key: 'soccer_spain_la_liga', name: 'La Liga', shortName: 'La Liga', emoji: '🇪🇸', enabled: false, priority: 3 },
  { key: 'soccer_italy_serie_a', name: 'Serie A', shortName: 'Serie A', emoji: '🇮🇹', enabled: false, priority: 4 },
  { key: 'soccer_germany_bundesliga', name: 'Bundesliga', shortName: 'Bundesliga', emoji: '🇩🇪', enabled: false, priority: 5 },
  { key: 'soccer_france_ligue_one', name: 'Ligue 1', shortName: 'Ligue 1', emoji: '🇫🇷', enabled: false, priority: 6 },
];

export function getEnabledSports(): SportConfig[] {
  return SPORTS.filter(s => s.enabled).sort((a, b) => a.priority - b.priority);
}

export function getSportByKey(key: string): SportConfig | undefined {
  return SPORTS.find(s => s.key === key);
}
```

**Update odds sync worker** (`src/services/oddsSync.ts`) to use `getEnabledSports()` instead of a hardcoded sport key. It should iterate through enabled sports in priority order, checking the remaining quota before each call.

**Update the import script** (`scripts/importEvents.ts`) to accept `--all-enabled` flag that imports from all enabled sports.

### Task 5.2: Frontend Sport Filter

**Modify `frontend/src/pages/EventsPage.tsx`:**

- Add a horizontal scrollable tab/pill bar below the page header showing enabled sports
- "All" tab selected by default
- Each sport tab shows: emoji + short name (e.g. "🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL")
- Filtering is client-side — filter the already-fetched events by `externalSportKey`
- Active tab has a bold/coloured indicator

**The sport config needs to be available on the frontend.** Options:
1. Create a shared `SPORTS` constant in `frontend/src/lib/sports.ts` (simpler, duplicated)
2. Add a `GET /config/sports` endpoint that returns the config

Use option 1 for now — it's faster and the config rarely changes. Only include enabled sports in the frontend constant.

### Task 5.3: Event Cards — Sport Badge

**Modify the event card component** (wherever events are rendered as cards/list items):
- Add a small sport badge in the corner: emoji + short name
- Use the sport's emoji as a quick visual identifier
- Colour-code the badge background by sport (e.g. EPL = purple, UCL = navy)

### Task 5.4: Admin — Sport Management

**Add to the Admin System page** (from Session 2):
- Show the list of available sports with their enabled/disabled status
- Toggle switch to enable/disable each sport
- Note: since sports config is in code, the toggle should update an env var or a simple DB table. For MVP, just show the current config as read-only with a note: "Edit `src/config/sports.ts` to enable/disable sports"
- Show the import script command for each sport: `npx tsx scripts/importEvents.ts <sport_key>`
- "Import Events" button per sport that triggers a new admin endpoint

**Add to `src/routes/admin.ts`:**
```typescript
router.post('/events/import/:sportKey', async (req, res, next) => {
  try {
    const { sportKey } = req.params;
    const sport = getSportByKey(sportKey);
    if (!sport) throw AppError.notFound('Sport');
    const result = await EventImportService.importForSport(sportKey);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
});
```

Check if `EventImportService` exists (it should from previous work). If not, the import logic from `scripts/importEvents.ts` needs to be extracted into a service.

### Task 5.5: PWA Enhancement

**Check `frontend/public/manifest.json` and service worker setup.**

If PWA support was added previously, verify:
- Manifest has correct `name`, `short_name`, `theme_color`, `background_color`
- Icons exist in multiple sizes (192x192, 512x512 minimum)
- Service worker caches static assets
- App is installable on mobile

If any of these are missing, add them. The app name should be something catchy — ask me if you want suggestions, or use "PredictIt" or "TokenBet" as a placeholder.

### Task 5.6: Final Build Verification

Run these in order:
```bash
# Backend
cd /path/to/prediction-platform
npm run build
npm run typecheck

# Frontend
cd frontend
npm run build
```

Fix any TypeScript errors. Don't push until both build clean.

**After this session, the app should be ready for friends to test.** The remaining work (CI/CD, test suite, database backups, CSP headers, API versioning) can wait until after real-world usage reveals what matters most.
