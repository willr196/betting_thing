import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FootballPage } from './FootballPage';

const {
  getEventsMock,
  addSelectionMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  getEventsMock: vi.fn(),
  addSelectionMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    getEvents: getEventsMock,
  },
}));

vi.mock('../context/BetSlipContext', () => ({
  useBetSlip: () => ({
    selections: [],
    addSelection: addSelectionMock,
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({
    success: toastSuccessMock,
  }),
}));

describe('FootballPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();

    getEventsMock.mockImplementation(async (params?: { status?: string }) => {
      if (params?.status === 'SETTLED') {
        return {
          events: [
            {
              id: 'completed-1',
              title: 'Liverpool vs Everton',
              description: 'Premier League',
              startsAt: '2026-03-15T15:00:00.000Z',
              status: 'SETTLED',
              outcomes: ['Liverpool', 'Draw', 'Everton'],
              finalOutcome: 'Liverpool',
              payoutMultiplier: 2,
              currentOdds: null,
              createdAt: '2026-03-10T10:00:00.000Z',
            },
          ],
          total: 1,
        };
      }

      return {
        events: [
          {
            id: 'open-1',
            title: 'Arsenal vs Chelsea',
            description: 'Premier League',
            startsAt: '2026-03-20T19:00:00.000Z',
            status: 'OPEN',
            outcomes: ['Arsenal', 'Draw', 'Chelsea'],
            finalOutcome: null,
            payoutMultiplier: 2,
            currentOdds: null,
            createdAt: '2026-03-10T10:00:00.000Z',
          },
        ],
        total: 1,
      };
    });
  });

  it('clears completed games and restores them from the page controls', async () => {
    const user = userEvent.setup();
    render(<FootballPage />);

    expect(await screen.findByText('Liverpool vs Everton')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear completed' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Clear completed' }));

    await waitFor(() => {
      expect(screen.queryByText('Liverpool vs Everton')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Completed games are cleared')).toBeInTheDocument();
    expect(
      JSON.parse(
        window.localStorage.getItem(
          'prediction-platform:football:cleared-completed:v1'
        ) ?? '[]'
      )
    ).toEqual(['completed-1']);

    await user.click(screen.getByRole('button', { name: 'Show cleared' }));

    expect(await screen.findByText('Liverpool vs Everton')).toBeInTheDocument();
    expect(
      JSON.parse(
        window.localStorage.getItem(
          'prediction-platform:football:cleared-completed:v1'
        ) ?? '[]'
      )
    ).toEqual([]);
  });

  it('keeps cleared completed games hidden after remount until restored', async () => {
    const user = userEvent.setup();
    const initialRender = render(<FootballPage />);

    expect(await screen.findByText('Liverpool vs Everton')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear completed' }));

    await waitFor(() => {
      expect(screen.queryByText('Liverpool vs Everton')).not.toBeInTheDocument();
    });

    initialRender.unmount();
    render(<FootballPage />);

    await screen.findByText('Completed games');
    expect(screen.queryByText('Liverpool vs Everton')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show cleared' })).toBeInTheDocument();
  });
});
