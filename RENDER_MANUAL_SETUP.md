# Manual Render Setup

This guide is for deploying this repo on Render without using `render.yaml` / Blueprints.

It is based on the repo's current deployment files:
- `Dockerfile.api.prod`
- `frontend/package.json`
- `.env.example`
- `render.yaml`

If you use different Render service names than the ones below, replace the URLs accordingly.

## Recommended service names

- Postgres: `prediction-db-fresh`
- API: `prediction-api-fresh`
- Frontend: `prediction-frontend-fresh`

## 1. Create the Postgres database

In Render:

1. Click `New` -> `PostgreSQL`.
2. Use these values:

| Field | Value |
| --- | --- |
| Name | `prediction-db-fresh` |
| Database | `prediction_platform` |
| User | `prediction` |
| Region | Same region you will use for the API |
| Plan | Any plan available to your account |

3. Create the database.
4. Open the database in Render and copy its `Internal Database URL`.

Use the internal URL for the API service when the API and database are on Render in the same region.

Do not use the internal URL from your local shell for Prisma CLI commands. If you run `npx prisma ...` from your laptop, workstation, or Codex shell, use the database's `External Database URL` instead. A bare host like `dpg-xxxxx` is Render's internal hostname and usually fails locally with `P1001`.

## 2. Create the API web service

In Render:

1. Click `New` -> `Web Service`.
2. Connect this GitHub repo.
3. Use these settings:

| Field | Value |
| --- | --- |
| Name | `prediction-api-fresh` |
| Branch | Your deploy branch |
| Region | Same region as `prediction-db-fresh` |
| Runtime / Language | `Docker` |
| Root Directory | Leave blank |
| Dockerfile Path | `./Dockerfile.api.prod` |
| Docker Context Directory | `.` |
| Docker Command | Leave blank |
| Health Check Path | `/api/v1/health/live` |
| Auto-Deploy | `Yes` |

Do not add a custom start command. The Dockerfile already starts the API with:

```sh
npx prisma migrate deploy && node dist/index.js
```

### API environment variables: minimum required

Add these on the API service before the first deploy:

```env
NODE_ENV=production
DATABASE_URL=<Internal Database URL from prediction-db-fresh>
JWT_SECRET=<generate with: openssl rand -base64 48>
FRONTEND_URL=https://prediction-frontend-fresh.onrender.com
TRUST_PROXY=1
THE_ODDS_API_KEY=<your real The Odds API key>
```

Notes:

- `DATABASE_URL` should be the Render Postgres internal URL on the Render API service itself.
- If you run Prisma against production from your local machine, use the Render Postgres external URL for that command instead of reusing the service's internal URL.
- `FRONTEND_URL` is required in production by this codebase.
- `THE_ODDS_API_KEY` is required at startup by the API config.
- Do not leave `NODE_ENV` blank. On Render, an empty dashboard value overrides the Docker image's `NODE_ENV=production` and the API will fail at startup.
- You can leave all `SMTP_*` variables unset.

### API environment variables: recommended to match `render.yaml`

These are not all strictly required because the app has defaults, but setting them makes the manual setup behave like the repo's Blueprint config:

```env
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_DAYS=30
BCRYPT_SALT_ROUNDS=12
SIGNUP_BONUS_TOKENS=0
WEEKLY_START_TOKENS=5
DAILY_ALLOWANCE_TOKENS=1
MAX_ALLOWANCE_TOKENS=11
MIN_STAKE_AMOUNT=1
MAX_STAKE_AMOUNT=11
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MINUTES=15
LOGIN_LOCKOUT_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_WINDOW_MINUTES=15
THE_ODDS_API_REGIONS=uk
THE_ODDS_API_MARKETS=h2h
THE_ODDS_API_BASE_URL=https://api.the-odds-api.com/v4
ODDS_SYNC_INTERVAL_SECONDS=300
SETTLEMENT_INTERVAL_SECONDS=300
ODDS_SYNC_LOOKAHEAD_HOURS=48
ODDS_CACHE_TTL_SECONDS=300
ODDS_SCORES_CACHE_TTL_SECONDS=120
ODDS_STALENESS_THRESHOLD_MINUTES=30
ODDS_API_MONTHLY_QUOTA=500
EVENT_IMPORT_INTERVAL_SECONDS=21600
AUTO_IMPORT_SPORTS=soccer_epl
CASHOUT_STALENESS_THRESHOLD_MS=300000
CASHOUT_ODDS_DRIFT_THRESHOLD_PERCENT=5
SMTP_PORT=587
SMTP_SECURE=false
PASSWORD_RESET_EXPIRES_MINUTES=60
```

