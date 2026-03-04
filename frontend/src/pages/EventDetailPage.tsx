import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { useBetSlip } from '../context/BetSlipContext';
import { api } from '../lib/api';
import { formatDate, formatTokens, getStatusColor } from '../lib/utils';
import { Badge, Button, Card, Spinner } from '../components/ui';
import type { Event, EventStats } from '../types';

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { success: showSuccess } = useToast();
  const { addSelection } = useBetSlip();

  const [event, setEvent] = useState<Event | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [odds, setOdds] = useState<Event['currentOdds'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

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

      try {
        const oddsData = await api.getEventOdds(eventId);
        setOdds(oddsData.odds ?? eventData.event.currentOdds ?? null);
      } catch {
        setOdds(eventData.event.currentOdds ?? null);
      }
    } catch (error) {
      setLoadError('Failed to load event. Please try again.');
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

    addSelection(event.id, event.title, outcome, outcomeOdds);
    showSuccess(`Added "${outcome}" to your bet slip`);
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
              </div>
              <div>
                <span className="text-gray-500">Base payout multiplier</span>
                <p className="font-medium text-green-600">{event.payoutMultiplier}x</p>
              </div>
            </div>

            {odds?.outcomes && odds.outcomes.length > 0 && (
              <div className="mt-4 text-sm text-gray-600">
                <span className="font-medium">Live odds:</span>{' '}
                {odds.outcomes.map((outcome) => (
                  <span key={outcome.name} className="mr-2">
                    {outcome.name} ({outcome.price})
                  </span>
                ))}
              </div>
            )}

            {event.finalOutcome && (
              <div className="mt-4 rounded-lg bg-green-50 p-4">
                <p className="text-green-800">
                  <span className="font-semibold">Final Result:</span> {event.finalOutcome}
                </p>
              </div>
            )}
          </Card>

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
        </div>

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

                return (
                  <div key={outcome} className="rounded-lg border border-gray-200 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900">{outcome}</span>
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
