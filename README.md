# Prediction Platform API

A token-based prediction platform where users receive free daily tokens to make predictions on real-world events and earn points as rewards. Points can be redeemed for gift cards or merchandise. The system avoids cash payouts, peer-to-peer betting, and withdrawals.

## Key Features

- **Daily token allowance**: Users receive 5 tokens per day (stacking to 35 max)
- **Token → Points flow**: Tokens are staked; winnings and cashouts pay in points
- **Cashout**: Exit predictions early based on live odds
- **Odds integration**: Live odds and event settlement via The Odds API
- **Admin controls**: Manage events, rewards, and manual overrides

## Architecture Highlights

- **Two ledgers**: Tokens and points are tracked separately
- **Append-only**: Ledger entries are never updated
- **Atomic operations**: Balance changes use database transactions + row locks
- **Auditability**: Every token/point movement is logged

---

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- npm or yarn

### Setup

```bash
# Clone and install
cd prediction-platform
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database URL and The Odds API key

# Setup database
npm run db:generate    # Generate Prisma client
npm run db:migrate     # Run migrations

# Seed with test data (optional)
npm run db:seed

# Start development server
npm run dev
```

### Test Accounts (after seeding)

| Role  | Email              | Password   |
|-------|--------------------|------------|
| Admin | admin@example.com  | Admin123!  |
| User  | test@example.com   | Test123!   |

---

## Production Deployment (Docker)

`ngrok` is for temporary tunnel access during development/testing. It is not required for production.

### 1. Prepare production env file

```bash
cp .env.production.example .env.production
# Edit all placeholder values before launch
```

At minimum, set strong values for:
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_SECRET`
- `FRONTEND_URL`
- `THE_ODDS_API_KEY`

### 2. Launch production stack

```bash
npm run docker:prod:up
```

This starts:
- PostgreSQL (internal container network)
- API (`NODE_ENV=production`, compiled TypeScript, migration on startup)
- Frontend (static files served by nginx, with `/api` proxied to API)

### 3. Verify health

```bash
curl -f http://localhost/api/health/live
curl -f http://localhost/health
```

### 4. Stop stack

```bash
npm run docker:prod:down
```

---

## API Reference

Base URL: `http://localhost:3000/api`

### Authentication

All authenticated endpoints require:
```
Authorization: Bearer <token>
```

#### Register
```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

#### Login
```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

#### Get Current User
```http
GET /auth/me
Authorization: Bearer <token>
```

#### Get Token Balance
```http
GET /auth/balance
Authorization: Bearer <token>
```

#### Get Token Transaction History
```http
GET /auth/transactions?limit=20&offset=0
Authorization: Bearer <token>
```

#### Change Password
```http
POST /auth/change-password
Authorization: Bearer <token>
Content-Type: application/json

{
  "currentPassword": "OldPass123!",
  "newPassword": "NewPass123!"
}
```

---

### Tokens

#### Get Allowance
```http
GET /tokens/allowance
Authorization: Bearer <token>
```

---

### Points

#### Get Points Balance
```http
GET /points/balance
Authorization: Bearer <token>
```

---

### Events

#### List Events
```http
GET /events?status=OPEN&upcoming=true&limit=20
```

#### List Upcoming Events
```http
GET /events/upcoming?limit=20
```

#### Get Event
```http
GET /events/:id
```

#### Get Event Stats
```http
GET /events/:id/stats
```

#### Get Live Odds
```http
GET /events/:id/odds
```

---

### Predictions

#### Place Prediction
```http
POST /predictions
Authorization: Bearer <token>
Content-Type: application/json

{
  "eventId": "event_id",
  "predictedOutcome": "Team A Wins",
  "stakeAmount": 5
}
```

#### List My Predictions
```http
GET /predictions?status=PENDING&limit=20
Authorization: Bearer <token>
```

#### Get Prediction
```http
GET /predictions/:id
Authorization: Bearer <token>
```

#### Get My Stats
```http
GET /predictions/stats
Authorization: Bearer <token>
```

#### Get Cashout Value
```http
GET /predictions/:id/cashout-value
Authorization: Bearer <token>
```

#### Execute Cashout
```http
POST /predictions/:id/cashout
Authorization: Bearer <token>
```

---

### Rewards

#### List Rewards
```http
GET /rewards
```

#### Get Reward
```http
GET /rewards/:id
```

#### Redeem Reward
```http
POST /rewards/:id/redeem
Authorization: Bearer <token>
```

#### List My Redemptions
```http
GET /rewards/redemptions
Authorization: Bearer <token>
```

#### Get Redemption
```http
GET /rewards/redemptions/:id
Authorization: Bearer <token>
```

---

### Admin Endpoints

All admin endpoints require admin privileges.

#### Create Event
```http
POST /admin/events
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "title": "Match Title",
  "description": "Optional description",
  "startsAt": "2024-12-25T15:00:00Z",
  "outcomes": ["Team A Wins", "Team B Wins", "Draw"],
  "payoutMultiplier": 2.0,
  "externalEventId": "odds_api_event_id",
  "externalSportKey": "soccer_epl"
}
```

#### Lock Event
```http
POST /admin/events/:id/lock
Authorization: Bearer <admin_token>
```

#### Settle Event (manual override)
```http
POST /admin/events/:id/settle
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "finalOutcome": "Team A Wins"
}
```

#### Cancel Event
```http
POST /admin/events/:id/cancel
Authorization: Bearer <admin_token>
```

#### Auto-Lock Started Events
```http
POST /admin/events/auto-lock
Authorization: Bearer <admin_token>
```

#### Sync Odds
```http
POST /admin/odds/sync
Authorization: Bearer <admin_token>
```

