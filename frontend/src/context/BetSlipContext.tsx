import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const MIN_STAKE = 1;
const MAX_STAKE = 35;
const DEFAULT_STAKE = 5;

export interface BetSlipSelection {
  id: string;
  eventId: string;
  eventTitle: string;
  predictedOutcome: string;
  odds: number;
  placeSingle: boolean;
}

interface BetSlipContextType {
  selections: BetSlipSelection[];
  accumulatorEnabled: boolean;
  singleStake: number;
  accumulatorStake: number;
  combinedOdds: number;
  totalCost: number;
  isSubmitting: boolean;
  addSelection: (eventId: string, eventTitle: string, predictedOutcome: string, odds: number) => void;
  removeSelection: (id: string) => void;
  clearSlip: () => void;
  toggleSingle: (id: string) => void;
  toggleAccumulator: () => void;
  setSingleStake: (amount: number) => void;
  setAccumulatorStake: (amount: number) => void;
  submitSlip: () => Promise<void>;
}

const BetSlipContext = createContext<BetSlipContextType | null>(null);

export function BetSlipProvider({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth();
  const { success: showSuccess, error: showError, info: showInfo } = useToast();

  const [selections, setSelections] = useState<BetSlipSelection[]>([]);
  const [accumulatorEnabled, setAccumulatorEnabled] = useState(false);
  const [singleStake, setSingleStakeState] = useState(DEFAULT_STAKE);
  const [accumulatorStake, setAccumulatorStakeState] = useState(DEFAULT_STAKE);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const combinedOdds = useMemo(() => {
    if (selections.length === 0) {
      return 1;
    }

    return selections.reduce((product, selection) => product * selection.odds, 1);
  }, [selections]);

  const totalCost = useMemo(() => {
    const singlesCost = selections.filter((selection) => selection.placeSingle).length * singleStake;
    const accumulatorCost = accumulatorEnabled ? accumulatorStake : 0;
    return singlesCost + accumulatorCost;
  }, [accumulatorEnabled, accumulatorStake, selections, singleStake]);

  const addSelection = (
    eventId: string,
    eventTitle: string,
    predictedOutcome: string,
    odds: number
  ) => {
    setSelections((previous) => [
      ...previous,
      {
        id: createSelectionId(),
        eventId,
        eventTitle,
        predictedOutcome,
        odds,
        placeSingle: true,
      },
    ]);
  };

  const removeSelection = (id: string) => {
    setSelections((previous) => previous.filter((selection) => selection.id !== id));
  };

  const clearSlip = () => {
    setSelections([]);
    setAccumulatorEnabled(false);
  };

  const toggleSingle = (id: string) => {
    setSelections((previous) =>
      previous.map((selection) =>
        selection.id === id
          ? { ...selection, placeSingle: !selection.placeSingle }
          : selection
      )
    );
  };

  const toggleAccumulator = () => {
    setAccumulatorEnabled((previous) => !previous);
  };

  const setSingleStake = (amount: number) => {
    setSingleStakeState(clampStake(amount));
  };

  const setAccumulatorStake = (amount: number) => {
    setAccumulatorStakeState(clampStake(amount));
  };

  const submitSlip = async () => {
    if (isSubmitting) {
      return;
    }

    if (!user) {
      showError('Please log in to place bets');
      return;
    }

    if (selections.length === 0) {
      showError('Your bet slip is empty');
      return;
    }

    const singles = selections.filter((selection) => selection.placeSingle);
    const shouldPlaceAccumulator = accumulatorEnabled && selections.length >= 2;

    if (singles.length === 0 && !shouldPlaceAccumulator) {
      showError('Select at least one single or enable accumulator');
      return;
    }

    if (totalCost > user.tokenBalance) {
      showError('Not enough tokens for this bet slip');
      return;
    }

    const requests: Array<{ label: string; run: () => Promise<unknown> }> = [];

    for (const selection of singles) {
      requests.push({
        label: `Single: ${selection.eventTitle} - ${selection.predictedOutcome}`,
        run: () => api.placePrediction(selection.eventId, selection.predictedOutcome, singleStake),
      });
    }

    if (shouldPlaceAccumulator) {
      requests.push({
        label: `Accumulator (${selections.length} legs)`,
        run: () =>
          api.placeAccumulator(
            selections.map((selection) => ({
              eventId: selection.eventId,
              predictedOutcome: selection.predictedOutcome,
            })),
            accumulatorStake
          ),
      });
    }

    setIsSubmitting(true);

    try {
      const results = await Promise.allSettled(requests.map((request) => request.run()));

      const succeeded: string[] = [];
      const failed: string[] = [];

      results.forEach((result, index) => {
        const label = requests[index]?.label ?? 'Bet';
        if (result.status === 'fulfilled') {
          succeeded.push(label);
          return;
        }

        const message = result.reason instanceof ApiError
          ? result.reason.message
          : 'Request failed';
        failed.push(`${label} (${message})`);
      });

      if (failed.length === 0) {
        clearSlip();
        showSuccess(`Placed ${succeeded.length} bet${succeeded.length === 1 ? '' : 's'} successfully`);
        await refreshUser();
        return;
      }

      if (succeeded.length > 0) {
        showInfo(`${succeeded.length} bet${succeeded.length === 1 ? '' : 's'} placed, ${failed.length} failed`);
      } else {
        showError('No bets were placed');
      }

      for (const message of failed.slice(0, 3)) {
        showError(message);
      }

      await refreshUser();
    } finally {
      setIsSubmitting(false);
    }
  };

  const value: BetSlipContextType = {
    selections,
    accumulatorEnabled,
    singleStake,
    accumulatorStake,
    combinedOdds,
    totalCost,
    isSubmitting,
    addSelection,
    removeSelection,
    clearSlip,
    toggleSingle,
    toggleAccumulator,
    setSingleStake,
    setAccumulatorStake,
    submitSlip,
  };

  return <BetSlipContext.Provider value={value}>{children}</BetSlipContext.Provider>;
}

export function useBetSlip(): BetSlipContextType {
  const context = useContext(BetSlipContext);
  if (!context) {
    throw new Error('useBetSlip must be used within a BetSlipProvider');
  }
  return context;
}

function clampStake(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_STAKE;
  }

  return Math.min(MAX_STAKE, Math.max(MIN_STAKE, Math.floor(value)));
}

function createSelectionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
