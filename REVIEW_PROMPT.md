# betting_thing — Post-Implementation Review (Run with Opus)

Run this prompt AFTER all 5 implementation sessions are complete. Use `/clear` first.

---

## Context

You are reviewing **betting_thing**, a token-based sports prediction platform that just had 5 rounds of feature work applied. Stack: TypeScript/Node.js/Express backend (Railway), PostgreSQL via Prisma, React/Vite/Tailwind frontend (Vercel).

**Hard constraints that must never be violated:**
- Ledger-first: `TokenTransaction` and `PointsTransaction` are immutable append-only. Balances derived, never directly mutated.
- Free-entry only: No token purchasing, no cash payouts. 5 free tokens/day, max 35 stacked.
- Dual currency: Tokens for staking, points for winnings/cashouts. Two separate ledgers.
- All balance ops use `$transaction` + `FOR UPDATE` row locks.
- Every schema change needs a Prisma migration.
- The Odds API free tier = 500 req/month. No live API calls on user actions.

---

## What was implemented (verify all of this exists and works)

### Session 1: Frontend Polish
- Global toast notification system (`ToastContext`)
- All silent `catch` blocks replaced with toast calls across every page
- Inline cashout on PredictionsPage (local state update, no full reload)
- Transaction history page (`/transactions`) with Tokens/Points tabs
- `GET /points/transactions` endpoint if it didn't exist before

### Session 2: Admin Frontend
- Admin layout with sidebar nav and route guard (`isAdmin` check)
- Admin dashboard with stats cards and quick action buttons
- Admin events page with table, status badges, settle modal, lock/cancel actions
- Admin users page with balance verify/repair, token credit form
- Admin rewards page with CRUD and redemption management
- Admin system page with settlement status, odds sync, quota display
- `GET /admin/events` list endpoint if it didn't exist
- `GET /admin/odds/quota` endpoint
- `pointsBalance` added to admin users query

### Session 3: Gameday Experience
- Verification that leaderboard, streaks, achievements, leagues, accumulators are wired into frontend
- "Today's Matches" section on EventsPage
- Live odds display on EventDetailPage with probability bars
- Stats summary card on PredictionsPage
- Homepage summary with greeting, balances, active predictions count

### Session 4: Auth Hardening & Cleanup
- `express-rate-limit` on login (5/15min), register (10/15min), general API (100/min)
- `tokensRemaining` fix in `tokenAllowance.ts`
- Dead `LedgerService.creditPredictionWin()` removed
- Points metrics added to `GET /admin/stats`
- Structured logger replacing all `console.log`/`console.error` in `src/`

### Session 5: Multi-Sport
- Sport config in `src/config/sports.ts`
- Odds sync iterates enabled sports with quota checking
- Frontend sport filter pills on EventsPage
- Sport badge on event cards
- Admin sport management (read-only config display + import trigger)
- PWA manifest and service worker verified
- `POST /admin/events/import/:sportKey` endpoint

---

## Review Instructions

### Phase 1: Build Check

```bash
# Backend
npm run build
npm run typecheck

# Frontend
cd frontend
npm run build
```

Fix every error. Don't skip warnings — check if they indicate real issues.

### Phase 2: Constraint Violations Audit

Search the entire codebase for these specific violations:

1. **Direct balance mutation** — grep for any `update` on `tokenBalance` or `pointsBalance` that isn't inside a ledger service method:
   ```bash
   grep -rn "tokenBalance" src/ --include="*.ts" | grep -v "node_modules" | grep -v ".d.ts"
   grep -rn "pointsBalance" src/ --include="*.ts" | grep -v "node_modules" | grep -v ".d.ts"
   ```
   Every hit should be either a `select` (read) or inside `LedgerService`/`PointsLedgerService`. Anything else is a violation.

2. **Missing FOR UPDATE** — check every `$transaction` block in services:
   ```bash
   grep -rn "\$transaction" src/services/ --include="*.ts"
   ```
   Any transaction that modifies balances must lock the relevant rows with `FOR UPDATE`. Check `events.ts` (settle, cancel), `predictions.ts` (cashout), `ledger.ts`, `pointsLedger.ts`, `tokenAllowance.ts`.

3. **Live Odds API calls on user actions** — check prediction placement and cashout paths:
   - `src/services/predictions.ts` — does `place()` or `executeCashout()` call `OddsApiService.getEventOdds()` or any method that hits the external API?
   - If so, it must be replaced with reading from `event.currentOdds` (cached).
   - Scheduled sync and admin manual sync are the ONLY acceptable places for live API calls.

