# Project Software & Access Tracker

> **Project:** Prediction Platform MVP
> **Last Updated:** 2026-02-11

---

## Hosting & Deployment

| Service | Used For | Login? | API Key? | Billing? | Notes |
|---------|----------|--------|----------|----------|-------|
| Docker / Docker Compose | Local dev environment (API + PostgreSQL + ngrok) | No | No | No | Free for local dev |
| ngrok | Mobile device testing via tunnel | Yes | Yes (auth token) | Free tier / Paid | Configured in Docker Compose |
| **No production host configured yet** | — | — | — | — | No `fly.toml` or cloud deploy config found. Needs Review |

---

## Database

| Service | Used For | Login? | API Key? | Billing? | Notes |
|---------|----------|--------|----------|----------|-------|
| PostgreSQL 14+ | Primary database (users, ledgers, events, predictions) | Yes (connection string) | No | Free locally / Paid in production | Managed via Prisma ORM |
| Prisma | ORM, migrations, schema management, Prisma Studio GUI | No | No | No | `@prisma/client` v5.22 |

**Environment Variables:**
- `DATABASE_URL` — PostgreSQL connection string

---

## External APIs

| Service | Used For | Login? | API Key? | Billing? | Notes |
|---------|----------|--------|----------|----------|-------|
| The Odds API | Live odds data, event scores, settlement info | Yes | Yes | Free tier (monthly credits) / Paid tiers | Base URL: `https://api.the-odds-api.com/v4` |

**Environment Variables:**
- `THE_ODDS_API_KEY`
- `THE_ODDS_API_REGIONS` (default: `uk`)
- `THE_ODDS_API_MARKETS` (default: `h2h`)
- `THE_ODDS_API_BASE_URL`
- `ODDS_SYNC_INTERVAL_SECONDS`
- `SETTLEMENT_INTERVAL_SECONDS`

---

## Authentication

| Service | Used For | Login? | API Key? | Billing? | Notes |
|---------|----------|--------|----------|----------|-------|
| JSON Web Tokens (jsonwebtoken) | User session auth | No | No | No | Self-hosted, no external provider |
| bcryptjs | Password hashing | No | No | No | Salt rounds configurable |

**Environment Variables:**
- `JWT_SECRET` — Must be 32+ characters
- `JWT_EXPIRES_IN` (default: `7d`)
- `BCRYPT_SALT_ROUNDS` (default: `10`)

---

## Storage

| Service | Used For | Login? | API Key? | Billing? | Notes |
|---------|----------|--------|----------|----------|-------|
| **None configured** | — | — | — | — | No file/object storage found (no S3, Cloudinary, etc.) |

---

## Email / Notifications

| Service | Used For | Login? | API Key? | Billing? | Notes |
|---------|----------|--------|----------|----------|-------|
| **None configured** | — | — | — | — | No email service found (no SendGrid, Resend, etc.) |

---

## Analytics / Tracking

| Service | Used For | Login? | API Key? | Billing? | Notes |
|---------|----------|--------|----------|----------|-------|
| **None configured** | — | — | — | — | No analytics found (no Mixpanel, PostHog, GA, etc.) |

---

## Payments

| Service | Used For | Login? | API Key? | Billing? | Notes |
|---------|----------|--------|----------|----------|-------|
| Stripe | Token purchases (future) | Yes | Yes | Yes | Commented out in `.env.example`. Not yet integrated |

**Planned Environment Variables:**
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

---

## Developer Tools

| Tool | Purpose | Account Needed? | Notes |
|------|---------|-----------------|-------|
| Node.js 20+ | Runtime | No | Required engine |
| TypeScript 5.6 | Type safety (backend + frontend) | No | Compiled via `tsc` |
| Express 4 | API framework | No | — |
| Vite 5 | Frontend dev server + bundler | No | Proxy to API on port 3000 |
| React 18 | Frontend UI | No | With React Router v6 |
| Tailwind CSS 3 | Frontend styling | No | With PostCSS + Autoprefixer |
| ESLint 9 | Linting | No | With `typescript-eslint` |
| tsx | Dev server with hot reload | No | `tsx watch` for backend |
| Prisma Studio | Visual database GUI | No | `npm run db:studio` |
| Zod | Runtime schema validation | No | Used for API input + env config |
| dotenv | Env variable loading | No | — |
| Helmet | HTTP security headers | No | — |
| CORS | Cross-origin config | No | `FRONTEND_URL` controls allowed origin |
| express-rate-limit | API rate limiting | No | — |

---

## All Environment Variables (Names Only)

| Variable | Required? | Has Default? |
|----------|-----------|-------------|
| `DATABASE_URL` | Yes | No |
| `JWT_SECRET` | Yes | No |
| `JWT_EXPIRES_IN` | No | `7d` |
| `BCRYPT_SALT_ROUNDS` | No | `10` |
| `PORT` | No | `3000` |
| `NODE_ENV` | No | `development` |
| `FRONTEND_URL` | No | No |
| `SIGNUP_BONUS_TOKENS` | No | `0` |
| `DAILY_ALLOWANCE_TOKENS` | No | `5` |
| `MAX_ALLOWANCE_TOKENS` | No | `35` |
| `MIN_STAKE_AMOUNT` | No | `1` |
| `MAX_STAKE_AMOUNT` | No | `35` |
| `RATE_LIMIT_MAX` | No | `100` |
| `RATE_LIMIT_WINDOW_MINUTES` | No | `15` |
| `THE_ODDS_API_KEY` | Yes | No |
| `THE_ODDS_API_REGIONS` | No | `uk` |
| `THE_ODDS_API_MARKETS` | No | `h2h` |
| `THE_ODDS_API_BASE_URL` | No | `https://api.the-odds-api.com/v4` |
| `ODDS_SYNC_INTERVAL_SECONDS` | No | `300` |
| `SETTLEMENT_INTERVAL_SECONDS` | No | `300` |

---

## CI / CD

| Service | Used For | Login? | Notes |
|---------|----------|--------|-------|
| **None configured** | — | — | No GitHub Actions, CircleCI, or similar found |

---

## Quick Checklist

- [ ] PostgreSQL running locally or connection string set
- [ ] The Odds API key obtained and set in `.env`
- [ ] JWT secret generated (`openssl rand -base64 64`)
- [ ] `.env` file created from `.env.example`
- [ ] `npm run db:generate` and `npm run db:migrate` run
- [ ] ngrok auth token set (if mobile testing needed)
- [ ] Stripe account created (when ready for payments)
- [ ] Production hosting provider chosen (Fly.io, Railway, Render, etc.)
- [ ] CI/CD pipeline set up
- [ ] Email service chosen for notifications
- [ ] Analytics platform chosen
