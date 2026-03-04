# Prediction Platform — Bet Slip & Accumulators

Use this prompt in a Claude conversation or Claude Code session with full repo access.

---

## Context

**betting_thing** — TypeScript/Express/Prisma/PostgreSQL backend, React/Vite/Tailwind frontend. Railway + Vercel. Existing prediction system allows one prediction per event per user. We're replacing that restriction with a fully flexible bet slip system.

**Hard constraints:** Ledger-first, append-only. Free-entry only. Atomic balance ops with `FOR UPDATE`. Every schema change needs a migration.

---

## Core Design Principles

1. **The bet slip is a shopping cart.** Users browse events, add selections to a persistent slip, and submit when ready.
2. **No restrictions on selections.** A user can:
   - Pick the same event multiple times (even the same outcome) across different slip submissions.
   - Pick opposing outcomes on the same event (e.g. Man City to win AND Draw on separate submissions).
   - Place the same selection as both a single and part of an accumulator.
3. **Each slip submission is independent.** Like walking up to the counter at a bookies — every slip is a fresh bet.
4. **Singles and accumulators from the same slip.** The slip shows checkboxes next to each selection for singles, plus an "Accumulator" toggle at the bottom that combines all selections with multiplied odds.
5. **Tokens are the only constraint.** If you have the tokens, you can place the bet.

---

## Part 1: Schema Changes

### 1.1 Remove the Unique Constraint

The current schema has `@@unique([userId, eventId])` on the `Prediction` model. **Remove this.** Users must be able to place multiple predictions on the same event.

```prisma
// REMOVE this line from the Prediction model:
// @@unique([userId, eventId])
```

Keep the individual indexes `@@index([userId])` and `@@index([eventId])` — those are still useful for queries.

### 1.2 Add Accumulator Models

```prisma
// =============================================================================
// ACCUMULATOR
// =============================================================================
// A combined bet where all selections must win for the payout.
// Odds are multiplied together. One stake covers the whole slip.

model Accumulator {
  id            String            @id @default(cuid())
  
  userId        String
  user          User              @relation(fields: [userId], references: [id])
  
  stakeAmount   Int               // Tokens staked
  combinedOdds  Decimal           @db.Decimal(10, 4)  // Product of all leg odds
  potentialPayout Int             // stakeAmount * combinedOdds (floored)
  
  status        AccumulatorStatus @default(PENDING)
  payout        Int?              // Actual points paid out (only if WON)
  
  settledAt     DateTime?
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
  
  legs          AccumulatorLeg[]
  
  @@index([userId, status])
  @@index([status])
  @@index([userId, createdAt])
}

model AccumulatorLeg {
  id               String           @id @default(cuid())
  
  accumulatorId    String
  accumulator      Accumulator      @relation(fields: [accumulatorId], references: [id], onDelete: Cascade)
  
  eventId          String
  event            Event            @relation(fields: [eventId], references: [id])
  
  predictedOutcome String
  odds             Decimal          @db.Decimal(10, 4)  // Odds at time of placement
  
  status           PredictionStatus @default(PENDING)
  settledAt        DateTime?
  
  createdAt        DateTime         @default(now())
  
  @@index([accumulatorId])
  @@index([eventId, status])
}

enum AccumulatorStatus {
  PENDING     // All legs still open or some settled but none lost
  WON         // Every single leg won
  LOST        // At least one leg lost
  CANCELLED   // Refunded (e.g. all legs cancelled)
  CASHED_OUT  // User cashed out early (future feature)
}
```

### 1.3 Add Relations

```prisma
// Add to User model:
accumulators  Accumulator[]

// Add to Event model:
accumulatorLegs  AccumulatorLeg[]
```

### 1.4 Generate Migration

```bash
npx prisma migrate dev --name add-accumulators-remove-unique-constraint
```

**Important:** Removing the unique constraint is a data migration. Prisma should handle it, but verify in the generated SQL that it drops the unique index.

---

## Part 2: Backend Changes

### 2.1 Update `PredictionService.place()` — Remove Duplicate Check

In `src/services/predictions.ts`, the `place()` method currently checks for an existing prediction and throws `ALREADY_PREDICTED`. **Remove this check entirely:**

```typescript
// DELETE this block from inside the $transaction:
const existingPrediction = await tx.prediction.findUnique({
  where: {
    userId_eventId: { userId, eventId },
  },
});

if (existingPrediction) {
  throw new AppError(
    'ALREADY_PREDICTED',
    'You have already placed a prediction on this event',
    409
  );
}
```