#### Create Reward
```http
POST /admin/rewards
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "name": "$10 Gift Card",
  "description": "Digital delivery",
  "pointsCost": 5000,
  "stockLimit": 100
}
```

#### Update Reward
```http
PATCH /admin/rewards/:id
Authorization: Bearer <admin_token>
Content-Type: application/json
```

#### List Rewards (including inactive)
```http
GET /admin/rewards
Authorization: Bearer <admin_token>
```

#### Fulfil Redemption
```http
POST /admin/redemptions/:id/fulfil
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "fulfilmentNote": "Gift card code: XXXX-YYYY"
}
```

#### List Redemptions
```http
GET /admin/redemptions
Authorization: Bearer <admin_token>
```

#### Cancel Redemption
```http
POST /admin/redemptions/:id/cancel
Authorization: Bearer <admin_token>
```

#### Credit Tokens to User (admin adjustment)
```http
POST /admin/tokens/credit
Authorization: Bearer <admin_token>
Content-Type: application/json
```

#### Platform Stats
```http
GET /admin/stats
Authorization: Bearer <admin_token>
```

#### List Users
```http
GET /admin/users
Authorization: Bearer <admin_token>
```

#### Settlement Worker (manual trigger)
```http
POST /admin/settlement/run
Authorization: Bearer <admin_token>
```

#### Settlement Worker Status
```http
GET /admin/settlement/status
Authorization: Bearer <admin_token>
```

---

### Health

```http
GET /health
GET /health/ready
GET /health/live
```

---

## Data Model

### Core Entities

```
User
├── id, email, passwordHash
├── tokenBalance, pointsBalance (cached)
├── isAdmin, isVerified
└── → predictions, tokenTransactions, pointsTransactions, redemptions

TokenTransaction (Token Ledger - IMMUTABLE)
├── id, userId, amount (+/-)
├── balanceAfter
├── type (DAILY_ALLOWANCE, PREDICTION_STAKE, etc.)
├── referenceType, referenceId
└── createdAt

PointsTransaction (Points Ledger - IMMUTABLE)
├── id, userId, amount (+/-)
├── balanceAfter
├── type (PREDICTION_WIN, CASHOUT, REDEMPTION, etc.)
├── referenceType, referenceId
└── createdAt

TokenAllowance
├── userId, tokensRemaining, lastResetDate

Event
├── id, title, description
├── startsAt, status
├── outcomes[], finalOutcome
├── payoutMultiplier
├── externalEventId, externalSportKey
├── currentOdds, oddsUpdatedAt
└── → predictions

Prediction
├── id, userId, eventId
├── predictedOutcome, stakeAmount
├── originalOdds, cashoutAmount, cashedOutAt
├── status (PENDING → WON/LOST/REFUNDED/CASHED_OUT)
├── payout
└── settledAt

Reward
├── id, name, description
├── pointsCost
├── stockLimit, stockClaimed
└── isActive

Redemption
├── id, userId, rewardId
├── pointsCost
├── status (PENDING → FULFILLED/CANCELLED)
└── fulfilmentNote
```

---

## Token & Points Rules

- Users receive **5 tokens per day**, stacking up to **35**
- Tokens are **consumed immediately** when placing a prediction
- Winnings and cashouts pay out in **points**
- Points are redeemable for rewards (no withdrawals)
- Tokens cannot be purchased (free entry only)

---

## Odds & Settlement

- Live odds are fetched via **The Odds API**
- Odds are cached on events (`currentOdds`)
- Settlement worker polls scores and settles events automatically
- Manual admin settlement remains available as an override

---

## Scripts

```bash
npm run dev          # Start development server with hot reload
npm run build        # Compile TypeScript
npm run start        # Run production build
npm run db:generate  # Generate Prisma client
npm run db:migrate   # Run database migrations
npm run db:seed      # Seed database with test data
npm run db:studio    # Open Prisma Studio (GUI)
npm run typecheck    # Type check without building
```

---

## Environment Variables

See `.env.example` for all options. Key variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | - |
| `JWT_SECRET` | Secret for signing JWTs | - |
| `JWT_EXPIRES_IN` | Token expiration | 7d |
| `PORT` | Server port | 3000 |
| `DAILY_ALLOWANCE_TOKENS` | Daily free tokens | 5 |
| `MAX_ALLOWANCE_TOKENS` | Max stacked tokens | 35 |
| `MIN_STAKE_AMOUNT` | Min stake | 1 |
| `MAX_STAKE_AMOUNT` | Max stake | 35 |
| `THE_ODDS_API_KEY` | The Odds API key | - |
| `THE_ODDS_API_REGIONS` | Regions | uk |
| `THE_ODDS_API_MARKETS` | Markets | h2h |
| `ODDS_SYNC_INTERVAL_SECONDS` | Odds polling interval | 300 |
| `SETTLEMENT_INTERVAL_SECONDS` | Settlement polling interval | 300 |

---

## Project Structure

```
prediction-platform/
├── prisma/
│   ├── schema.prisma      # Database schema
│   └── seed.ts            # Seed script
├── src/
│   ├── config/            # Environment & configuration
│   ├── middleware/        # Auth, validation, error handling
│   ├── routes/            # API route handlers
│   ├── services/          # Business logic
│   │   ├── ledger.ts      # Token ledger
│   │   ├── pointsLedger.ts# Points ledger
│   │   ├── oddsApi.ts     # Odds API client
│   │   ├── oddsSync.ts    # Odds sync worker
│   │   ├── settlementWorker.ts # Auto settlement
│   │   └── ...
│   ├── types/             # TypeScript types
│   ├── utils/             # Helpers & utilities
│   ├── app.ts             # Express app config
│   └── index.ts           # Server entry point
├── .env.example
├── package.json
└── tsconfig.json
```

---

## License

Private - All rights reserved.
# betting_thing
