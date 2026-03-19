import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { useBetSlip } from '../context/BetSlipContext';
import { api } from '../lib/api';
import { formatDate, formatTokens, formatPoints, getStatusColor, impliedProbability, formatCountdown } from '../lib/utils';
import { Badge, Button, Card, Spinner } from '../components/ui';
import type { Event, EventStats, Prediction } from '../types';

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { success: showSuccess, error: showError, warning: showWarning } = useToast();
  const { addSelection } = useBetSlip();

  const [event, setEvent] = useState<Event | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [odds, setOdds] = useState<Event['currentOdds'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [userPrediction, setUserPrediction] = useState<Prediction | null>(null);

  useEffect(() => {
    if (!id) {
      return;
    }

    void loadEvent(id);
  }, [id]);

  const loadEvent = async (eventId: string) => {
    setIsLoading(true);
    setLoadError('');

    try {
      const [eventData, statsData] = await Promise.all([
        api.getEvent(eventId),
        api.getEventStats(eventId),
      ]);

      setEvent(eventData.event);
      setStats(statsData.stats);

      // Load user's prediction on this event (if any)
      try {
        const predsData = await api.getMyPredictions({ limit: 100 });
        const existing = predsData.predictions.find((p) => p.eventId === eventId);
        setUserPrediction(existing ?? null);
      } catch {
        // Non-critical
      }

      try {
        const oddsData = await api.getEventOdds(eventId);
        setOdds(oddsData.odds ?? eventData.event.currentOdds ?? null);
      } catch {
        setOdds(eventData.event.currentOdds ?? null);
        showWarning('Live odds are unavailable right now. Showing the latest saved odds instead.');
      }
    } catch (error) {
      setLoadError('Failed to load event. Please try again.');
      showError('Unable to load event details');
      console.error('Failed to load event', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddToSlip = (outcome: string) => {
    if (!event) {
      return;
    }

    const canPredict = event.status === 'OPEN' && event.startsAt ? new Date(event.startsAt).getTime() > Date.now() : false;
    if (!canPredict) {
      return;
    }

    const outcomeOdds =
      odds?.outcomes.find(
        (item) => item.name.trim().toLowerCase() === outcome.trim().toLowerCase()
      )?.price ?? event.payoutMultiplier;

    addSelection(event.id, event.title, outcome, outcomeOdds, {
      replaceExistingForEvent: true,
    });
    showSuccess(`Selected "${outcome}" for ${event.title}`);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="py-12 text-center">
        <p className="mb-4 text-red-600">{loadError}</p>
        <div className="flex justify-center gap-3">
          <Button onClick={() => id && loadEvent(id)}>Retry</Button>
          <Button variant="secondary" onClick={() => navigate('/events')}>
            Back to Events
          </Button>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-xl font-semibold text-gray-900">Event not found</h2>
        <Button className="mt-4" onClick={() => navigate('/events')}>
          Back to Events
        </Button>
      </div>
    );
  }

  const hasStarted = new Date(event.startsAt).getTime() <= Date.now();
  const canPredict = event.status === 'OPEN' && !hasStarted;

  // Check if odds are stale (> 30 min)
  const oddsStale = odds?.updatedAt
    ? Date.now() - new Date(odds.updatedAt).getTime() > 30 * 60 * 1000
    : false;

  // Find favourite (lowest odds = shortest price = most likely)
  const favouriteOutcome = odds?.outcomes?.length
    ? odds.outcomes.reduce((min, o) => (o.price < min.price ? o : min), odds.outcomes[0])
    : null;

  return (
    <div className="mx-auto max-w-4xl">
      <button
        onClick={() => navigate('/events')}
        className="mb-6 flex items-center text-gray-600 hover:text-gray-900"
      >
        ← Back to Events
      </button>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Event info card */}
          <Card>
            <div className="mb-4 flex items-start justify-between">
              <Badge className={getStatusColor(event.status)}>{event.status}</Badge>
              <span className="text-sm text-gray-500">{event._count?.predictions ?? 0} predictions</span>
            </div>

            <h1 className="mb-2 text-2xl font-bold text-gray-900">{event.title}</h1>

            {event.description && <p className="mb-4 text-gray-600">{event.description}</p>}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Starts at</span>
                <p className="font-medium">{formatDate(event.startsAt)}</p>
                {!hasStarted && (
                  <p className="text-xs text-primary-600">{formatCountdown(event.startsAt)}</p>
                )}
              </div>
              <div>
                <span className="text-gray-500">Base payout multiplier</span>
                <p className="font-medium text-green-600">{event.payoutMultiplier}x</p>
              </div>
            </div>

            {event.finalOutcome && (
              <div className="mt-4 rounded-lg bg-green-50 p-4">
                <p className="text-green-800">
                  <span className="font-semibold">Final Result:</span> {event.finalOutcome}
                </p>
              </div>
            )}
          </Card>

          {/* Live Odds Display (Task 3.3) */}
          {odds?.outcomes && odds.outcomes.length > 0 && (
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Odds</h2>
                {oddsStale && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
                    Odds may be delayed
                  </span>
                )}
              </div>

              <div className="space-y-4">
                {odds.outcomes.map((outcome) => {
                  const probability = impliedProbability(outcome.price);
                  const isFavourite = favouriteOutcome?.name === outcome.name;

                  return (
                    <div key={outcome.name}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{outcome.name}</span>
                          {isFavourite && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                              Favourite
                            </span>
                          )}
                        </div>
                        <span className="text-lg font-bold text-gray-900">
                          {outcome.price.toFixed(2)}
                        </span>
                      </div>

                      {/* Implied probability bar */}
                      <div className="flex items-center gap-3">
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isFavourite ? 'bg-primary-500' : 'bg-gray-300'
                            }`}
                            style={{ width: `${Math.min(probability, 100)}%` }}
                          />
                        </div>
                        <span className="w-12 text-right text-xs text-gray-500">
                          {probability.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {odds.updatedAt && (
                <p className="mt-4 text-xs text-gray-400">
                  Updated {formatDate(odds.updatedAt)}
                </p>
              )}
            </Card>
          )}

          {/* Prediction Distribution */}
          {stats && (
            <Card>
              <h2 className="mb-4 font-semibold text-gray-900">Prediction Distribution</h2>
              <div className="space-y-3">
                {event.outcomes.map((outcome) => {
                  const outcomeStat = stats.outcomes.find((item) => item.outcome === outcome);
                  const percentage =
                    stats.totalPredictions > 0
                      ? ((outcomeStat?.count ?? 0) / stats.totalPredictions) * 100
                      : 0;

                  return (
                    <div key={outcome}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-gray-700">{outcome}</span>
                        <span className="text-gray-500">
                          {outcomeStat?.count ?? 0} ({percentage.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-primary-500 transition-all"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-4 text-sm text-gray-500">
                Total staked: {formatTokens(stats.totalStaked)} tokens
              </p>
            </Card>
          )}

          {/* User's prediction confirmation card */}
          {userPrediction && (
            <Card className="border-primary-200 bg-primary-50/50">
              <h2 className="mb-3 font-semibold text-primary-900">Your Prediction</h2>
              <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-primary-600/70">Your pick</p>
                  <p className="font-bold text-primary-900">{userPrediction.predictedOutcome}</p>
                </div>
                <div>
                  <p className="text-xs text-primary-600/70">Stake</p>
                  <p className="font-bold text-primary-900">
                    {formatTokens(userPrediction.stakeAmount)} tokens
                  </p>
                </div>
                <div>
                  <p className="text-xs text-primary-600/70">Potential payout</p>
                  <p className="font-bold text-green-700">
                    {formatPoints(
                      Math.floor(
                        userPrediction.stakeAmount *
                          (userPrediction.originalOdds
                            ? Number(userPrediction.originalOdds)
                            : event.payoutMultiplier)
                      )
                    )}{' '}
                    pts
                  </p>
                </div>
                <div>
                  <p className="text-xs text-primary-600/70">Odds locked at</p>
                  <p className="font-bold text-primary-900">
                    {userPrediction.originalOdds
                      ? `${Number(userPrediction.originalOdds).toFixed(2)}x`
                      : `${event.payoutMultiplier}x`}
                  </p>
                </div>
              </div>
              <div className="mt-3">
                <Badge className={getStatusColor(userPrediction.status)}>
                  {userPrediction.status}
                </Badge>
              </div>
            </Card>
          )}
        </div>

        {/* Sidebar: Add to slip */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <h2 className="mb-4 font-semibold text-gray-900">
              {canPredict ? 'Add selections to slip' : 'Betting Closed'}
            </h2>

            {!canPredict && (
              <p className="mb-4 text-sm text-gray-500">
                {event.status === 'SETTLED'
                  ? 'This event has already been settled.'
                  : event.status === 'CANCELLED'
                    ? 'This event was cancelled.'
                    : hasStarted
                      ? 'This event has already started.'
                      : 'Betting is currently locked.'}
              </p>
            )}

            <div className="space-y-3">
              {event.outcomes.map((outcome) => {
                const outcomeOdds =
                  odds?.outcomes.find(
                    (item) => item.name.trim().toLowerCase() === outcome.trim().toLowerCase()
                  )?.price ?? event.payoutMultiplier;

                const isUserPick = userPrediction?.predictedOutcome === outcome;

                return (
                  <div
                    key={outcome}
                    className={`rounded-lg border p-3 ${
                      isUserPick
                        ? 'border-primary-300 bg-primary-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {outcome}
                        {isUserPick && (
                          <span className="ml-2 text-xs text-primary-600">Your pick</span>
                        )}
                      </span>
                      <span className="text-sm text-green-700">{outcomeOdds.toFixed(2)}x</span>
                    </div>
                    <Button
                      className="w-full"
                      size="sm"
                      onClick={() => handleAddToSlip(outcome)}
                      disabled={!canPredict}
                    >
                      Add to Slip
                    </Button>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