Also remove the `findUnique` with the composite key since that index no longer exists. If the code uses `prediction.findUnique({ where: { userId_eventId: ... } })` anywhere else, those need to be updated to `findFirst` with a `where: { userId, eventId }` filter (or removed if they're part of the duplicate check).

Search the entire codebase for `userId_eventId` and update/remove all references.

### 2.2 Create `AccumulatorService` (`src/services/accumulators.ts`)

```typescript
import { Prisma, AccumulatorStatus } from '@prisma/client';
import { prisma } from './database.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/index.js';
import { TokenAllowanceService } from './tokenAllowance.js';
import { PointsLedgerService } from './pointsLedger.js';

// Max legs in one accumulator
const MAX_LEGS = 10;
// Max combined odds (prevent absurd payouts)
const MAX_COMBINED_ODDS = 5000;

export const AccumulatorService = {
  /**
   * Place an accumulator bet.
   * 
   * @param userId - The user placing the bet
   * @param legs - Array of { eventId, predictedOutcome } selections
   * @param stakeAmount - Tokens to stake
   * 
   * No restrictions on:
   * - Picking the same event multiple times
   * - Picking opposing outcomes
   * - Having existing predictions on these events
   */
  async place(data: {
    userId: string;
    legs: Array<{ eventId: string; predictedOutcome: string }>;
    stakeAmount: number;
  }) {
    const { userId, legs, stakeAmount } = data;

    // --- Validation ---

    if (legs.length < 2) {
      throw AppError.badRequest('Accumulator must have at least 2 selections');
    }

    if (legs.length > MAX_LEGS) {
      throw AppError.badRequest(`Accumulator can have at most ${MAX_LEGS} selections`);
    }

    if (stakeAmount < config.tokens.minStake) {
      throw AppError.badRequest(`Minimum stake is ${config.tokens.minStake} tokens`);
    }

    if (stakeAmount > config.tokens.maxStake) {
      throw AppError.badRequest(`Maximum stake is ${config.tokens.maxStake} tokens`);
    }

    // --- Pre-fetch events and odds (outside transaction) ---

    const eventIds = [...new Set(legs.map(l => l.eventId))];
    const events = await prisma.event.findMany({
      where: { id: { in: eventIds } },
    });

    const eventsById = new Map(events.map(e => [e.id, e]));

    // Validate each leg and collect odds
    const legsWithOdds: Array<{
      eventId: string;
      predictedOutcome: string;
      odds: number;
    }> = [];

    for (const leg of legs) {
      const event = eventsById.get(leg.eventId);
      if (!event) {
        throw AppError.notFound(`Event ${leg.eventId}`);
      }

      if (event.status !== 'OPEN') {
        throw new AppError('EVENT_NOT_OPEN', `Event "${event.title}" is ${event.status}`, 400);
      }

      if (new Date(event.startsAt).getTime() <= Date.now()) {
        throw new AppError('EVENT_ALREADY_STARTED', `Event "${event.title}" has already started`, 400);
      }

      if (!event.outcomes.includes(leg.predictedOutcome)) {
        throw new AppError('INVALID_OUTCOME', 
          `"${leg.predictedOutcome}" is not a valid outcome for "${event.title}"`, 400);
      }

      // Get odds from cached event data
      let odds = event.payoutMultiplier; // Default fallback

      if (event.currentOdds) {
        const oddsData = event.currentOdds as { outcomes?: Array<{ name: string; price: number }> };
        const outcomeOdds = oddsData.outcomes?.find(
          o => o.name.trim().toLowerCase() === leg.predictedOutcome.trim().toLowerCase()
        );
        if (outcomeOdds) {
          odds = outcomeOdds.price;
        }
      }

      legsWithOdds.push({
        eventId: leg.eventId,
        predictedOutcome: leg.predictedOutcome,
        odds,
      });
    }

    // Calculate combined odds
    let combinedOdds = legsWithOdds.reduce((acc, leg) => acc * leg.odds, 1);
    combinedOdds = Math.min(combinedOdds, MAX_COMBINED_ODDS);

    const potentialPayout = Math.floor(stakeAmount * combinedOdds);

    // --- Atomic placement ---

    const accumulator = await prisma.$transaction(async (tx) => {
      // Re-verify all events are still open (with locks)
      for (const eventId of eventIds) {
        const [lockedEvent] = await tx.$queryRaw<
          Array<{ id: string; status: string; startsAt: Date }>
        >`SELECT "id", "status", "startsAt" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;

        if (!lockedEvent || lockedEvent.status !== 'OPEN') {
          throw new AppError('EVENT_NOT_OPEN', 'One or more events are no longer open', 400);
        }

        if (new Date(lockedEvent.startsAt).getTime() <= Date.now()) {
          throw new AppError('EVENT_ALREADY_STARTED', 'One or more events have already started', 400);
        }
      }

      // Create the accumulator
      const newAccumulator = await tx.accumulator.create({
        data: {
          userId,
          stakeAmount,
          combinedOdds: new Prisma.Decimal(combinedOdds),
          potentialPayout,
          status: 'PENDING',
          legs: {
            create: legsWithOdds.map(leg => ({
              eventId: leg.eventId,
              predictedOutcome: leg.predictedOutcome,
              odds: new Prisma.Decimal(leg.odds),
            })),
          },
        },
        include: { legs: { include: { event: true } } },
      });

      // Debit tokens
      await TokenAllowanceService.consumeTokens(
        userId, stakeAmount, newAccumulator.id, tx
      );

      return newAccumulator;
    });

    return accumulator;
  },

  /**
   * Get user's accumulators.
   */
  async getByUser(
    userId: string,
    options: { status?: AccumulatorStatus; limit?: number; offset?: number } = {}
  ) {
    const { status, limit = 20, offset = 0 } = options;

    const where: Prisma.AccumulatorWhereInput = { userId };
    if (status) where.status = status;

    const [accumulators, total] = await Promise.all([
      prisma.accumulator.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { legs: { include: { event: true } } },
      }),
      prisma.accumulator.count({ where }),
    ]);

    return { accumulators, total };
  },

  /**
   * Get a single accumulator by ID.
   */
  async getById(accumulatorId: string, userId?: string) {
    const accumulator = await prisma.accumulator.findUnique({
      where: { id: accumulatorId },
      include: { legs: { include: { event: true } } },
    });

    if (!accumulator) throw AppError.notFound('Accumulator');
    if (userId && accumulator.userId !== userId) {
      throw AppError.forbidden('You can only view your own accumulators');
    }

    return accumulator;
  },

  /**
   * Settle accumulator legs for a given event.
   * Called from EventService.settle() after individual predictions are settled.
   */
  async settleLegsForEvent(eventId: string, finalOutcome: string, tx: Prisma.TransactionClient) {
    // Find all pending legs for this event
    const legs = await tx.accumulatorLeg.findMany({
      where: { eventId, status: 'PENDING' },
      include: { accumulator: true },
    });

    const affectedAccumulatorIds = new Set<string>();

    for (const leg of legs) {
      const isWin = leg.predictedOutcome.trim().toLowerCase() === finalOutcome.trim().toLowerCase();

      await tx.accumulatorLeg.update({
        where: { id: leg.id },
        data: {
          status: isWin ? 'WON' : 'LOST',
          settledAt: new Date(),
        },
      });

      affectedAccumulatorIds.add(leg.accumulatorId);
    }

    // Now check each affected accumulator
    for (const accId of affectedAccumulatorIds) {
      const acc = await tx.accumulator.findUnique({
        where: { id: accId },
        include: { legs: true },
      });

      if (!acc || acc.status !== 'PENDING') continue;

      const allLegs = acc.legs;
      const hasLoss = allLegs.some(l => l.status === 'LOST');
      const allSettled = allLegs.every(l => l.status !== 'PENDING');
      const allWon = allSettled && allLegs.every(l => l.status === 'WON');

      if (hasLoss) {
        // Accumulator is lost as soon as any leg loses
        await tx.accumulator.update({
          where: { id: accId },
          data: { status: 'LOST', payout: 0, settledAt: new Date() },
        });
      } else if (allWon) {
        // All legs won — pay out!
        const payout = acc.potentialPayout;

        await PointsLedgerService.credit(
          {
            userId: acc.userId,
            amount: payout,
            type: 'PREDICTION_WIN',
            referenceType: 'ACCUMULATOR',
            referenceId: accId,
            description: `Accumulator win (${allLegs.length} legs, ${acc.combinedOdds}x odds)`,
          },
          tx
        );

        await tx.accumulator.update({
          where: { id: accId },
          data: { status: 'WON', payout, settledAt: new Date() },
        });
      }
      // If some legs settled but none lost and not all settled yet,
      // accumulator stays PENDING — nothing to do.
    }
  },

  /**
   * Cancel accumulator legs for a cancelled event.
   * Called from EventService.cancel().
   */
  async cancelLegsForEvent(eventId: string, tx: Prisma.TransactionClient) {
    const legs = await tx.accumulatorLeg.findMany({
      where: { eventId, status: 'PENDING' },
      include: { accumulator: { include: { legs: true } } },
    });

    const processedAccumulators = new Set<string>();

    for (const leg of legs) {
      if (processedAccumulators.has(leg.accumulatorId)) continue;
      processedAccumulators.add(leg.accumulatorId);

      const acc = leg.accumulator;
      if (acc.status !== 'PENDING') continue;

      const otherLegs = acc.legs.filter(l => l.eventId !== eventId);
      const cancelledLegsCount = acc.legs.filter(l => l.eventId === eventId).length;

      // Mark cancelled legs
      await tx.accumulatorLeg.updateMany({
        where: { accumulatorId: acc.id, eventId, status: 'PENDING' },
        data: { status: 'REFUNDED', settledAt: new Date() },
      });

      if (otherLegs.length === 0) {
        // All legs cancelled — full refund
        const { LedgerService } = await import('./ledger.js');
        await LedgerService.credit(
          {
            userId: acc.userId,
            amount: acc.stakeAmount,
            type: 'PREDICTION_REFUND',
            referenceType: 'ACCUMULATOR',
            referenceId: acc.id,
            description: `Accumulator refund (all events cancelled)`,
          },
          tx
        );

        await tx.accumulator.update({
          where: { id: acc.id },
          data: { status: 'CANCELLED', settledAt: new Date() },
        });
      } else if (otherLegs.length === 1) {
        // Only 1 leg left — could keep as accumulator with reduced odds,
        // or convert to a virtual single. Keep it as-is with recalculated odds.
        const remainingOdds = otherLegs.reduce(
          (acc, l) => acc * l.odds.toNumber(), 1
        );
        const newPayout = Math.floor(acc.stakeAmount * remainingOdds);

        await tx.accumulator.update({
          where: { id: acc.id },
          data: {
            combinedOdds: new Prisma.Decimal(remainingOdds),
            potentialPayout: newPayout,
          },
        });
      } else {
        // Multiple legs remain — recalculate odds without cancelled legs
        const remainingOdds = otherLegs.reduce(
          (acc, l) => acc * l.odds.toNumber(), 1
        );
        const newPayout = Math.floor(acc.stakeAmount * remainingOdds);

        await tx.accumulator.update({
          where: { id: acc.id },
          data: {
            combinedOdds: new Prisma.Decimal(remainingOdds),
            potentialPayout: newPayout,
          },
        });
      }
    }
  },
};
```

### 2.3 Hook into Settlement and Cancellation

**In `EventService.settle()`**, after the loop that processes individual predictions, add:

```typescript
// After the prediction settlement loop, inside the same transaction:
await AccumulatorService.settleLegsForEvent(eventId, finalOutcome, tx);
```

**In `EventService.cancel()`**, inside the transaction:

```typescript
// After refunding individual predictions:
await AccumulatorService.cancelLegsForEvent(eventId, tx);
```

### 2.4 API Routes (`src/routes/accumulators.ts`)

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { AccumulatorService } from '../services/accumulators.js';
import { requireAuth, validateBody, validateParams, getAuthUser, idParamSchema } from '../middleware/index.js';
import { sendSuccess } from '../utils/index.js';

const router = Router();

const placeAccumulatorSchema = z.object({
  legs: z.array(z.object({
    eventId: z.string().min(1),
    predictedOutcome: z.string().min(1),
  })).min(2).max(10),
  stakeAmount: z.number().int().min(1).max(35),
});

// Place accumulator
router.post('/', requireAuth, validateBody(placeAccumulatorSchema), async (req, res, next) => {
  try {
    const { userId } = getAuthUser(req);
    const accumulator = await AccumulatorService.place({
      userId,
      legs: req.body.legs,
      stakeAmount: req.body.stakeAmount,
    });
    sendSuccess(res, { accumulator }, 201);
  } catch (error) {
    next(error);
  }
});

// List my accumulators
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { userId } = getAuthUser(req);
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await AccumulatorService.getByUser(userId, { status: status as any, limit, offset });
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
});

// Get accumulator by ID
router.get('/:id', requireAuth, validateParams(idParamSchema), async (req, res, next) => {
  try {
    const { userId } = getAuthUser(req);
    const accumulator = await AccumulatorService.getById(req.params.id, userId);
    sendSuccess(res, { accumulator });
  } catch (error) {
    next(error);
  }
});

export default router;
```

