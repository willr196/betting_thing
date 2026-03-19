# Post-Implementation Review Results

Reviewed on: 2026-03-19

---

## 1. Build Status

**Backend**: Clean (no errors, no warnings)
**Frontend**: Clean (no errors, no warnings)

Both `npm run build` (backend) and `cd frontend && npm run build` (frontend) pass without issues.

---

## 2. Constraint Violations Found

### 2.1 Live Odds API Call on Cashout (FIXED)

- **File**: `src/services/predictions.ts:391-394`
- **Issue**: `cashout()` called `resolveEventOddsWithFallback()` with `forceRefresh: true`, bypassing the in-memory cache and triggering a live Odds API call on every user cashout action. This violates the "no live API calls on user actions" constraint.
- **Fix**: Removed `forceRefresh: true` from the cashout path. The cached/DB odds are now used instead, and the existing staleness threshold check still protects against using stale data.

### 2.2 Direct Balance Mutation — None Found

All `tokenBalance` and `pointsBalance` mutations are inside `LedgerService`/`PointsLedgerService` or initial user creation (`auth.ts`). Admin routes only read via aggregates. No violations.

### 2.3 Missing FOR UPDATE — None Found

All `$transaction` blocks that modify balances use `FOR UPDATE` row locks:
- `predictions.ts` — `lockEventForPrediction`, `lockPredictionForCashout`, `lockEventForCashout`
- `events.ts` — settle locks Event + Predictions with FOR UPDATE
- `ledgerCore.ts` — credit/debit lock User row with FOR UPDATE
- `tokenAllowance.ts` — locks both User and TokenAllowance with FOR UPDATE
- `rewards.ts` — `lockRewardForRedemption` + PointsLedgerService (which uses FOR UPDATE internally)

### 2.4 Unmigrated Schema Changes

Cannot run `prisma migrate diff` locally (no DB). From prior session notes, two schema additions are pending migration:
1. `AdminAuditLog` model
2. `User.refreshTokenHash` + `User.refreshTokenExpiresAt`

**Action required**: Run against production DB before deploying:
```bash
DATABASE_URL="<prod_url>" npx prisma migrate deploy
```

---

## 3. Edge Cases Fixed

### 3.1 Login Rate Limiter Tightened (FIXED)

- **File**: `src/routes/auth.ts:52`
- **Issue**: Login limiter allowed 10 attempts per 15-min window. Review spec requires 5.
- **Fix**: Changed `max: 10` to `max: 5`.

### 3.2 Inline Cashout State — No Issues

- `PredictionsPage.tsx`: `updatePredictionAfterCashout` correctly updates local state (line 123-154)
- Cashout button disabled during request (`isCashingOut` state + `disabled` prop)
- Error re-enables button via `finally { setIsCashingOut(false) }`
- `refreshUser()` called after success to update header balance

### 3.3 Toast System — No Issues

- Max 3 visible enforced (line 107-109): dismisses oldest when a 4th arrives
- Timers cleaned up on unmount (line 50-59): clears all tracked timeouts
- Container positioned `fixed bottom-4 right-4 z-50`

### 3.4 Transaction History Pagination — No Issues

- "Load more" appends results (line 48-49): `reset ? data.transactions : [...previous, ...data.transactions]`
- Empty state shown for zero transactions (line 177-183)
- Points tab loads lazily on first switch; Tokens tab loads on mount

### 3.5 Admin Settle Modal — No Issues

- Dropdown populated from `event.outcomes` (line 216)
- Default outcome pre-selected on open (line 163): `event.outcomes[0] || ''`
- Empty outcome guarded (line 87): `if (!settleModalEvent || !selectedOutcome) return`
- List refreshes after settle (line 97): `loadData()`
- Two-step flow: click "Settle" opens modal, then "Confirm Settlement" executes

### 3.6 Admin User Balance Operations — No Issues

- Credit amount validated as positive integer (line 79-83)
- Result shown via toast + data reload
- Verify shows cached vs calculated values with discrepancy warning

### 3.7 Sport Filter with Null SportKey — No Issues

- "All" tab shows all events (no filtering applied)
- Specific sport filter correctly excludes events with null `externalSportKey`

### 3.8 Rate Limiter in Production — Deployment Note