4. **Unmigrated schema changes** — check if there are any model changes in `prisma/schema.prisma` that don't have a corresponding migration in `prisma/migrations/`. Run:
   ```bash
   npx prisma migrate diff --from-migrations --to-schema-datamodel prisma/schema.prisma
   ```
   If output is non-empty, a migration is needed.

### Phase 3: Edge Cases & Race Conditions

Review these specific scenarios:

1. **Inline cashout state** — in `PredictionsPage.tsx`, after a successful cashout:
   - Is the prediction updated in local state correctly?
   - What happens if the user rapid-clicks the cashout button before the first request completes? Is the button disabled during the request?
   - What happens if the cashout API returns an error after the button was disabled? Does it re-enable?
   - Does `refreshUser()` get called to update the header balance?

2. **Toast system** — check `ToastContext.tsx`:
   - Max 3 toasts visible — is there logic to dismiss the oldest when a 4th arrives?
   - Auto-dismiss timers — do they clean up on unmount? (memory leak if not)
   - Is the toast container positioned with `fixed` and a high `z-index` so it's always visible?

3. **Transaction history pagination** — in `TransactionHistoryPage.tsx`:
   - "Load more" button — does it append to existing results or replace them?
   - What happens when there are zero transactions? Empty state shown?
   - Does switching between Tokens/Points tabs reset the offset to 0?

4. **Admin settle modal** — in `AdminEventsPage.tsx`:
   - Does the outcome dropdown populate from `event.outcomes`?
   - What if `event.outcomes` is empty or null? (shouldn't happen, but defensive check)
   - After settling, does the event list refresh?
   - Is there a confirmation step before settling? (Settlement is irreversible)

5. **Admin user balance operations** — in `AdminUsersPage.tsx`:
   - Credit tokens form — is the amount validated as a positive integer?
   - Does it show the result after crediting?
   - Verify/repair balance — does it show before/after values?

6. **Sport filter with null sportKey** — in `EventsPage.tsx`:
   - Events created before multi-sport support may have `externalSportKey: null`
   - Does the "All" tab show these events?
   - Does filtering by a specific sport correctly exclude them?

7. **Rate limiter in production** — Railway uses a reverse proxy. Check:
   - Is `app.set('trust proxy', 1)` set in `src/app.ts`? Without this, `req.ip` will always be the proxy IP and rate limiting will be global instead of per-user.
   - If it's not set, add it.

8. **SSE connection cleanup** — if SSE is used anywhere on the frontend:
   - Are EventSource connections closed when components unmount?
   - What happens if the SSE endpoint returns an error? Does it retry infinitely?

### Phase 4: Missing Pieces Check

For each item, note whether it's present, partially done, or missing:

- [ ] Toast system wired into EVERY page that makes API calls
- [ ] Inline cashout working without page reload
- [ ] Transaction history page accessible from nav
- [ ] `GET /points/transactions` endpoint exists and returns paginated results
- [ ] Admin panel accessible at `/admin` (admin users only)
- [ ] Admin dashboard shows live stats
- [ ] Admin can settle events from the UI
- [ ] Admin can manage rewards from the UI
- [ ] Leaderboard page exists and is accessible from nav
- [ ] Sport filter on events page
- [ ] Rate limiting on auth endpoints
- [ ] `tokensRemaining` correctly tracks allowance (not total balance)
- [ ] `console.log` replaced with structured logger in `src/` (not scripts/)
- [ ] Points metrics in admin stats response
- [ ] PWA manifest with correct metadata and icons
- [ ] `trust proxy` set in app.ts

### Phase 5: Quick Security Scan

1. **Auth endpoints** — confirm rate limiters are applied to login, register, change-password
2. **Admin routes** — confirm ALL admin routes check `isAdmin` (the middleware should handle this, but verify no route was accidentally added without the guard)
3. **Input validation** — spot-check 3 POST endpoints: are request bodies validated with Zod schemas before processing?
4. **Error responses** — confirm no endpoint leaks stack traces or internal error details in production. Check the global error handler in `src/middleware/errorHandler.ts` or equivalent.
5. **CORS** — check `src/app.ts` for CORS config. The allowed origin should be the Vercel frontend URL, not `*`.

---

## Output Format

After the review, produce a single file `REVIEW_RESULTS.md` with:

1. **Build status** — clean or list of errors fixed
2. **Constraint violations found** — list with file, line, description, fix applied
3. **Edge cases fixed** — list with description and fix
4. **Missing pieces** — checklist with status
5. **Security issues** — list with severity and fix
6. **Remaining TODOs** — anything that needs manual intervention or a follow-up session

Fix everything you can. For things you can't fix (e.g. needs a migration run against production), document the exact command needed.
