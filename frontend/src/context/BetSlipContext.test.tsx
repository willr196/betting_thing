import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BetSlipProvider, useBetSlip } from './BetSlipContext';
import { ApiError } from '../lib/api';

const {
  placePredictionMock,
  placeAccumulatorMock,
  refreshUserMock,
  toastSuccessMock,
  toastErrorMock,
  toastInfoMock,
  authState,
} = vi.hoisted(() => ({
  placePredictionMock: vi.fn(),
  placeAccumulatorMock: vi.fn(),
  refreshUserMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  authState: {
    user: null as { tokenBalance: number } | null,
  },
}));

vi.mock('../lib/api', () => {
  class MockApiError extends Error {
    constructor(
      message: string,
      public code: string,
      public status: number
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }

  return {
    api: {
      placePrediction: placePredictionMock,
      placeAccumulator: placeAccumulatorMock,
    },
    ApiError: MockApiError,
  };
});

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
    refreshUser: refreshUserMock,
  }),
}));

vi.mock('./ToastContext', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    info: toastInfoMock,
  }),
}));

function TestHarness() {
  const { addSelection, toggleAccumulator, submitSlip, selections, totalCost } = useBetSlip();

  return (
    <div>
      <button
        type="button"
        onClick={() => addSelection('event_1', 'Event 1', 'Home', 2.0)}
      >
        Add Home
      </button>
      <button
        type="button"
        onClick={() => addSelection('event_2', 'Event 2', 'Away', 1.8)}
      >
        Add Away
      </button>
      <button
        type="button"
        onClick={() => addSelection('event_1', 'Event 1', 'Away', 1.9)}
      >
        Add Event 1 Away
      </button>
      <button
        type="button"
        onClick={() =>
          addSelection('event_1', 'Event 1', 'Draw', 3.1, { replaceExistingForEvent: true })
        }
      >
        Replace Event 1
      </button>
      <button type="button" onClick={toggleAccumulator}>
        Toggle Accumulator
      </button>
      <button
        type="button"
        onClick={() => {
          void submitSlip();
        }}
      >
        Submit Slip
      </button>

      <div data-testid="selection-count">{selections.length}</div>
      <div data-testid="selection-summary">
        {selections.map((selection) => `${selection.eventId}:${selection.predictedOutcome}`).join('|')}
      </div>
      <div data-testid="total-cost">{totalCost}</div>
    </div>
  );
}

async function seedSlipWithTwoSelections(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add Home' }));
  await user.click(screen.getByRole('button', { name: 'Add Away' }));
}