Register in `src/routes/index.ts`:
```typescript
import accumulatorRoutes from './accumulators.js';
router.use('/accumulators', accumulatorRoutes);
```

---

## Part 3: Frontend — Bet Slip

This is the most important UX piece. The bet slip is a persistent component that floats across all pages.

### 3.1 Bet Slip State (`frontend/src/context/BetSlipContext.tsx`)

```typescript
// State shape:
interface BetSlipSelection {
  id: string;           // Unique ID for this selection (use crypto.randomUUID() or a counter)
  eventId: string;
  eventTitle: string;
  predictedOutcome: string;
  odds: number;
  placeSingle: boolean; // Checkbox: place as individual single bet
}

interface BetSlipState {
  selections: BetSlipSelection[];
  accumulatorEnabled: boolean;  // Toggle: place all as an accumulator too
  singleStake: number;          // Default stake for singles (applied to each)
  accumulatorStake: number;     // Stake for the accumulator
}
```

The context should provide:
- `addSelection(eventId, eventTitle, predictedOutcome, odds)` — adds to the slip. Does NOT check for duplicates. Every add creates a new entry.
- `removeSelection(id)` — removes by the selection's unique ID.
- `clearSlip()` — empties the slip.
- `toggleSingle(id)` — toggle whether a selection is placed as a single.
- `toggleAccumulator()` — toggle accumulator on/off.
- `setSingleStake(amount)` / `setAccumulatorStake(amount)` — update stakes.
- `submitSlip()` — places all selected singles + accumulator (if enabled). Calls the API.
- `selections`, `accumulatorEnabled`, `combinedOdds`, `totalCost` — derived state.

