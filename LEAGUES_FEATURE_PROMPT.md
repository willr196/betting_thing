# Prediction Platform — Private Leagues Feature

Use this prompt in a Claude conversation or Claude Code session with full repo access. This adds private leagues where users invite friends, compete on points earned from predictions, and see weekly/all-time standings that update on settlement worker ticks (eventually consistent, not real-time).

---

## Context

**prediction-platform** — TypeScript/Express/Prisma/PostgreSQL backend, React/Vite/Tailwind frontend. Railway + Vercel. Existing features: predictions with live odds, cashout, dual-currency ledger (tokens for staking, points for winnings), rewards shop.

**Hard constraints:** Ledger-first, append-only. Free-entry only. Atomic balance ops with `FOR UPDATE`. Every schema change needs a migration.

**Key design principle for leagues:** Leagues don't change how predictions or points work. They're a **view layer** on top of existing data — points earned from predictions are the scoring mechanism. No separate league-specific currency or staking. A user's league score for a given period = total points earned from settled predictions during that period.

---

## 1. Schema

```prisma
// =============================================================================
// LEAGUES
// =============================================================================

model League {
  id          String   @id @default(cuid())
  
  name        String   @db.VarChar(50)
  description String?  @db.VarChar(200)
  
  // The user who created the league
  ownerId     String
  owner       User     @relation("ownedLeagues", fields: [ownerId], references: [id])
  
  // Unique 8-char invite code (uppercase alphanumeric, no ambiguous chars)
  // e.g. "ABCD1234" — no 0/O, 1/I/L to avoid confusion
  inviteCode  String   @unique @db.VarChar(8)
  
  // Is the league accepting new members?
  isOpen      Boolean  @default(true)
  
  // Max members (hard cap to prevent abuse)
  maxMembers  Int      @default(50)
  
  // League avatar/emoji
  emoji       String   @default("⚽")
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  members     LeagueMembership[]
  standings   LeagueStanding[]
  
  @@index([inviteCode])
  @@index([ownerId])
}

model LeagueMembership {
  id        String   @id @default(cuid())
  
  leagueId  String
  league    League   @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  
  role      LeagueRole @default(MEMBER)
  
  // Active membership window used for league scoring windows
  joinedAt  DateTime @default(now())
  leftAt    DateTime?
  isActive  Boolean  @default(true)
  
  @@unique([leagueId, userId])  // Can't join same league twice
  @@index([userId])
  @@index([leagueId])
  @@index([leagueId, isActive])
}

enum LeagueRole {
  OWNER
  MEMBER
}

// Denormalized standings — updated by settlement-triggered recalculation and daily backfill.
// Each row = one user's score for one period in one league.
model LeagueStanding {
  id          String   @id @default(cuid())
  
  leagueId    String
  league      League   @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  
  // Period tracking
  period      LeaguePeriod
  periodKey   String    // "2026-W10" for weekly, "all-time" for all-time
  
  // Scoring — all derived from PointsTransaction data
  pointsEarned   Int   @default(0)  // Total points won from predictions in this period
  predictionsWon Int   @default(0)
  predictionsLost Int  @default(0)
  totalPredictions Int @default(0)
  
  // Rank within this league for this period (1 = first place)
  rank        Int      @default(0)
  
  updatedAt   DateTime @updatedAt
  
  @@unique([leagueId, userId, period, periodKey])
  @@index([leagueId, period, periodKey, rank])
  @@index([userId])
}

enum LeaguePeriod {
  WEEKLY
  ALL_TIME
}
```

**User model additions:**
```prisma
// Add to User model relations:
ownedLeagues     League[]           @relation("ownedLeagues")
leagueMemberships LeagueMembership[]
leagueStandings  LeagueStanding[]
```

Generate the migration: `npx prisma migrate dev --name add-leagues`

---

## 2. Backend — `LeagueService` (`src/services/leagues.ts`)

### 2.1 League Management

