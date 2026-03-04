import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase, disconnectDatabase } from '../services/database.js';
import { AuthService } from '../services/auth.js';
import { EventService } from '../services/events.js';
import { PredictionService } from '../services/predictions.js';
import { LedgerService } from '../services/ledger.js';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const integration = runIntegration ? describe : describe.skip;

integration('Integration Flows', () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('auth flow: register -> login -> get profile', async () => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `integration-auth-${unique}@example.com`;
    const password = 'Integration123!';

    const registered = await AuthService.register(email, password);
    const loggedIn = await AuthService.login(email, password);
    const profile = await AuthService.getUserById(loggedIn.user.id);

    expect(loggedIn.user.id).toBe(registered.user.id);
    expect(profile).not.toBeNull();
    expect(profile?.email).toBe(email);
  }, 30_000);

  it('prediction flow: list events -> place prediction -> balance reduced', async () => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `integration-pred-${unique}@example.com`;
    const password = 'Integration123!';

    const registered = await AuthService.register(email, password);
    await LedgerService.credit({
      userId: registered.user.id,
      amount: 20,
      type: 'ADMIN_CREDIT',
      description: 'Integration test top-up',
    });

    const event = await EventService.create({
      title: `Integration Event ${unique}`,
      startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      outcomes: ['Home', 'Away'],
      createdBy: 'system',
    });

    // Seed odds so prediction placement has valid odds data.
    await EventService.updateOdds(event.id, {
      outcomes: [
        { name: 'Home', price: 2.0 },
        { name: 'Away', price: 1.8 },
      ],
      updatedAt: new Date().toISOString(),
    });

    const listedEvents = await EventService.list({ status: 'OPEN', limit: 100, offset: 0 });
    expect(listedEvents.events.some((e) => e.id === event.id)).toBe(true);

    const balanceBefore = await LedgerService.getBalance(registered.user.id);

    await PredictionService.place({
      userId: registered.user.id,
      eventId: event.id,
      predictedOutcome: 'Home',
      stakeAmount: 5,
    });

    const balanceAfter = await LedgerService.getBalance(registered.user.id);
    expect(balanceAfter.cached).toBe(balanceBefore.cached - 5);
  }, 30_000);
});
