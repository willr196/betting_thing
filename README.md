# Prediction Platform

Prediction Platform is a token-based sports prediction app with a React frontend, an Express/Prisma API, PostgreSQL persistence, and automated odds/event ingestion from The Odds API.

## Current implementation

- Secure auth and account management: register/login, refresh-token sessions via HTTP-only cookie, forgot/reset password, login lockout, profile editing, password changes, and logout-all.
- Token and points economy: weekly token allowance with daily top-ups, append-only token and points ledgers, wallet and transaction views, admin credit/debit tools, and balance verification/repair flows.
- Prediction flows: imported or manually created events, single picks, accumulator slips, cashout support, auto-locking, settlement, cancellation/refunds, and leaderboard/stat updates.
- Competition and progression: weekly/monthly/all-time public leaderboard, achievements, streak tracking, private or open leagues with invite codes, league settings, ownership transfer, and weekly/all-time league standings.
- Rewards and operations: reward catalogue, redemption history, admin reward fulfilment/cancellation, admin dashboards for users/events/rewards/system, audit logging, odds quota visibility, and manual sync/import/settlement controls.
- Supported sports in the current config: Premier League and Champions League are enabled by default. More sports are defined in `src/config/sports.ts` and can be enabled when quota allows.
- Not fully shipped yet: `Promotions` and `Minigames` are scaffolded frontend routes, not complete product features.

## Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS, Vitest
- Backend: Node.js 20, Express, TypeScript, Prisma, Zod
- Database: PostgreSQL
- Integrations: The Odds API, SMTP for password reset emails, Render deployment files

## Repo layout

```text
.
|- frontend/           React app, routes, contexts, tests
|- prisma/             Prisma schema, migrations, seed/reset scripts
|- scripts/            Utility scripts such as event import and DB backup
|- src/
|  |- config/          Environment and sport configuration
|  |- middleware/      Auth, validation, and error middleware
|  |- routes/          API route modules
|  |- services/        Core business logic and background workers
|  |- __tests__/       Backend test coverage
|- docker-compose.yml  Local Postgres/API/frontend workflow
|- render.yaml         Render Blueprint deployment
`- RENDER_MANUAL_SETUP.md
```

## API modules

| Route group | Purpose |
| --- | --- |
| `/api/v1/auth` | Register, login, refresh, logout, forgot/reset password, profile, dashboard stats |
| `/api/v1/events` | Event listings, event detail, odds, stats |
| `/api/v1/predictions` | Place singles, list predictions, stats, cashout |
| `/api/v1/accumulators` | Place and inspect accumulator slips |
| `/api/v1/tokens` | Token balance and allowance status |
| `/api/v1/points` | Points balance and points transaction history |
| `/api/v1/leaderboard` | Public weekly, monthly, and all-time rankings |
| `/api/v1/achievements` | Achievement catalogue, unlocked items, next progress |
| `/api/v1/rewards` | Reward catalogue, redemptions, redemption history |
| `/api/v1/leagues` | League creation, join/leave, membership, invite codes, standings |
| `/api/v1/admin` | User ops, event ops, reward ops, audit log, system actions |
| `/api/v1/health` | Health and liveness checks |

## Local development

### Prerequisites

- Node.js 20+
- npm
- PostgreSQL 16+ locally, or Docker for the database container

### 1. Install dependencies

```sh
npm ci
cd frontend && npm ci
```

### 2. Configure environment variables

Use `.env.example` as the source of truth:

```sh
cp .env.example .env
```

Minimum backend values for a usable local run:

- `DATABASE_URL`
- `JWT_SECRET`
- `THE_ODDS_API_KEY`

Notes:

- `FRONTEND_URL` is only required in production.
- `SMTP_*` values are optional. If SMTP is not configured, password reset links are logged instead of sent.
- For frontend local dev, leave `VITE_API_URL` unset to use Vite's `/api/v1` proxy, or set it to `http://localhost:3000/api/v1`.

### 3. Start Postgres and prepare Prisma

If you want to use the included local database container:

```sh
docker compose up -d db
```

Then prepare the database:

```sh
npm run db:generate
npm run db:migrate
npm run db:seed
```

### 4. Run the backend and frontend

Backend:

```sh
npm run dev
```

Frontend:

```sh
cd frontend && npm run dev
```

Default local URLs:

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000/api/v1`
- Liveness check: `http://localhost:3000/api/v1/health/live`

## Seed data

`npm run db:seed` creates:

- An admin user at `SEED_ADMIN_EMAIL` or `admin@example.com`
- A standard user at `SEED_USER_EMAIL` or `user@example.com`
- A password from `SEED_PASSWORD`, or a generated password printed to the terminal
- Sample events
- Sample rewards

## Admin bootstrap

If production was deployed without running the seed script, create or promote an admin without wiping user data:

```sh
DATABASE_URL="<external-render-postgres-url>" \
npm run admin:upsert -- --email admin@example.com --password 'StrongPassword123!'
```

The script creates the user if missing, promotes it to admin, verifies the account, clears lockout/session state, and updates the password.

## Runtime behavior

The API starts more than just the HTTP server. In non-test environments it also:

- Auto-locks events that have already started
- Cancels stale events with no predictions
- Deletes old finished events
- Runs startup auto-import when open event inventory is low and quota allows
- Schedules odds sync, settlement, and event import workers
- Recalculates league standings daily

## Quality checks

Backend:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Frontend:

```sh
cd frontend && npm test
cd frontend && npm run build
```

## Deployment

- `render.yaml` contains the Render Blueprint for database, API, and frontend services.
- `RENDER_MANUAL_SETUP.md` documents a manual Render setup without Blueprints.
- `.env.example` is the environment-variable reference for both local and Render usage.

For standalone frontend deployments, `VITE_API_URL` should point at the API base and include `/api/v1`.
