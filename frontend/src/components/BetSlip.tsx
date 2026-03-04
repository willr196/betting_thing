import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBetSlip } from '../context/BetSlipContext';
import { formatTokens } from '../lib/utils';
import { Button } from './ui';

export function BetSlip() {
  const { user } = useAuth();
  const {
    selections,
    accumulatorEnabled,
    singleStake,
    accumulatorStake,
    combinedOdds,
    totalCost,
    isSubmitting,
    removeSelection,
    clearSlip,
    toggleSingle,
    toggleAccumulator,
    setSingleStake,
    setAccumulatorStake,
    submitSlip,
  } = useBetSlip();

  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (selections.length === 0) {
      setIsOpen(false);
    }
  }, [selections.length]);

  const singlesCount = useMemo(
    () => selections.filter((selection) => selection.placeSingle).length,
    [selections]
  );

  if (!user || selections.length === 0) {
    return null;
  }

  const balance = user.tokenBalance;
  const hasSinglesSelected = singlesCount > 0;
  const canUseAccumulator = selections.length >= 2;
  const accumulatorActive = accumulatorEnabled && canUseAccumulator;
  const accumulatorPotentialPayout = Math.floor(accumulatorStake * combinedOdds);
  const canSubmit = totalCost > 0 && totalCost <= balance && !isSubmitting;

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-5 right-5 z-40 rounded-full bg-primary-600 px-5 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-primary-700"
        >
          Bet Slip ({selections.length})
        </button>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 bg-black/40"
            aria-label="Close bet slip"
          />

          <div className="absolute inset-x-0 bottom-0 max-h-[88vh] rounded-t-2xl bg-white shadow-xl sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:max-h-none sm:w-[420px] sm:rounded-none">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Bet Slip</h2>
                  <p className="text-sm text-gray-500">{selections.length} selection(s)</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearSlip}
                  >
                    Clear All
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsOpen(false)}
                  >
                    Close
                  </Button>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div className="space-y-3">
                  {selections.map((selection) => (
                    <div
                      key={selection.id}
                      className="rounded-lg border border-gray-200 p-3"
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-gray-900 line-clamp-2">
                          {selection.eventTitle}
                        </p>
                        <button
                          type="button"
                          onClick={() => removeSelection(selection.id)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          Remove
                        </button>
                      </div>
                      <p className="text-sm text-gray-600">
                        {selection.predictedOutcome} ({selection.odds.toFixed(2)}x)
                      </p>
                      <label className="mt-2 inline-flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={selection.placeSingle}
                          onChange={() => toggleSingle(selection.id)}
                        />
                        Single
                      </label>
                    </div>
                  ))}
                </div>

                {hasSinglesSelected && (
                  <div className="rounded-lg border border-gray-200 p-3">
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Stake per single
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={35}
                      value={singleStake}
                      onChange={(event) => setSingleStake(event.currentTarget.valueAsNumber)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                )}

                <div className="rounded-lg border border-gray-200 p-3">
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-800">
                    <input
                      type="checkbox"
                      checked={accumulatorActive}
                      onChange={toggleAccumulator}
                      disabled={!canUseAccumulator}
                    />
                    Place as accumulator
                  </label>

                  <p className="mt-2 text-sm text-gray-600">
                    Combined odds: {combinedOdds.toFixed(2)}x
                  </p>

                  {accumulatorActive && (
                    <>
                      <div className="mt-3">
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Accumulator stake
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={35}
                          value={accumulatorStake}
                          onChange={(event) => setAccumulatorStake(event.currentTarget.valueAsNumber)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <p className="mt-2 text-sm text-green-700">
                        Potential payout: {formatTokens(accumulatorPotentialPayout)} points
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-200 px-5 py-4">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="text-gray-600">Singles selected</span>
                  <span className="font-medium text-gray-900">{singlesCount}</span>
                </div>
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="text-gray-600">Total</span>
                  <span className="text-base font-semibold text-gray-900">
                    {formatTokens(totalCost)} tokens
                  </span>
                </div>
                <div className="mb-4 flex items-center justify-between text-sm">
                  <span className="text-gray-600">Your balance</span>
                  <span className="font-medium text-gray-900">
                    {formatTokens(balance)} tokens
                  </span>
                </div>

                {!canSubmit && totalCost > balance && (
                  <p className="mb-3 text-sm text-red-600">Insufficient tokens for this slip</p>
                )}

                <Button
                  type="button"
                  className="w-full"
                  size="lg"
                  onClick={submitSlip}
                  disabled={!canSubmit}
                  isLoading={isSubmitting}
                >
                  Place Bets
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
