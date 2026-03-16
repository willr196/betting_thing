import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatDate, formatPoints, formatTokens, getStatusColor } from '../lib/utils';
import { Badge, Button, Card, EmptyState, FilterChip, InlineError, Spinner, StatCard } from '../components/ui';
import type { Accumulator, AccumulatorLeg, Prediction, PredictionStats } from '../types';

const POLL_INTERVAL_MS = 60_000;

function formatFilterLabel(value: string): string {
  if (value === 'all') return 'All';
  if (value === 'CASHED_OUT') return 'Cashed Out';
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function PredictionsPage() {
  const { refreshUser } = useAuth();
  const { success: showSuccess, error: showError } = useToast();

  const [activeTab, setActiveTab] = useState<'singles' | 'accumulators'>('singles');

  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [stats, setStats] = useState<PredictionStats | null>(null);
  const [singlesLoading, setSinglesLoading] = useState(true);
  const [singlesError, setSinglesError] = useState('');
  const [filter, setFilter] = useState<'all' | 'PENDING' | 'WON' | 'LOST' | 'CASHED_OUT'>('all');

  const [accumulators, setAccumulators] = useState<Accumulator[]>([]);
  const [accumulatorsLoading, setAccumulatorsLoading] = useState(false);
  const [accumulatorsError, setAccumulatorsError] = useState('');

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasPendingSingles = predictions.some((prediction) => prediction.status === 'PENDING');
  const settledCount = (stats?.won ?? 0) + (stats?.lost ?? 0);

  // Silent background polling for pending singles
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!hasPendingSingles) return;

    intervalRef.current = setInterval(() => {
      void loadSingles(true);
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [hasPendingSingles]);

  useEffect(() => {
    if (activeTab === 'singles') {
      void loadSingles();
      return;
    }
    void loadAccumulators();
  }, [activeTab, filter]);

  const loadSingles = async (silent = false) => {
    if (!silent) setSinglesLoading(true);
    setSinglesError('');

    try {
      const params: { status?: string; limit: number } = { limit: 50 };
      if (filter !== 'all') params.status = filter;

      const [predictionsData, statsData] = await Promise.all([
        api.getMyPredictions(params),
        api.getMyPredictionStats(),
      ]);

      setPredictions(predictionsData.predictions);
      setStats(statsData.stats);
    } catch {
      if (!silent) {
        setSinglesError('Your picks could not be loaded right now.');
        showError('Unable to load predictions');
      }
    } finally {
      if (!silent) setSinglesLoading(false);
    }
  };

  const loadAccumulators = async () => {
    setAccumulatorsLoading(true);
    setAccumulatorsError('');

    try {
      const data = await api.getMyAccumulators({ limit: 50 });
      setAccumulators(data.accumulators);
    } catch {
      setAccumulatorsError('Your accumulators could not be loaded right now.');
      showError('Unable to load accumulators');
    } finally {
      setAccumulatorsLoading(false);
    }
  };

  const updatePrediction = (updatedPrediction: Prediction) => {
    setPredictions((previous) =>
      previous.map((prediction) =>
        prediction.id === updatedPrediction.id ? updatedPrediction : prediction
      )
    );
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Picks</h1>
        <p className="mt-1 text-sm text-gray-500">Track your singles and accumulators</p>
      </div>

      {/* Tab switcher */}
      <div className="mb-6 flex gap-2">
        <FilterChip active={activeTab === 'singles'} onClick={() => setActiveTab('singles')}>
          Singles
        </FilterChip>
        <FilterChip
          active={activeTab === 'accumulators'}
          onClick={() => setActiveTab('accumulators')}
        >
          Accumulators
        </FilterChip>
      </div>

      {activeTab === 'singles' ? (
        <>
          {/* Stats — shown only when meaningful data exists */}
          {stats && (
            <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard label="Total Picks" value={stats.total} />
              <StatCard
                label="Win Rate"
                value={settledCount > 0 ? `${stats.winRate.toFixed(1)}%` : '—'}
                subValue={
                  settledCount > 0 ? `${stats.won}W · ${stats.lost}L` : 'No settled picks yet'
                }
                trend={settledCount > 0 ? (stats.winRate >= 50 ? 'up' : 'down') : 'neutral'}
              />
              <StatCard
                label="Points Earned"
                value={formatPoints(stats.totalWinnings)}
                subValue="from winning picks"
                trend={stats.totalWinnings > 0 ? 'up' : 'neutral'}
              />
              <StatCard
                label="Pending"
                value={stats.pending}
                subValue={stats.pending === 1 ? 'awaiting result' : 'awaiting results'}
              />
            </div>
          )}

          {/* Status filters */}
          <div className="mb-6 flex flex-wrap gap-2">
            {(['all', 'PENDING', 'WON', 'LOST', 'CASHED_OUT'] as const).map((value) => (
              <FilterChip
                key={value}
                active={filter === value}
                onClick={() => setFilter(value)}
              >
                {formatFilterLabel(value)}
              </FilterChip>
            ))}
          </div>

          {singlesLoading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : singlesError ? (
            <InlineError message={singlesError} onRetry={() => void loadSingles()} />
          ) : predictions.length === 0 ? (
            <EmptyState
              title={filter !== 'all' ? 'No picks in this category' : 'No picks yet'}
              description={
                filter !== 'all'
                  ? 'Try switching to a different filter.'
                  : 'Browse open events and add your first selection to get started.'
              }
              action={
                filter !== 'all' ? (
                  <Button variant="secondary" onClick={() => setFilter('all')}>
                    Show all picks
                  </Button>
                ) : (
                  <Link to="/events">
                    <Button>Browse events</Button>
                  </Link>
                )
              }
            />
          ) : (
            <div className="space-y-4">
              {predictions.map((prediction) => (
                <PredictionCard
                  key={prediction.id}
                  prediction={prediction}
                  onCashoutSuccess={(updatedPrediction) => {
                    updatePrediction(updatedPrediction);
                    void refreshUser();
                  }}
                  onNotifySuccess={showSuccess}
                  onNotifyError={showError}
                />
              ))}
            </div>
          )}
        </>
      ) : accumulatorsLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : accumulatorsError ? (
        <InlineError message={accumulatorsError} onRetry={() => void loadAccumulators()} />
      ) : accumulators.length === 0 ? (
        <EmptyState
          title="No accumulators yet"
          description="Build a slip with two or more selections to place your first accumulator."
          action={
            <Link to="/events">
              <Button>Browse events</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {accumulators.map((accumulator) => (
            <AccumulatorCard key={accumulator.id} accumulator={accumulator} />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PREDICTION CARD
// =============================================================================

function PredictionCard({
  prediction,
  onCashoutSuccess,
  onNotifySuccess,
  onNotifyError,
}: {
  prediction: Prediction;
  onCashoutSuccess: (updated: Prediction) => void;
  onNotifySuccess: (message: string) => void;
  onNotifyError: (message: string) => void;
}) {
  const isWon = prediction.status === 'WON';
  const isLost = prediction.status === 'LOST';
  const isPending = prediction.status === 'PENDING';
  const isCashedOut = prediction.status === 'CASHED_OUT';
  const [cashoutValue, setCashoutValue] = useState<number | null>(null);
  const [cashoutLoading, setCashoutLoading] = useState(false);

  const handleCashoutValue = async () => {
    setCashoutLoading(true);
    try {
      const result = await api.getCashoutValue(prediction.id);
      setCashoutValue(result.cashoutValue);
    } catch {
      onNotifyError('Unable to fetch cashout value');
    } finally {
      setCashoutLoading(false);
    }
  };

  const handleCashout = async () => {
    setCashoutLoading(true);
    try {
      const result = await api.cashoutPrediction(prediction.id);
      onNotifySuccess(
        `Cashed out for ${formatPoints(result.prediction.cashoutAmount ?? 0)} points`
      );
      for (const achievement of result.achievementsUnlocked ?? []) {
        onNotifySuccess(`${achievement.iconEmoji} Achievement unlocked: ${achievement.name}`);
      }
      onCashoutSuccess(result.prediction);
    } catch {
      onNotifyError('Cashout failed. Please try again.');
    } finally {
      setCashoutLoading(false);
    }
  };

  return (
    <Card className="transition-shadow hover:shadow-md">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge className={getStatusColor(prediction.status)}>
              {formatFilterLabel(prediction.status)}
            </Badge>
            {prediction.event && prediction.event.status !== 'OPEN' && (
              <Badge className={getStatusColor(prediction.event.status)}>
                Event {prediction.event.status.toLowerCase()}
              </Badge>
            )}
          </div>

          <h3 className="truncate font-semibold text-gray-900">
            {prediction.event?.title ?? 'Unknown Event'}
          </h3>

          <div className="mt-2 text-sm text-gray-600">
            <p>
              Your pick:{' '}
              <span
                className={`font-medium ${
                  isWon ? 'text-green-600' : isLost ? 'text-red-500' : ''
                }`}
              >
                {prediction.predictedOutcome}
              </span>
            </p>
            {prediction.event?.finalOutcome && (
              <p>
                Result:{' '}
                <span className="font-medium text-gray-800">{prediction.event.finalOutcome}</span>
              </p>
            )}
          </div>

          <p className="mt-1 text-xs text-gray-400">Placed {formatDate(prediction.createdAt)}</p>
        </div>

        <div className="text-right sm:min-w-[140px]">
          <p className="text-xs text-gray-400">Stake</p>
          <p className="font-semibold text-gray-900">{formatTokens(prediction.stakeAmount)} tokens</p>

          {isWon && prediction.payout && (
            <div className="mt-2">
              <p className="text-xs text-green-600">Won</p>
              <p className="text-lg font-bold text-green-600">
                +{formatPoints(prediction.payout)} pts
              </p>
            </div>
          )}

          {isLost && (
            <div className="mt-2">
              <p className="text-xs text-red-500">Lost</p>
              <p className="font-bold text-red-500">−{formatTokens(prediction.stakeAmount)}</p>
            </div>
          )}

          {isCashedOut && (
            <div className="mt-2">
              <p className="text-xs text-amber-600">Cashed out</p>
              <p className="text-lg font-bold text-amber-600">
                +{formatPoints(prediction.cashoutAmount ?? 0)} pts
              </p>
            </div>
          )}

          {isPending && prediction.event && (
            <div className="mt-2">
              <p className="text-xs text-gray-400">Potential win</p>
              <p className="font-medium text-primary-600">
                {formatPoints(
                  Math.floor(
                    prediction.stakeAmount *
                      (prediction.originalOdds
                        ? Number(prediction.originalOdds)
                        : prediction.event.payoutMultiplier)
                  )
                )}{' '}
                pts
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Cashout actions */}
      {isPending && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {cashoutValue === null ? (
              <Button variant="secondary" size="sm" onClick={handleCashoutValue} isLoading={cashoutLoading}>
                Check cashout value
              </Button>
            ) : (
              <>
                <span className="text-sm text-gray-600">
                  Cashout value:{' '}
                  <strong className="text-gray-900">{formatPoints(cashoutValue)} pts</strong>
                </span>
                <Button
                  size="sm"
                  onClick={handleCashout}
                  isLoading={cashoutLoading}
                  disabled={cashoutValue <= 0}
                >
                  Cash out now
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {prediction.event && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <Link
            to={`/events/${prediction.eventId}`}
            className="text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline"
          >
            View event →
          </Link>
        </div>
      )}
    </Card>
  );
}

// =============================================================================
// ACCUMULATOR CARD
// =============================================================================

function AccumulatorCard({ accumulator }: { accumulator: Accumulator }) {
  const [expanded, setExpanded] = useState(false);

  const hasWon = accumulator.status === 'WON';
  const hasLost = accumulator.status === 'LOST';
  const isPending = accumulator.status === 'PENDING';

  const statusDescription = isPending
    ? 'Awaiting remaining legs'
    : hasWon
      ? 'All legs won — accumulator settled'
      : hasLost
        ? 'A leg has lost — accumulator settled'
        : 'Accumulator settled';

  return (
    <Card className="transition-shadow hover:shadow-md">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge className={getStatusColor(accumulator.status)}>
              {formatFilterLabel(accumulator.status)}
            </Badge>
            <span className="text-xs text-gray-400">
              Placed {formatDate(accumulator.createdAt)}
            </span>
          </div>
          <h3 className="font-semibold text-gray-900">{accumulator.legs.length}-Leg Accumulator</h3>
        </div>

        <div className="grid grid-cols-3 gap-4 text-right text-sm sm:min-w-[320px]">
          <div>
            <p className="text-xs text-gray-400">Stake</p>
            <p className="font-semibold text-gray-900">{formatTokens(accumulator.stakeAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Odds</p>
            <p className="font-semibold text-gray-900">
              {Number(accumulator.combinedOdds).toFixed(2)}×
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">{hasWon ? 'Won' : 'Potential'}</p>
            <p
              className={`font-semibold ${
                hasWon ? 'text-green-600' : hasLost ? 'text-red-500' : 'text-primary-600'
              }`}
            >
              {formatPoints(
                hasWon ? (accumulator.payout ?? accumulator.potentialPayout) : accumulator.potentialPayout
              )}{' '}
              pts
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-gray-100 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-gray-500">{statusDescription}</p>
          <Button variant="ghost" size="sm" onClick={() => setExpanded((prev) => !prev)}>
            {expanded ? 'Hide legs' : `Show ${accumulator.legs.length} legs`}
          </Button>
        </div>

        {expanded && (
          <div className="space-y-2">
            {accumulator.legs.map((leg) => (
              <AccumulatorLegRow key={leg.id} leg={leg} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function AccumulatorLegRow({ leg }: { leg: AccumulatorLeg }) {
  const icon =
    leg.status === 'WON'
      ? '✅'
      : leg.status === 'LOST'
        ? '❌'
        : leg.status === 'REFUNDED'
          ? '↩'
          : '⏳';

  const statusLabel =
    leg.status === 'WON'
      ? 'Won'
      : leg.status === 'LOST'
        ? 'Lost'
        : leg.status === 'REFUNDED'
          ? 'Refunded'
          : 'Pending';

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium text-gray-900">{leg.event?.title ?? leg.eventId}</p>
        <p className="text-xs text-gray-500">
          {leg.predictedOutcome} · {Number(leg.odds).toFixed(2)}×
        </p>
      </div>
      <span className="ml-3 shrink-0 text-sm text-gray-600">
        {icon} {statusLabel}
      </span>
    </div>
  );
}
