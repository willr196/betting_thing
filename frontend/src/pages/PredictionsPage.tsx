import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatDate, formatPoints, formatTokens, getStatusColor } from '../lib/utils';
import { Badge, Button, Card, EmptyState, Spinner, StatCard } from '../components/ui';
import type { Accumulator, AccumulatorLeg, Prediction, PredictionStats } from '../types';

export function PredictionsPage() {
  const POLL_INTERVAL_MS = 60_000;
  const { refreshUser } = useAuth();
  const { success: showSuccess, error: showError } = useToast();

  const [activeTab, setActiveTab] = useState<'singles' | 'accumulators'>('singles');

  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [stats, setStats] = useState<PredictionStats | null>(null);
  const [singlesLoading, setSinglesLoading] = useState(true);
  const [singlesError, setSinglesError] = useState('');
  const [filter, setFilter] = useState<'all' | 'PENDING' | 'WON' | 'LOST' | 'CASHED_OUT'>('all');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);

  const [accumulators, setAccumulators] = useState<Accumulator[]>([]);
  const [accumulatorsLoading, setAccumulatorsLoading] = useState(false);
  const [accumulatorsError, setAccumulatorsError] = useState('');

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasPendingSingles = predictions.some((prediction) => prediction.status === 'PENDING');

  useEffect(() => {
    if (!lastUpdated || !hasPendingSingles) {
      return;
    }

    const tick = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
    }, 1000);

    return () => clearInterval(tick);
  }, [hasPendingSingles, lastUpdated]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!hasPendingSingles) {
      return;
    }

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
    if (!silent) {
      setSinglesLoading(true);
    }

    setSinglesError('');

    try {
      const params: { status?: string; limit: number } = { limit: 50 };
      if (filter !== 'all') {
        params.status = filter;
      }

      const [predictionsData, statsData] = await Promise.all([
        api.getMyPredictions(params),
        api.getMyPredictionStats(),
      ]);

      setPredictions(predictionsData.predictions);
      setStats(statsData.stats);
      setLastUpdated(new Date());
      setSecondsAgo(0);
    } catch (error) {
      if (!silent) {
        setSinglesError('Failed to load predictions. Please try again.');
        showError('Failed to load predictions');
      }
      console.error('Failed to load predictions', error);
    } finally {
      if (!silent) {
        setSinglesLoading(false);
      }
    }
  };

  const loadAccumulators = async () => {
    setAccumulatorsLoading(true);
    setAccumulatorsError('');

    try {
      const data = await api.getMyAccumulators({ limit: 50 });
      setAccumulators(data.accumulators);
    } catch (error) {
      setAccumulatorsError('Failed to load accumulators. Please try again.');
      showError('Failed to load accumulators');
      console.error('Failed to load accumulators', error);
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
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Bets</h1>
          <p className="mt-1 text-gray-600">Track your singles and accumulators</p>
        </div>
        {activeTab === 'singles' && hasPendingSingles && lastUpdated && (
          <p className="mt-1 shrink-0 text-xs text-gray-400">Updated {secondsAgo}s ago</p>
        )}
      </div>

      <div className="mb-6 flex gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('singles')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'singles'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Singles
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('accumulators')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'accumulators'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Accumulators
        </button>
      </div>

      {activeTab === 'singles' ? (
        <>
          {stats && (
            <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
              <StatCard label="Total Predictions" value={stats.total} />
              <StatCard
                label="Win Rate"
                value={`${stats.winRate.toFixed(1)}%`}
                subValue={`${stats.won}W - ${stats.lost}L`}
                trend={stats.winRate >= 50 ? 'up' : 'down'}
              />
              <StatCard
                label="Total Winnings"
                value={formatPoints(stats.totalWinnings)}
                subValue="points"
                trend="up"
              />
              <StatCard label="Pending" value={stats.pending} subValue="awaiting result" />
              <StatCard label="Cashed Out" value={stats.cashedOut} subValue="closed early" />
            </div>
          )}

          <div className="mb-6 flex gap-2">
            {(['all', 'PENDING', 'WON', 'LOST', 'CASHED_OUT'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  filter === value
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {value === 'all' ? 'All' : value.charAt(0) + value.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          {singlesLoading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : singlesError ? (
            <div className="py-12 text-center">
              <p className="mb-4 text-red-600">{singlesError}</p>
              <Button onClick={() => loadSingles()}>Retry</Button>
            </div>
          ) : predictions.length === 0 ? (
            <EmptyState
              title="No predictions yet"
              description="Browse events and add your first selection"
              action={
                <Link to="/events">
                  <Button>Browse Events</Button>
                </Link>
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
        <div className="py-12 text-center">
          <p className="mb-4 text-red-600">{accumulatorsError}</p>
          <Button onClick={() => loadAccumulators()}>Retry</Button>
        </div>
      ) : accumulators.length === 0 ? (
        <EmptyState
          title="No accumulators yet"
          description="Build a bet slip with at least two selections to place your first accumulator"
          action={
            <Link to="/events">
              <Button>Browse Events</Button>
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
          <div className="mb-2 flex items-center gap-2">
            <Badge className={getStatusColor(prediction.status)}>{prediction.status}</Badge>
            {prediction.event && (
              <Badge className={getStatusColor(prediction.event.status)}>
                Event: {prediction.event.status}
              </Badge>
            )}
          </div>

          <h3 className="truncate font-semibold text-gray-900">
            {prediction.event?.title ?? 'Unknown Event'}
          </h3>

          <div className="mt-2 text-sm text-gray-600">
            <p>
              Your pick:{' '}
              <span className={`font-medium ${isWon ? 'text-green-600' : isLost ? 'text-red-600' : ''}`}>
                {prediction.predictedOutcome}
              </span>
            </p>
            {prediction.event?.finalOutcome && (
              <p>
                Result: <span className="font-medium">{prediction.event.finalOutcome}</span>
              </p>
            )}
          </div>

          <p className="mt-1 text-xs text-gray-500">Placed {formatDate(prediction.createdAt)}</p>
        </div>

        <div className="text-right sm:min-w-[140px]">
          <p className="text-sm text-gray-500">Stake</p>
          <p className="font-semibold text-gray-900">{formatTokens(prediction.stakeAmount)} tokens</p>

          {isWon && prediction.payout && (
            <div className="mt-2">
              <p className="text-sm text-green-600">Won</p>
              <p className="text-lg font-bold text-green-600">+{formatPoints(prediction.payout)} points</p>
            </div>
          )}

          {isLost && (
            <div className="mt-2">
              <p className="text-sm text-red-600">Lost</p>
              <p className="font-bold text-red-600">-{formatTokens(prediction.stakeAmount)}</p>
            </div>
          )}

          {isCashedOut && (
            <div className="mt-2">
              <p className="text-sm text-amber-600">Cashed out</p>
              <p className="text-lg font-bold text-amber-600">
                +{formatPoints(prediction.cashoutAmount ?? 0)} points
              </p>
            </div>
          )}

          {isPending && prediction.event && (
            <div className="mt-2">
              <p className="text-sm text-gray-500">Potential win</p>
              <p className="font-medium text-primary-600">
                {formatPoints(
                  Math.floor(
                    prediction.stakeAmount *
                      (prediction.originalOdds
                        ? Number(prediction.originalOdds)
                        : prediction.event.payoutMultiplier)
                  )
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      {isPending && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={handleCashoutValue} disabled={cashoutLoading}>
              {cashoutValue === null ? 'Check Cashout' : `Cashout: ${formatPoints(cashoutValue)}`}
            </Button>
            <Button
              onClick={handleCashout}
              disabled={cashoutLoading || cashoutValue === null || cashoutValue <= 0}
            >
              Cash Out
            </Button>
          </div>
        </div>
      )}

      {prediction.event && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <Link to={`/events/${prediction.eventId}`} className="text-sm text-primary-600 hover:underline">
            View event details →
          </Link>
        </div>
      )}
    </Card>
  );
}

function AccumulatorCard({ accumulator }: { accumulator: Accumulator }) {
  const [expanded, setExpanded] = useState(false);

  const hasWon = accumulator.status === 'WON';
  const hasLost = accumulator.status === 'LOST';
  const isPending = accumulator.status === 'PENDING';

  return (
    <Card className="transition-shadow hover:shadow-md">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge className={getStatusColor(accumulator.status)}>{accumulator.status}</Badge>
            <span className="text-xs text-gray-500">Placed {formatDate(accumulator.createdAt)}</span>
          </div>
          <h3 className="font-semibold text-gray-900">{accumulator.legs.length}-Leg Accumulator</h3>
        </div>

        <div className="grid grid-cols-3 gap-4 text-right text-sm sm:min-w-[320px]">
          <div>
            <p className="text-gray-500">Stake</p>
            <p className="font-semibold text-gray-900">{formatTokens(accumulator.stakeAmount)}</p>
          </div>
          <div>
            <p className="text-gray-500">Odds</p>
            <p className="font-semibold text-gray-900">{Number(accumulator.combinedOdds).toFixed(2)}x</p>
          </div>
          <div>
            <p className="text-gray-500">Payout</p>
            <p
              className={`font-semibold ${
                hasWon ? 'text-green-600' : hasLost ? 'text-red-600' : 'text-primary-600'
              }`}
            >
              {formatPoints(hasWon ? accumulator.payout ?? accumulator.potentialPayout : accumulator.potentialPayout)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-gray-100 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-gray-600">
            {isPending
              ? 'Awaiting remaining legs'
              : hasWon
                ? 'Accumulator settled as winner'
                : hasLost
                  ? 'Accumulator has lost'
                  : 'Accumulator settled'}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setExpanded((previous) => !previous)}>
            {expanded ? 'Hide Legs' : 'Show Legs'}
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

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium text-gray-900">{leg.event?.title ?? leg.eventId}</p>
        <p className="text-gray-600">
          {leg.predictedOutcome} ({Number(leg.odds).toFixed(2)}x)
        </p>
      </div>
      <span className="ml-3 shrink-0 text-gray-700">
        {icon} {leg.status}
      </span>
    </div>
  );
}
