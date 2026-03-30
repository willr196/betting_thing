import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  eventFindManyMock,
  autoLockStartedEventsMock,
  cleanupStaleUnpredictedEventsMock,
  deleteOldFinishedEventsMock,
  getScoresMock,
  settleMock,
} = vi.hoisted(() => ({
  eventFindManyMock: vi.fn(),
  autoLockStartedEventsMock: vi.fn(),
  cleanupStaleUnpredictedEventsMock: vi.fn(),
  deleteOldFinishedEventsMock: vi.fn(),
  getScoresMock: vi.fn(),
  settleMock: vi.fn(),
}));

vi.mock('../services/database.js', () => ({
  prisma: {
    event: {
      findMany: eventFindManyMock,
    },
  },
}));

vi.mock('../services/events.js', () => ({
  EventService: {
    autoLockStartedEvents: autoLockStartedEventsMock,
    cleanupStaleUnpredictedEvents: cleanupStaleUnpredictedEventsMock,
    deleteOldFinishedEvents: deleteOldFinishedEventsMock,
    settle: settleMock,
  },
}));

vi.mock('../services/oddsApi.js', () => ({
  OddsApiService: {
    getScores: getScoresMock,
  },
}));

import { createSettlementWorker } from '../services/settlementWorker.js';

describe('SettlementWorker.runOnce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T12:00:00.000Z'));
    vi.clearAllMocks();

    autoLockStartedEventsMock.mockResolvedValue(0);
    cleanupStaleUnpredictedEventsMock.mockResolvedValue(0);
    deleteOldFinishedEventsMock.mockResolvedValue(0);
    getScoresMock.mockResolvedValue([]);
    eventFindManyMock.mockResolvedValue([
      {
        id: 'event_2',
        title: 'Liverpool vs Arsenal',
        outcomes: ['Liverpool', 'Arsenal', 'Draw'],
        externalEventId: 'ext_2',
        externalSportKey: 'soccer_epl',
        startsAt: new Date('2026-03-24T11:00:00.000Z'),
      },
      {
        id: 'event_1',
        title: 'Chelsea vs Spurs',
        outcomes: ['Chelsea', 'Spurs', 'Draw'],
        externalEventId: 'ext_1',
        externalSportKey: 'soccer_epl',
        startsAt: new Date('2026-03-23T11:00:00.000Z'),
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls only recent locked events and requests a 3-day score lookback', async () => {
    const worker = createSettlementWorker();

    await worker.runOnce();

    expect(eventFindManyMock).toHaveBeenCalledWith({
      where: {
        status: 'LOCKED',
        externalSportKey: { not: null },
        externalEventId: { not: null },
        startsAt: {
          lte: new Date('2026-03-24T12:00:00.000Z'),
          gte: new Date('2026-03-21T12:00:00.000Z'),
        },
      },
      orderBy: { startsAt: 'desc' },
      take: 100,
    });
    expect(getScoresMock).toHaveBeenCalledWith('soccer_epl', {
      daysFrom: 3,
      eventIds: ['ext_2', 'ext_1'],
    });
    expect(settleMock).not.toHaveBeenCalled();
  });
});