**`create(userId, data: { name, description?, emoji? })`**
- Generate a unique 8-char invite code using charset `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L).
- Retry up to 5 times if code already exists (collision unlikely but handle it).
- Create the league and a `LeagueMembership` for the creator with role `OWNER`.
- Create initial `LeagueStanding` entries for the owner (current week + all-time).
- Limit: a user can own at most 5 leagues (prevent abuse).
- Limit: a user can be a member of at most 20 leagues total.

**`join(userId, inviteCode)`**
- Normalise invite code to uppercase, trim whitespace.
- Find league by invite code.
- Validate: league `isOpen`, not at `maxMembers` (count only active members), user is not already an active member.
- Run member-count check + join/reactivation inside a transaction with `FOR UPDATE` on the league row.
- If an inactive membership row exists, reactivate it (`isActive=true`, `leftAt=null`, `joinedAt=now`, `role=MEMBER`).
- Otherwise create `LeagueMembership` with role `MEMBER`.
- Create initial `LeagueStanding` entries for the user.
- Return the league details.

**`leave(userId, leagueId)`**
- Can't leave if you're the owner (must transfer ownership or delete the league).
- Mark membership inactive (`isActive=false`, `leftAt=now`) instead of deleting rows.
- Keep existing standings rows for historical weeks.

**`delete(userId, leagueId)`**
- Only the owner can delete.
- Cascade deletes memberships and standings (handled by Prisma `onDelete: Cascade`).

**`transferOwnership(userId, leagueId, newOwnerId)`**
- Current owner transfers to another member.
- Update the old owner's role to MEMBER, new owner's role to OWNER, and league `ownerId`.

**`update(userId, leagueId, data: { name?, description?, emoji?, isOpen? })`**
- Only the owner can update.

**`kickMember(userId, leagueId, targetUserId)`**
- Only the owner can kick.
- Can't kick yourself.
- Mark target membership inactive (`isActive=false`, `leftAt=now`), keep standings history.

**`regenerateInviteCode(userId, leagueId)`**
- Only the owner can regenerate.
- Generate new code, invalidating the old one.

### 2.2 League Queries

**`getById(leagueId, userId)`**
- Return league details with active member count.
- Only accessible if user has an active membership.

**`getMyLeagues(userId)`**
- Return all leagues the user is actively a member of, with their rank in the current week.

**`getMembers(leagueId, userId)`**
- Return active members with display info (displayName, fallback anonymized email, join date, role).
- Only accessible if user has an active membership.

**`getStandings(leagueId, userId, period, periodKey?)`**
- Return standings for a league, ordered by rank.
- If no `periodKey` provided, use current week key for `WEEKLY`, and `all-time` for `ALL_TIME`.
- Include the requesting user's position.
- Only accessible if user has an active membership.

### 2.3 Standings Calculation — `LeagueStandingsService`

**`recalculateAll()`** — Full backfill job. Run daily as a safety net, and callable by admin.

Logic:
1. Get all leagues with active members.
2. For each league, for each member:
   - **Weekly score**: Query `PointsTransaction` where `userId = member.userId`, `type IN ('PREDICTION_WIN', 'CASHOUT')`, and `createdAt` is between `max(weekStartUtc, member.joinedAt)` and `weekEndUtc`. Sum `amount`.
   - **All-time score**: Same query with lower bound `createdAt >= member.joinedAt` (league participation lifetime, not global account lifetime).
   - Count predictions won/lost from `Prediction` for the same membership window using `settledAt`.
3. Upsert `LeagueStanding` rows with calculated values.
4. Calculate ranks per league per period (order by `pointsEarned` DESC, then `predictionsWon` DESC, then `totalPredictions` ASC, then `userId` ASC for deterministic ties).
5. Update `rank` on each standing row.

**`recalculateLeague(leagueId)`** — Recalculate standings for a single league (useful after a member joins/leaves).
**`recalculateForUsers(userIds)`** — Resolve active league IDs for affected users, then recalculate only those leagues.

**Scheduling:**
In `src/index.ts`, add a daily interval (or use the existing settlement worker tick):
```typescript
// Run standings recalculation daily at midnight UTC
// Or piggyback on the settlement interval — after each settlement run,
// check if it's a new day and recalculate if so.
```

A simpler approach: recalculate for affected users on every settlement worker tick. With small leagues this is negligible. Add a `lastRecalculatedAt` guard if needed to avoid redundant full recalculations.

**Important**: The standings are eventually consistent. They update at most once per settlement tick (every 15 minutes by default), not in real-time. This is fine — users see "updated X minutes ago" on the standings page.

### 2.4 Invite Code Sharing

**`getInviteLink(leagueId, userId)`**
- Only users with active membership can get the invite link.
- Return: `{ inviteCode: "ABCD1234", inviteUrl: "${FRONTEND_URL}/leagues/join?code=ABCD1234" }`

The frontend should handle the `/leagues/join?code=X` route — if logged in, auto-join. If not, redirect to register then join.

---

## 3. API Routes — `src/routes/leagues.ts`

```
POST   /api/v1/leagues                         — Create league
GET    /api/v1/leagues                         — List my leagues
GET    /api/v1/leagues/:id                     — Get league details
PATCH  /api/v1/leagues/:id                     — Update league (owner)
DELETE /api/v1/leagues/:id                     — Delete league (owner)