**`combinedOdds`** = product of all selection odds (regardless of single toggles — the accumulator uses all selections).

**`totalCost`** = sum of (singleStake for each selection where `placeSingle` is true) + (accumulatorStake if `accumulatorEnabled` is true). This is the total tokens that will be deducted.

**Persistence:** Store the slip in React state (don't use localStorage). It resets on page refresh, which is fine — it's a session-level thing.

### 3.2 Bet Slip Component (`frontend/src/components/BetSlip.tsx`)

A slide-out drawer from the right side (or bottom sheet on mobile):

**Collapsed state (always visible when slip has items):**
- Floating button at bottom-right: "Bet Slip (3)" with selection count.
- Clicking it opens the drawer.

**Expanded state:**
- Header: "Bet Slip" with selection count and "Clear All" button.
- List of selections, each showing:
  - Event title (truncated)
  - Predicted outcome + odds
  - Checkbox: "Single" (checked = place as individual bet)
  - Remove button (X)
- Stake input for singles: "Stake per single: [5]" (only shown if any singles are checked)
- Divider
- Accumulator section:
  - Toggle/checkbox: "Place as Accumulator"
  - Combined odds display (e.g. "Combined odds: 12.50x")
  - Potential payout display
  - Accumulator stake input: "Accumulator stake: [5]"
- Total cost summary: "Total: 20 tokens" (sum of all singles + accumulator)
- "Place Bets" button (disabled if total cost > user's balance)
- Balance display: "Your balance: 5 tokens"

**Submission flow:**
1. For each selection where `placeSingle` is true: call `POST /api/v1/predictions` with that event/outcome/stake.
2. If `accumulatorEnabled` is true and there are 2+ selections: call `POST /api/v1/accumulators` with all selections and the accumulator stake.
3. All calls can happen in parallel (they're independent).
4. On success: clear the slip, show a success toast, refresh user balance.
5. On partial failure: show which bets succeeded and which failed. Don't clear successful ones from the slip.

### 3.3 Event Detail Page Changes

Replace the current "Place Prediction" button with an "Add to Slip" button:

**Current flow:**
- Select outcome → set stake → "Place Prediction" → API call → done.

**New flow:**
- Select outcome → "Add to Slip" button → selection appears in bet slip.
- The "Place Prediction" button stays as well for quick single bets (one-click convenience).
- So the event detail page has TWO actions per outcome:
  - "Add to Slip" — adds to the bet slip for later
  - "Quick Bet" or just keep the existing "Place Prediction" flow for single immediate bets

Actually, simpler approach: just have "Add to Slip" as the primary action. The bet slip handles everything — singles AND accumulators. Remove the inline prediction form from the event detail page. The flow becomes:

1. Browse events
2. Click into an event
3. Click an outcome → it's added to the slip (toast confirmation)
4. Continue browsing / adding more
5. Open the bet slip → configure singles/accumulators/stakes → submit

On the Events list page, you could even add quick "Add to Slip" buttons directly on the event cards showing the outcomes with their odds, so users don't have to click into each event.

### 3.4 Navigation Updates

- Add the bet slip floating button to the Layout component (visible on all pages when slip has items).
- The bet slip drawer sits on top of the page content (overlay with backdrop).
- Mobile: slide up from bottom as a bottom sheet. Desktop: slide in from right.

### 3.5 My Predictions Page Updates

Add an "Accumulators" tab alongside the existing predictions list:

- Tab 1: "Singles" — existing prediction cards (unchanged)
- Tab 2: "Accumulators" — accumulator cards showing:
  - Status badge (PENDING / WON / LOST)
  - Stake amount
  - Combined odds
  - Potential payout (or actual payout if settled)
  - List of legs with their individual status (✅ Won / ❌ Lost / ⏳ Pending / event title / outcome / odds)
  - Expandable/collapsible leg list

### 3.6 Frontend API Client Updates (`frontend/src/lib/api.ts`)

Add accumulator methods:
```typescript
async placeAccumulator(legs: Array<{ eventId: string; predictedOutcome: string }>, stakeAmount: number) {
  return this.request('/accumulators', {
    method: 'POST',
    body: JSON.stringify({ legs, stakeAmount }),
  });
}

async getMyAccumulators(params?: { status?: string; limit?: number; offset?: number }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.limit != null) searchParams.set('limit', params.limit.toString());
  if (params?.offset != null) searchParams.set('offset', params.offset.toString());
  const query = searchParams.toString();
  return this.request(`/accumulators${query ? `?${query}` : ''}`);
}

async getAccumulator(id: string) {
  return this.request(`/accumulators/${id}`);
}
```

Add types:
```typescript
export interface Accumulator {
  id: string;
  userId: string;
  stakeAmount: number;
  combinedOdds: string;
  potentialPayout: number;
  status: 'PENDING' | 'WON' | 'LOST' | 'CANCELLED' | 'CASHED_OUT';
  payout: number | null;
  settledAt: string | null;
  createdAt: string;
  legs: AccumulatorLeg[];
}

export interface AccumulatorLeg {
  id: string;
  eventId: string;
  predictedOutcome: string;
  odds: string;
  status: PredictionStatus;
  settledAt: string | null;
  event?: Event;
}
```

---

## Part 4: Wrap the App in BetSlipProvider

In `App.tsx`, wrap the authenticated routes with the BetSlipProvider:

```tsx
<BrowserRouter>
  <AuthProvider>
    <BetSlipProvider>
      <AppRoutes />
    </BetSlipProvider>
  </AuthProvider>
</BrowserRouter>
```

The `BetSlip` component (floating button + drawer) should be rendered inside the `Layout` component so it appears on all authenticated pages.

---

## Important Rules

- **Generate the Prisma migration** — this removes a unique constraint AND adds new tables.
- **Search the entire codebase for `userId_eventId`** — the removed unique constraint means any code referencing this composite key will break. Fix all of them.
- **Accumulator settlement must be inside the same transaction** as event settlement — don't settle them separately.
- **The bet slip is a frontend-only concept** — the backend just receives individual prediction requests and accumulator requests. It doesn't know about "slips".
- **Token deduction for accumulators goes through the existing `TokenAllowanceService.consumeTokens()`** — same ledger pattern as singles.
- **Accumulator winnings go through `PointsLedgerService.credit()`** — same points ledger as singles.
- **Run `npm run typecheck`** after every change.
- **Run `npm run build`** before committing.
- **Test edge cases**: What happens when 2 legs have the same event? What happens when an event is cancelled mid-accumulator? What if the user doesn't have enough tokens for singles + accumulator combined?
