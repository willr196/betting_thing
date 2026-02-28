import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, formatTokens, formatPoints, getStatusColor } from '../lib/utils';
import { Card, Badge, Spinner, EmptyState, StatCard, Button } from '../components/ui';
import type { Prediction, PredictionStats } from '../types';

export function PredictionsPage() {
  const POLL_INTERVAL_MS = 60_000;

  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [stats, setStats] = useState<PredictionStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'PENDING' | 'WON' | 'LOST' | 'CASHED_OUT'>('all');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasPending = predictions.some((p) => p.status === 'PENDING');

  // Update the "X seconds ago" counter every second when there are pending predictions.
  useEffect(() => {
    if (!lastUpdated || !hasPending) return;
    const tick = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [lastUpdated, hasPending]);

  // Poll every 60s when there are PENDING predictions.
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!hasPending) return;
    intervalRef.current = setInterval(() => {
      loadData(true);
    }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [hasPending]);

  useEffect(() => {
    loadData();
  }, [filter]);

  const loadData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError('');
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
    } catch (err) {
      if (!silent) setError('Failed to load predictions. Please try again.');
      console.error('Failed to load predictions:', err);
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Predictions</h1>
          <p className="text-gray-600 mt-1">Track your predictions and winnings</p>
        </div>
        {hasPending && lastUpdated && (
          <p className="text-xs text-gray-400 mt-1 shrink-0">
            Updated {secondsAgo}s ago
          </p>
        )}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          <StatCard
            label="Total Predictions"
            value={stats.total}
          />
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
          <StatCard
            label="Pending"
            value={stats.pending}
            subValue="awaiting result"
          />
          <StatCard
            label="Cashed Out"
            value={stats.cashedOut}
            subValue="closed early"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {(['all', 'PENDING', 'WON', 'LOST', 'CASHED_OUT'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              filter === f
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-red-600 mb-4">{error}</p>
          <Button onClick={loadData}>Retry</Button>
        </div>
      ) : predictions.length === 0 ? (
        <EmptyState
          title="No predictions yet"
          description="Browse events and make your first prediction"
          action={
            <Link to="/events">
              <Button>Browse Events</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {predictions.map((prediction) => (
            <PredictionCard key={prediction.id} prediction={prediction} onCashout={loadData} />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PREDICTION CARD
// =============================================================================

function PredictionCard({ prediction, onCashout }: { prediction: Prediction; onCashout: () => void }) {
  const isWon = prediction.status === 'WON';
  const isLost = prediction.status === 'LOST';
  const isPending = prediction.status === 'PENDING';
  const isCashedOut = prediction.status === 'CASHED_OUT';
  const [cashoutValue, setCashoutValue] = useState<number | null>(null);
  const [cashoutLoading, setCashoutLoading] = useState(false);
  const [cashoutError, setCashoutError] = useState<string | null>(null);

  const handleCashoutValue = async () => {
    setCashoutLoading(true);
    setCashoutError(null);
    try {
      const result = await api.getCashoutValue(prediction.id);
      setCashoutValue(result.cashoutValue);
    } catch (error) {
      setCashoutError('Unable to fetch cashout value');
    } finally {
      setCashoutLoading(false);
    }
  };

  const handleCashout = async () => {
    setCashoutLoading(true);
    setCashoutError(null);
    try {
      await api.cashoutPrediction(prediction.id);
      onCashout();
    } catch (error) {
      setCashoutError('Cashout failed');
    } finally {
      setCashoutLoading(false);
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Event info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Badge className={getStatusColor(prediction.status)}>
              {prediction.status}
            </Badge>
            {prediction.event && (
              <Badge className={getStatusColor(prediction.event.status)}>
                Event: {prediction.event.status}
              </Badge>
            )}
          </div>

          <h3 className="font-semibold text-gray-900 truncate">
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
                Result:{' '}
                <span className="font-medium">{prediction.event.finalOutcome}</span>
              </p>
            )}
          </div>

          <p className="mt-1 text-xs text-gray-500">
            Placed {formatDate(prediction.createdAt)}
          </p>
        </div>

        {/* Right: Stake & Payout */}
        <div className="text-right sm:min-w-[140px]">
          <p className="text-sm text-gray-500">Stake</p>
          <p className="font-semibold text-gray-900">
            {formatTokens(prediction.stakeAmount)} tokens
          </p>

          {isWon && prediction.payout && (
            <div className="mt-2">
              <p className="text-sm text-green-600">Won</p>
              <p className="font-bold text-green-600 text-lg">
                +{formatPoints(prediction.payout)} points
              </p>
            </div>
          )}

          {isLost && (
            <div className="mt-2">
              <p className="text-sm text-red-600">Lost</p>
              <p className="font-bold text-red-600">
                -{formatTokens(prediction.stakeAmount)}
              </p>
            </div>
          )}

          {isCashedOut && (
            <div className="mt-2">
              <p className="text-sm text-amber-600">Cashed out</p>
              <p className="font-bold text-amber-600 text-lg">
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
                      (prediction.originalOdds ? Number(prediction.originalOdds) : prediction.event.payoutMultiplier)
                  )
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      {isPending && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={handleCashoutValue}
              disabled={cashoutLoading}
            >
              {cashoutValue === null ? 'Check Cashout' : `Cashout: ${formatPoints(cashoutValue)}`}
            </Button>
            <Button
              onClick={handleCashout}
              disabled={cashoutLoading || cashoutValue === null || cashoutValue <= 0}
            >
              Cash Out
            </Button>
            {cashoutError && (
              <span className="text-xs text-red-500">{cashoutError}</span>
            )}
          </div>
        </div>
      )}

      {/* View event link */}
      {prediction.event && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <Link
            to={`/events/${prediction.eventId}`}
            className="text-sm text-primary-600 hover:underline"
          >
            View event details →
          </Link>
        </div>
      )}
    </Card>
  );
}
