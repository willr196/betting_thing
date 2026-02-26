# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start development server with hot reload (tsx watch)
npm run build        # Compile TypeScript to dist/
npm run typecheck    # Type check without emitting files
npm run lint         # ESLint on src/**/*.ts

npm run db:generate  # Generate Prisma client after schema changes
npm run db:migrate   # Run migrations (dev — creates migration files)
npm run db:migrate:prod  # Deploy migrations (production — no file creation)
npm run db:seed      # Seed with test users (admin@example.com / Admin123!, test@example.com / Test123!)
npm run db:studio    # Open Prisma Studio GUI

npm run docker:prod:up    # Build + start production stack (API + PostgreSQL + nginx frontend)
npm run docker:prod:down  # Stop production stack
```

After any `prisma/schema.prisma` change, always run `db:generate` before `db:migrate`.

## Architecture

**Express REST API** (TypeScript, Node 20+, ESM modules with `.js` imports on `.ts` source files).

### Layer structure

- `src/index.ts` — entry point, starts HTTP server, initialises background workers (odds sync, settlement)
- `src/app.ts` — Express app config (helmet, CORS, rate limiting, body parsing, routes mounted at `/api`)
- `src/config/index.ts` — all env vars validated and typed here; import `config` everywhere instead of `process.env`
- `src/routes/` — thin route handlers; use `asyncHandler()` wrapper and `requireAuth`/`requireAdmin` middleware
- `src/services/` — all business logic lives here
- `src/middleware/` — `requireAuth`, `requireAdmin`, `optionalAuth`, `getAuthUser()`, `validate` (Zod), error handler
- `src/types/index.ts` — shared TypeScript types and `ErrorCodes` enum
- `src/utils/index.ts` — `AppError`, `sendSuccess`, `asyncHandler`, `omit`, `parseLimitOffset`, etc.

### Ledger architecture (critical)

The platform has **two immutable append-only ledgers**:

- **Token ledger** — `TokenTransaction` table, managed by `LedgerService` (`src/services/ledger.ts`)
- **Points ledger** — `PointsTransaction` table, managed by `PointsLedgerService` (`src/services/pointsLedger.ts`)

Both are implemented via the generic `createLedgerService` factory in `src/services/ledgerCore.ts`. Key invariants:
- Records are **never updated or deleted**
- `User.tokenBalance` / `User.pointsBalance` are cached denormalized values — always equal `SUM(transactions)` but the ledger is source of truth
- All balance changes use `prisma.$transaction` with `SELECT ... FOR UPDATE` row locks to prevent races
- Balance can never go negative (enforced in `ledgerCore.ts`)

### Event lifecycle

`OPEN` → `LOCKED` → `SETTLED` (or `CANCELLED` at any point)

- Predictions only accepted on `OPEN` events whose `startsAt` is in the future
- Auto-lock: `POST /admin/events/auto-lock` locks events that have started
- Auto-settlement: `SettlementWorker` (`src/services/settlementWorker.ts`) polls The Odds API scores every `SETTLEMENT_INTERVAL_SECONDS`, settles `LOCKED` events with `externalEventId`
- Manual settlement: `POST /admin/events/:id/settle`

### Token allowance vs token ledger

`TokenAllowance` (in `src/services/tokenAllowance.ts`) tracks the **daily 5-token grant** (stacking up to 35). When a user places a prediction, `TokenAllowanceService.consumeTokens` is called inside the transaction — this both deducts from the allowance and calls `LedgerService.stakeForPrediction` to debit the token ledger.

### Cashout formula

Cashout value = `floor(stake × (originalOdds / currentOdds) × margin)`
- `margin = 0.95` before event starts, `0.90` after
- Odds must be < 5 minutes stale; prediction must be `PENDING`

### Error handling

Route handlers throw `AppError` instances (or `AppError` factory methods: `.badRequest()`, `.notFound()`, `.unauthorized()`, `.forbidden()`, `.conflict()`, `.insufficientBalance()`). The global error handler in `src/middleware/error.ts` converts them to `{ success: false, error: { code, message, details } }` responses. All successful responses follow `{ success: true, data: ... }` via `sendSuccess()`.

### Background workers

Both workers are started in `src/index.ts` and use `setInterval`:
- `OddsSyncWorker` (`src/services/oddsSync.ts`) — syncs live odds from The Odds API to `Event.currentOdds`
- `SettlementWorker` (`src/services/settlementWorker.ts`) — settles completed events; idempotent (skips already-settled events)