- Code is correct: `TRUST_PROXY` env var is read and applied via `app.set('trust proxy', ...)`
- **Deployment action**: Ensure `TRUST_PROXY=1` is set in Railway environment variables. Without it, rate limiting keys on the proxy IP rather than the user's IP.

### 3.9 SSE Connection Cleanup — N/A

No SSE (EventSource) usage found in the frontend codebase.

---

## 4. Missing Pieces Checklist

- [x] Toast system wired into EVERY page that makes API calls
- [x] Inline cashout working without page reload
- [x] Transaction history page accessible from nav (`/transactions` in both desktop and mobile nav)
- [x] `GET /points/transactions` endpoint exists and returns paginated results
- [x] Admin panel accessible at `/admin` (admin users only — `AdminLayout` checks `isAdmin`)
- [x] Admin dashboard shows live stats
- [x] Admin can settle events from the UI (settle modal with outcome dropdown)
- [x] Admin can manage rewards from the UI (CRUD + redemption management)
- [x] Leaderboard page exists and is accessible from nav
- [x] Sport filter on events page
- [x] Rate limiting on auth endpoints (login: 5/15min, register: 10/15min, change-password: 5/15min, refresh: 30/15min)
- [x] `tokensRemaining` fix applied in `consumeTokens` (uses `Math.max(0, status.tokensRemaining - amount)`)
- [x] `console.log` replaced with structured logger in `src/` (Pino logger, zero console calls)
- [x] Points metrics in admin stats response (inCirculation, totalPaidOut, totalRedeemed)
- [x] PWA manifest with correct metadata (`manifest.json` + meta tags in `index.html`)
- [x] `trust proxy` configurable in app.ts (via `TRUST_PROXY` env var)

---

## 5. Security Issues

### 5.1 Auth Rate Limiters — All Applied (Severity: Low, Fixed)

| Endpoint | Limiter | Window |
|----------|---------|--------|
| POST /auth/login | 5 requests | 15 min |
| POST /auth/register | 10 requests | 15 min |
| POST /auth/change-password | 5 requests | 15 min |
| POST /auth/refresh | 30 requests | 15 min |
| Global API | 100 requests | 1 min |

### 5.2 Admin Route Guard — Correct

All admin routes are guarded by `router.use(requireAuth, requireAdmin)` at the top of `src/routes/admin.ts` (line 19). No route bypasses this middleware.

### 5.3 Input Validation — Verified

Spot-checked 3 POST endpoints:
- `POST /auth/register` — Zod `registerSchema` (email + password validation)
- `POST /admin/events` — Zod `createEventSchema` (title, outcomes, startsAt, etc.)
- `POST /admin/events/:id/settle` — Zod `settleEventSchema` (finalOutcome)

All validated before processing.

### 5.4 Error Responses — No Leaks

Global error handler (`src/middleware/error.ts`):
- Production: returns generic "Internal server error" for unhandled errors (line 80)
- Development: returns `error.message` (useful for debugging)
- No stack traces in any response path
- Prisma errors mapped to safe AppError responses

### 5.5 CORS — Correct

`src/app.ts` lines 54-63:
- Production: `origin` set to `FRONTEND_URL` env var (or `false` if not set — blocks all cross-origin)
- Development: reflects `FRONTEND_URL` or request origin
- Not using `*`

---

## 6. Remaining TODOs

1. **Run pending Prisma migration** against production DB:
   ```bash
   DATABASE_URL="<prod_url>" npx prisma migrate deploy
   ```

2. **Set `TRUST_PROXY=1`** in Railway environment variables for correct rate-limiting per-user IP.

3. **PWA icons**: Only SVG favicon exists. For full installability on mobile, generate 192x192 and 512x512 PNG icons and add them to `manifest.json`.

4. **Service worker**: No service worker exists. Static asset caching would improve offline/load performance. Not critical for MVP but worth adding for a production PWA.

5. **`tokensRemaining` semantics**: The field in `TokenAllowance` is used as a mirror of `tokenBalance` throughout the codebase (`getStatus()` syncs it back to `tokenBalance`). The Session 4 fix in `consumeTokens` changes the write to `Math.max(0, status.tokensRemaining - amount)`, but `getStatus()` will repair it back to `tokenBalance` on next read. The fix is functionally a no-op. If true allowance tracking is desired, the entire `getStatus()` + `ensureAllowance()` repair logic would need redesigning.