POST   /api/v1/leagues/join                    — Join via invite code { inviteCode }
POST   /api/v1/leagues/:id/leave               — Leave league
POST   /api/v1/leagues/:id/kick/:userId        — Kick member (owner)
POST   /api/v1/leagues/:id/transfer/:userId    — Transfer ownership (owner)
POST   /api/v1/leagues/:id/regenerate-code     — New invite code (owner)

GET    /api/v1/leagues/:id/members             — List members
GET    /api/v1/leagues/:id/standings            — Get standings
         ?period=weekly|all-time
         ?periodKey=2026-W10                    — Specific week key (optional)

GET    /api/v1/leagues/:id/invite              — Get invite code/link
```

All endpoints require `requireAuth`. All league-specific endpoints should verify active membership (except join).

Register in `src/routes/index.ts`:
```typescript
import leagueRoutes from './leagues.js';
router.use('/leagues', leagueRoutes);
```

Validation schemas (Zod):
```typescript
const createLeagueSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(200).optional(),
  emoji: z.string().max(4).optional(),
});

const joinLeagueSchema = z.object({
  inviteCode: z
    .string()
    .transform(v => v.toUpperCase().trim())
    .refine(v => /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(v), 'Invalid invite code'),
});

const updateLeagueSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  description: z.string().max(200).optional(),
  emoji: z.string().max(4).optional(),
  isOpen: z.boolean().optional(),
});
```

---

## 4. Frontend

### 4.1 Leagues Page (`/leagues`)

**My Leagues list:**
- Card per league showing: emoji, name, member count, your current rank this week, points this week.
- "Create League" button.
- "Join League" button (opens a modal with invite code input).
- Each card links to the league detail page.

**Create League modal/form:**
- Name input (required, 2-50 chars).
- Description input (optional).
- Emoji picker (grid of ~20 sport/fun emojis: ⚽🏆🎯🔥💎👑🦁🐉🎪🏟️🎮🎲🃏⭐💪🧠🏅🥇🎉🤝).
- Creates the league and shows the invite code immediately with a "Copy" button and share options.

**Join League flow:**
- Input field for invite code.
- Handle `/leagues/join?code=X` URL param — if user navigates here with a code, auto-fill and prompt to join.
- On success, navigate to the league detail page.

### 4.2 League Detail Page (`/leagues/:id`)

**Header:**
- League emoji + name + description.
- Member count.
- Invite code with copy button (only visible to members).
- Settings icon (only for owner) → links to league settings.

**Standings table (main content):**
- Tab switcher: "This Week" | "All Time"
- Table columns: Rank | User | Points | W | L | Predictions | Win Rate
- Highlight the current user's row.
- Show "Updated X minutes ago" timestamp.
- For "This Week" tab, show which ISO week it is and the date range (e.g. "Week 10: Mar 2 – Mar 8").
- Previous weeks dropdown/navigation: "← Previous Week" to view historical standings.

**Members section (collapsible):**
- List of members with role badge (Owner/Member), join date.
- Owner sees kick buttons next to members.

### 4.3 League Settings Page (`/leagues/:id/settings`) — Owner Only

- Edit name, description, emoji.
- Toggle open/closed (stop accepting new members).
- Regenerate invite code (with confirmation: "This will invalidate the current code").
- Transfer ownership (dropdown of current members).
- Delete league (with confirmation: "This will permanently delete the league and all standings").

### 4.4 Navigation Updates

- Add "Leagues" to the main nav bar (between Predictions and Rewards).
- Show a badge with the number of leagues if > 0.

### 4.5 Invite Link Deep Linking

Handle the flow when someone receives an invite link:
- `/leagues/join?code=ABCD1234`
- If authenticated → show league preview (name, emoji, member count) with "Join" button.
- If not authenticated → redirect to `/register?redirect=/leagues/join?code=ABCD1234`. After registration, auto-redirect back and join.

Update `PublicRoute` and `ProtectedRoute` in `App.tsx` to handle redirect query params.

---

## 5. Standings Recalculation Integration

### 5.1 Hook into Settlement

In `EventService.settle()`, after all predictions are processed, trigger a standings recalculation for affected leagues:

```typescript
// After settlement transaction completes:
const affectedUserIds = event.predictions.map(p => p.userId);
// Get leagues these users belong to
// Recalculate standings for those leagues only
await LeagueStandingsService.recalculateForUsers(affectedUserIds);
```

This keeps standings fresh without a separate cron job. The settlement worker runs on the configured interval (15 minutes by default), so standings are eventually consistent and typically <= one worker interval stale.

### 5.2 Fallback Daily Recalculation

As a safety net, also run a full recalculation once per day. In `src/index.ts`:

```typescript
// Daily standings recalculation — runs at midnight UTC
let lastFullRecalc = new Date(0);
const RECALC_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

