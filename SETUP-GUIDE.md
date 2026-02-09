# 🚀 Prediction Platform — Local Setup Guide

Everything you need to get the platform running on your machine and accessible from your phone.

---

## Step 1: Install Docker (one-time setup)

You're on Linux (Ubuntu), so this is straightforward. Open a terminal and run:

```bash
# Update packages
sudo apt update

# Install Docker
sudo apt install -y docker.io docker-compose-v2

# Add yourself to the docker group (so you don't need sudo every time)
sudo usermod -aG docker $USER

# IMPORTANT: Log out and log back in (or reboot) for the group change to take effect
# After logging back in, verify it works:
docker --version
docker compose version
```

If `docker compose version` doesn't work, try installing the plugin separately:
```bash
sudo apt install -y docker-compose-plugin
```

---

## Step 2: Clone your repo and add Docker files

```bash
# Clone your repo (if you haven't already)
git clone <your-repo-url>
cd <your-repo-folder>

# Copy the Docker files into your project root
# (You'll get these from the files I'm providing)
# Place these files in the project root:
#   - docker-compose.yml
#   - Dockerfile.api
#   - Dockerfile.frontend
#   - ngrok.yml
#   - .env
```

---

## Step 3: Configure environment

```bash
# Create your .env file
cp env.docker.example .env

# Edit it and add your Odds API key
nano .env
```

Add your Odds API key (the one you already have):
```
THE_ODDS_API_KEY=your_key_here
```

If you want to run the API locally without Docker, use `.env.example` instead (it includes `DATABASE_URL`, `JWT_SECRET`, etc.).

---

## Step 4: Start everything

```bash
# Build and start all services
docker compose up --build

# That's it! You'll see output from:
#   - PostgreSQL starting up
#   - Database migrations running
#   - Seed data loading
#   - API server starting on port 3000
#   - Frontend starting on port 5173
```

Once you see the startup banner, open your browser:

| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:5173 |
| **API** | http://localhost:3000/api/health |
| **Database** (Prisma Studio) | Run `docker compose exec api npx prisma studio` |

### Test accounts (pre-seeded):

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@example.com | Admin123! |
| User | test@example.com | Test123! |

---

## Step 5: Access from your phone (ngrok)

### 5a: Get a free ngrok account

1. Go to https://ngrok.com and sign up (free)
2. Go to https://dashboard.ngrok.com/get-started/your-authtoken
3. Copy your auth token

### 5b: Configure ngrok

Edit `ngrok.yml` in your project root and replace `YOUR_AUTH_TOKEN`:

```yaml
authtoken: abc123your_actual_token_here
```

### 5c: Uncomment ngrok in docker-compose.yml

Open `docker-compose.yml` and uncomment the ngrok service (remove the `#` from each line in the ngrok block).

### 5d: Update the frontend API URL

When using ngrok, the frontend needs to know the API's public URL. You have two options:

**Option A: Quick — tunnel the frontend only (recommended)**

If `VITE_API_URL` is set to `/api` (default in the provided docker-compose), you can tunnel
only the frontend and it will proxy `/api` to the backend automatically:

```bash
# Install ngrok
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok-v3-stable-linux-amd64.tgz | sudo tar xvz -C /usr/local/bin

# Authenticate
ngrok config add-authtoken YOUR_AUTH_TOKEN

# Start the platform first
docker compose up -d

# Then tunnel the frontend
ngrok http 5173
```

ngrok will give you a URL like `https://abc123.ngrok-free.app` — open that on your phone.

**Option B: Use an ngrok URL for the API**

If you want the browser to call the API directly (instead of proxying through the frontend),
set `VITE_API_URL` in `docker-compose.yml` to your API ngrok URL (e.g. `https://abc123.ngrok-free.app/api`)
and restart.

**Option C: Restart with Docker ngrok**

```bash
docker compose up --build
```

Then check the ngrok dashboard at http://localhost:4040 to see your public URLs.

### 5e: Open on your phone

Open the ngrok URL on your phone's browser. You'll get the full app experience — login, browse events, place predictions, cashout, everything.

---

## Useful Commands

```bash
# Start everything (background)
docker compose up -d

# View logs
docker compose logs -f          # all services
docker compose logs -f api      # just the API
docker compose logs -f frontend # just the frontend

# Stop everything
docker compose down

# Stop and wipe database (fresh start)
docker compose down -v

# Rebuild after code changes
docker compose up --build

# Open a shell in the API container
docker compose exec api sh

# Run Prisma Studio (database GUI)
docker compose exec api npx prisma studio

# Run database migration after schema changes
docker compose exec api npx prisma migrate dev

# Check API health
curl http://localhost:3000/api/health
```

---

## Troubleshooting

### "permission denied" when running docker
→ Did you log out and back in after `sudo usermod -aG docker $USER`?

### Database connection refused
→ Wait 10-15 seconds after `docker compose up` for PostgreSQL to fully start.

### Port already in use
→ Something else is using port 3000, 5173, or 5432. Either stop it or change the ports in `docker-compose.yml`.

### Frontend can't reach API
→ If you're using Docker, the recommended setting is `VITE_API_URL=/api` so the frontend can proxy to the API. If you set an absolute `VITE_API_URL` (e.g. `http://localhost:3000/api` or an ngrok API URL), ensure the API is reachable and CORS allows the frontend origin.

### Seed data not loading
→ Run manually: `docker compose exec api npx tsx prisma/seed.ts`

### ngrok says "auth token invalid"
→ Make sure you copied the full token from https://dashboard.ngrok.com/get-started/your-authtoken

---

## Quick Test Checklist

Once everything is running, verify the core flow:

1. ✅ Open http://localhost:5173
2. ✅ Register a new account (or login as test@example.com / Test123!)
3. ✅ Check your token balance (should be 5)
4. ✅ Browse events (if Odds API key is set, events should sync)
5. ✅ Place a prediction on an event
6. ✅ Check your tokens decreased
7. ✅ Try the cashout flow on your prediction
8. ✅ Check the rewards page

If all 8 pass, you're running a fully functional prediction platform. 🎯
