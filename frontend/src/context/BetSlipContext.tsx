import {
  createContext,
  useContext,
  useEffect,
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
const BET_SLIP_STORAGE_PREFIX = 'prediction-platform:bet-slip:v1';

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
  const storageKey = useMemo(
    () => createBetSlipStorageKey(user?.id),
    [user?.id]
  );

  const [selections, setSelections] = useState<BetSlipSelection[]>([]);
  const [accumulatorEnabled, setAccumulatorEnabled] = useState(false);
  const [singleStake, setSingleStakeState] = useState(DEFAULT_STAKE);
  const [accumulatorStake, setAccumulatorStakeState] = useState(DEFAULT_STAKE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);

  useEffect(() => {
    const persistedState = loadPersistedState(storageKey);
    setSelections(persistedState.selections);
    setAccumulatorEnabled(persistedState.accumulatorEnabled);
    setSingleStakeState(persistedState.singleStake);
    setAccumulatorStakeState(persistedState.accumulatorStake);
    setHydratedStorageKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (hydratedStorageKey !== storageKey) {
      return;
    }

    persistState(storageKey, {
      selections,
      accumulatorEnabled,
      singleStake,
      accumulatorStake,
    });
  }, [
    accumulatorEnabled,
    accumulatorStake,
    hydratedStorageKey,
    selections,
    singleStake,
    storageKey,
  ]);

  const combinedOdds = useMemo(() => {
    if (selections.length === 0) {
      return 1;
    }

    return selections.reduce((product, selection) => product * selection.odds, 1);
  }, [selections]);

  const totalCost = useMemo(() => {
    const singlesCost = selections.filter((selection) => selection.placeSingle).length * singleStake;
    const accumulatorCost = accumulatorEnabled && selections.length >= 2 ? accumulatorStake : 0;
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

function createBetSlipStorageKey(userId: string | undefined): string {
  return `${BET_SLIP_STORAGE_PREFIX}:${userId ?? 'anonymous'}`;
}

function loadPersistedState(key: string): PersistedState {
  const storage = getStorage();
  if (!storage) {
    return createDefaultPersistedState();
  }

  try {
    const rawState = storage.getItem(key);
    if (!rawState) {
      return createDefaultPersistedState();
    }

    const parsedState = JSON.parse(rawState);
    return normalizePersistedState(parsedState);
  } catch {
    return createDefaultPersistedState();
  }
}

function persistState(key: string, state: PersistedState): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(state));
  } catch {
    // Ignore write errors and keep in-memory behavior.
  }
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage ?? null;
}

interface PersistedState {
  selections: BetSlipSelection[];
  accumulatorEnabled: boolean;
  singleStake: number;
  accumulatorStake: number;
}

function createDefaultPersistedState(): PersistedState {
  return {
    selections: [],
    accumulatorEnabled: false,
    singleStake: DEFAULT_STAKE,
    accumulatorStake: DEFAULT_STAKE,
  };
}

function normalizePersistedState(value: unknown): PersistedState {
  if (!value || typeof value !== 'object') {
    return createDefaultPersistedState();
  }

  const stateRecord = value as Record<string, unknown>;
  const rawSelections = Array.isArray(stateRecord.selections) ? stateRecord.selections : [];
  const selections = rawSelections
    .map(normalizeSelection)
    .filter((selection): selection is BetSlipSelection => selection !== null);

  const accumulatorEnabled = stateRecord.accumulatorEnabled === true;
  const singleStake = clampStake(typeof stateRecord.singleStake === 'number'
    ? stateRecord.singleStake
    : DEFAULT_STAKE);
  const accumulatorStake = clampStake(typeof stateRecord.accumulatorStake === 'number'
    ? stateRecord.accumulatorStake
    : DEFAULT_STAKE);

  return {
    selections,
    accumulatorEnabled,
    singleStake,
    accumulatorStake,
  };
}

function normalizeSelection(value: unknown): BetSlipSelection | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const eventId = typeof record.eventId === 'string' ? record.eventId : null;
  const eventTitle = typeof record.eventTitle === 'string' ? record.eventTitle : null;
  const predictedOutcome = typeof record.predictedOutcome === 'string' ? record.predictedOutcome : null;
  const odds = typeof record.odds === 'number' && Number.isFinite(record.odds) ? record.odds : null;
  const placeSingle = record.placeSingle !== false;

  if (!id || !eventId || !eventTitle || !predictedOutcome || odds === null) {
    return null;
  }

  return {
    id,
    eventId,
    eventTitle,
    predictedOutcome,
    odds,
    placeSingle,
  };
}