describe('BetSlipContext submit flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    authState.user = { tokenBalance: 100 };
  });

  it('submits singles + accumulator and clears slip on full success', async () => {
    placePredictionMock.mockResolvedValue({});
    placeAccumulatorMock.mockResolvedValue({});

    render(
      <BetSlipProvider>
        <TestHarness />
      </BetSlipProvider>
    );

    const user = userEvent.setup();
    await seedSlipWithTwoSelections(user);
    await user.click(screen.getByRole('button', { name: 'Toggle Accumulator' }));
    await user.click(screen.getByRole('button', { name: 'Submit Slip' }));

    await waitFor(() => {
      expect(placePredictionMock).toHaveBeenCalledTimes(2);
      expect(placeAccumulatorMock).toHaveBeenCalledTimes(1);
    });

    expect(placeAccumulatorMock).toHaveBeenCalledWith(
      [
        { eventId: 'event_1', predictedOutcome: 'Home' },
        { eventId: 'event_2', predictedOutcome: 'Away' },
      ],
      5
    );

    await waitFor(() => {
      expect(screen.getByTestId('selection-count')).toHaveTextContent('0');
    });

    expect(toastSuccessMock).toHaveBeenCalledWith('Placed 3 bets successfully');
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(toastInfoMock).not.toHaveBeenCalled();
    expect(refreshUserMock).toHaveBeenCalledTimes(1);
  });

  it('keeps slip and reports details on partial failure', async () => {
    placePredictionMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ApiError('single failed', 'REQUEST_FAILED', 400));
    placeAccumulatorMock.mockResolvedValue({});

    render(
      <BetSlipProvider>
        <TestHarness />
      </BetSlipProvider>
    );

    const user = userEvent.setup();
    await seedSlipWithTwoSelections(user);
    await user.click(screen.getByRole('button', { name: 'Toggle Accumulator' }));
    await user.click(screen.getByRole('button', { name: 'Submit Slip' }));

    await waitFor(() => {
      expect(toastInfoMock).toHaveBeenCalledWith('2 bets placed, 1 failed');
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Single: Event 2 - Away (single failed)')
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(refreshUserMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('selection-count')).toHaveTextContent('2');
  });

  it('blocks submission when total cost exceeds balance', async () => {
    authState.user = { tokenBalance: 5 };

    render(
      <BetSlipProvider>
        <TestHarness />
      </BetSlipProvider>
    );

    const user = userEvent.setup();
    await seedSlipWithTwoSelections(user);
    await user.click(screen.getByRole('button', { name: 'Toggle Accumulator' }));

    expect(screen.getByTestId('total-cost')).toHaveTextContent('15');

    await user.click(screen.getByRole('button', { name: 'Submit Slip' }));

    expect(toastErrorMock).toHaveBeenCalledWith('Not enough tokens for this bet slip');
    expect(placePredictionMock).not.toHaveBeenCalled();
    expect(placeAccumulatorMock).not.toHaveBeenCalled();
    expect(refreshUserMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('selection-count')).toHaveTextContent('2');
  });

  it('skips the accumulator when the slip contains duplicate event selections', async () => {
    placePredictionMock.mockResolvedValue({});

    render(
      <BetSlipProvider>
        <TestHarness />
      </BetSlipProvider>
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add Home' }));
    await user.click(screen.getByRole('button', { name: 'Add Event 1 Away' }));
    await user.click(screen.getByRole('button', { name: 'Toggle Accumulator' }));

    expect(screen.getByTestId('total-cost')).toHaveTextContent('10');

    await user.click(screen.getByRole('button', { name: 'Submit Slip' }));

    await waitFor(() => {
      expect(placePredictionMock).toHaveBeenCalledTimes(2);
    });

    expect(placeAccumulatorMock).not.toHaveBeenCalled();
    expect(toastInfoMock).toHaveBeenCalledWith(
      'Accumulator selections must be from different events. Singles will still be placed.'
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('Placed 2 bets successfully');
  });

  it('persists selections when provider remounts', async () => {
    const firstRender = render(
      <BetSlipProvider>
        <TestHarness />
      </BetSlipProvider>
    );

    const user = userEvent.setup();
    await seedSlipWithTwoSelections(user);
    expect(screen.getByTestId('selection-count')).toHaveTextContent('2');

    firstRender.unmount();

    render(
      <BetSlipProvider>
        <TestHarness />
      </BetSlipProvider>
    );

    expect(screen.getByTestId('selection-count')).toHaveTextContent('2');
  });

  it('replaces existing selection for the same event when requested', async () => {
    render(
      <BetSlipProvider>
        <TestHarness />
      </BetSlipProvider>
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add Home' }));
    expect(screen.getByTestId('selection-count')).toHaveTextContent('1');
    expect(screen.getByTestId('selection-summary')).toHaveTextContent('event_1:Home');

    await user.click(screen.getByRole('button', { name: 'Replace Event 1' }));

    expect(screen.getByTestId('selection-count')).toHaveTextContent('1');
    expect(screen.getByTestId('selection-summary')).toHaveTextContent('event_1:Draw');
    expect(screen.getByTestId('selection-summary')).not.toHaveTextContent('event_1:Home');
  });
});