// Inside the settlement worker interval:
if (Date.now() - lastFullRecalc.getTime() > RECALC_INTERVAL) {
  await LeagueStandingsService.recalculateAll();
  lastFullRecalc = new Date();
}
```

### 5.3 Admin Endpoint

```
POST /api/v1/admin/leagues/recalculate — Force recalculate all league standings
```

---

## 6. Week Number Utility

Add a helper for ISO week calculations:

```typescript
// src/utils/week.ts

export function getISOWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

export function getWeekDateRange(weekKey: string): { start: Date; end: Date } {
  const [yearStr, weekStr] = weekKey.split('-W');
  const year = parseInt(yearStr);
  const week = parseInt(weekStr);
  
  // ISO week 1 contains January 4th
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // Monday = 1
  const monday = new Date(jan4.getTime());
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  
  const sunday = new Date(monday.getTime());
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  
  return { start: monday, end: sunday };
}

export function getPreviousWeekKey(weekKey: string): string {
  const { start } = getWeekDateRange(weekKey);
  const prevWeek = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
  return getISOWeekKey(prevWeek);
}
```

---

## 7. Edge Cases to Handle

- **User joins mid-week**: Weekly score starts at `joinedAt` (`max(weekStart, joinedAt)`), so they do not get pre-join points.
- **User leaves a league**: Membership becomes inactive; they no longer appear in members/current standings, but historical standings remain.
- **User rejoins after leaving**: Membership reactivates with a new `joinedAt`, so weekly/all-time league scoring restarts from rejoin time.
- **Owner leaves**: Must transfer ownership first, or delete the league.
- **League with 1 member**: Fine — they're rank 1. Standings still work.
- **No predictions in a week**: All members show 0 points. Rank follows deterministic tie-break (`userId` ASC after other tie fields).
- **Concurrent joins**: The `@@unique([leagueId, userId])` constraint prevents double-joining. The member count check should be inside a transaction to prevent exceeding `maxMembers`.

---

## 8. Important Rules

- **Generate the Prisma migration** before anything else.
- **Standings are derived data** — they can always be recalculated from `PointsTransaction` + `Prediction` tables. If something goes wrong, just recalculate.
- **Leagues don't affect the ledger** — no league-specific tokens or points. Leagues are purely a social/comparison layer.
- **Keep invite codes simple** — 8 uppercase alphanumeric chars, easy to read aloud or type on mobile.
- **Member caps matter** — without them, someone could create a league and scrape all user data via the members endpoint.
- **Run `npm run typecheck`** after every change.
- **Run `npm run build`** before committing.