### SMTP

You do not need to set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, or `SMTP_FROM` unless you want password reset emails to work.

Do not add them with blank values. Just leave them unset.
The same rule applies to any optional env var on Render: blank values override image defaults and are not the same as "unset".

## 3. Create the frontend static site

In Render:

1. Click `New` -> `Static Site`.
2. Connect the same GitHub repo.
3. Use these settings:

| Field | Value |
| --- | --- |
| Name | `prediction-frontend-fresh` |
| Branch | Your deploy branch |
| Root Directory | `frontend` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |
| Auto-Deploy | `Yes` |

### Frontend environment variable

Add:

```env
VITE_API_URL=https://prediction-api-fresh.onrender.com/api/v1
```

If you gave the API a different Render name, use that actual URL instead.

### Static site rewrite

Add this rewrite so React Router works:

| Source | Destination | Action |
| --- | --- | --- |
| `/*` | `/index.html` | `Rewrite` |

### Optional static response headers

These are not required, but they match the repo's `render.yaml`:

| Path | Header | Value |
| --- | --- | --- |
| `/*` | `X-Frame-Options` | `DENY` |
| `/*` | `X-Content-Type-Options` | `nosniff` |
| `/assets/*` | `Cache-Control` | `public, max-age=31536000, immutable` |

## 4. Deploy order

Use this order:

1. Create the Postgres database.
2. Create the API service and set its env vars.
3. Wait for the API to deploy.
4. Create the frontend static site and set `VITE_API_URL`.
5. Redeploy the frontend after setting `VITE_API_URL`.
6. Go back to the API and confirm `FRONTEND_URL` matches the real frontend URL exactly.
7. Redeploy the API if you changed `FRONTEND_URL`.

## 5. URLs to test

After deploy:

- API root: `https://prediction-api-fresh.onrender.com/`
- API base: `https://prediction-api-fresh.onrender.com/api/v1`
- API health: `https://prediction-api-fresh.onrender.com/api/v1/health/live`
- Frontend: `https://prediction-frontend-fresh.onrender.com/`

If your service names differ, use your actual Render URLs.

## 6. Troubleshooting

### API will not start

Check these first:

- `DATABASE_URL` is set to the Render Postgres internal URL
- `JWT_SECRET` is not a placeholder
- `FRONTEND_URL` is a full `https://...` URL
- `THE_ODDS_API_KEY` is set and non-empty

### Prisma CLI from local machine fails with `P1001`

If Prisma cannot reach a host that looks like `dpg-xxxxx`, you are probably using the Render internal database URL from outside Render.

Use the Render Postgres `External Database URL` when running Prisma locally:

```sh
DATABASE_URL="<External Database URL>" \
npx prisma migrate resolve --rolled-back 20260408120000_add_refresh_tokens_and_audit_log --schema prisma/schema.prisma
```

Then run:

```sh
DATABASE_URL="<External Database URL>" \
npx prisma migrate deploy --schema prisma/schema.prisma
```

Use the internal URL only inside the Render API service.

### Frontend builds but API calls fail

Check:

- `VITE_API_URL` includes `/api/v1`
- `FRONTEND_URL` on the API exactly matches the frontend origin
- The API service is healthy at `/api/v1/health/live`

### You do not have SMTP details yet

That is fine. Leave all `SMTP_*` variables unset for now.

### You do not have The Odds API key yet

This project expects `THE_ODDS_API_KEY` to be non-empty at startup.

For a temporary smoke deploy, you can set a placeholder non-empty value, but odds import and sync jobs will fail until you replace it with a real key.

## 7. Reference links

Render docs used for the manual setup:

- Docker on Render: https://render.com/docs/docker
- Static Sites: https://render.com/docs/static-sites
- Static Site Redirects and Rewrites: https://render.com/docs/redirects-rewrites
- Default Environment Variables: https://render.com/docs/environment-variables
- Render Postgres: https://render.com/docs/postgresql
