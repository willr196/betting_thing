import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatDate, formatTokens, formatPoints, getStatusColor } from '../lib/utils';
import { Card, Badge, Button, Input, Spinner } from '../components/ui';
import type { Event, EventStats } from '../types';

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();

  const [event, setEvent] = useState<Event | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [odds, setOdds] = useState<Event['currentOdds'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [stakeAmount, setStakeAmount] = useState('5');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (id) {
      loadEvent();
    }
  }, [id]);

  const loadEvent = async () => {
    if (!id) return;
    
    setIsLoading(true);
    try {
      const [eventData, statsData] = await Promise.all([
        api.getEvent(id),
        api.getEventStats(id),
      ]);
      setEvent(eventData.event);
      setStats(statsData.stats);
      try {
        const oddsData = await api.getEventOdds(id);
        setOdds(oddsData.odds ?? eventData.event.currentOdds ?? null);
      } catch (error) {
        setOdds(eventData.event.currentOdds ?? null);
      }
    } catch (error) {
      console.error('Failed to load event:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!event || !selectedOutcome || !stakeAmount) return;

    const stake = parseInt(stakeAmount);
    if (isNaN(stake) || stake < 1 || stake > 35) {
      setError('Stake must be a number between 1 and 35');
      return;
    }

    setError('');
    setSuccess('');
    setIsSubmitting(true);

    try {
      await api.placePrediction(event.id, selectedOutcome, stake);
      setSuccess('Prediction placed successfully!');
      await refreshUser();

      // Redirect after short delay
      const timer = setTimeout(() => navigate('/predictions'), 1500);
      return () => clearTimeout(timer);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to place prediction');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Event not found</h2>
        <Button className="mt-4" onClick={() => navigate('/events')}>
          Back to Events
        </Button>
      </div>
    );
  }

  const isOpen = event.status === 'OPEN';
  const hasStarted = new Date(event.startsAt).getTime() < Date.now();
  const canPredict = isOpen && !hasStarted;
  const selectedOdds = odds?.outcomes.find(
    (outcome) =>
      outcome.name.trim().toLowerCase() === (selectedOutcome ?? '').trim().toLowerCase()
  )?.price;
  const parsedStake = parseInt(stakeAmount || '0');
  const potentialWin = isNaN(parsedStake) ? 0 : Math.floor(
    parsedStake * (selectedOdds ?? event.payoutMultiplier)
  );

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => navigate('/events')}
        className="flex items-center text-gray-600 hover:text-gray-900 mb-6"
      >
        ← Back to Events
      </button>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Event Details */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <div className="flex items-start justify-between mb-4">
              <Badge className={getStatusColor(event.status)}>{event.status}</Badge>
              <span className="text-sm text-gray-500">
                {event._count?.predictions ?? 0} predictions
              </span>
            </div>

            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {event.title}
            </h1>

            {event.description && (
              <p className="text-gray-600 mb-4">{event.description}</p>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Starts at</span>
                <p className="font-medium">{formatDate(event.startsAt)}</p>
              </div>
              <div>
                <span className="text-gray-500">Payout Multiplier</span>
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
              <div className="mt-4 p-4 bg-green-50 rounded-lg">
                <p className="text-green-800">
                  <span className="font-semibold">🏆 Final Result:</span>{' '}
                  {event.finalOutcome}
                </p>
              </div>
            )}
          </Card>

          {/* Outcome Stats */}
          {stats && (
            <Card>
              <h2 className="font-semibold text-gray-900 mb-4">
                Prediction Distribution
              </h2>
              <div className="space-y-3">
                {event.outcomes.map((outcome) => {
                  const outcomeStat = stats.outcomes.find(
                    (o) => o.outcome === outcome
                  );
                  const percentage =
                    stats.totalPredictions > 0
                      ? ((outcomeStat?.count ?? 0) / stats.totalPredictions) * 100
                      : 0;

                  return (
                    <div key={outcome}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-700">{outcome}</span>
                        <span className="text-gray-500">
                          {outcomeStat?.count ?? 0} ({percentage.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary-500 rounded-full transition-all"
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

        {/* Prediction Form */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <h2 className="font-semibold text-gray-900 mb-4">
              {canPredict ? 'Make Your Prediction' : 'Predictions Closed'}
            </h2>

            {!canPredict && (
              <p className="text-sm text-gray-500 mb-4">
                {event.status === 'SETTLED'
                  ? 'This event has been settled.'
                  : event.status === 'CANCELLED'
                  ? 'This event was cancelled.'
                  : hasStarted
                  ? 'This event has already started.'
                  : 'Predictions are currently locked.'}
              </p>
            )}

            {canPredict && (
              <>
                {error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-600">
                    {success}
                  </div>
                )}

                {/* Outcome Selection */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Outcome
                  </label>
                  <div className="space-y-2">
                    {event.outcomes.map((outcome) => (
                      <button
                        key={outcome}
                        onClick={() => setSelectedOutcome(outcome)}
                        className={`w-full p-3 text-left rounded-lg border-2 transition-colors ${
                          selectedOutcome === outcome
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span className="font-medium">{outcome}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stake Amount */}
                <div className="mb-4">
                  <Input
                    label="Stake Amount"
                    type="number"
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    min={1}
                    max={35}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Min: 1 • Max: 35 • Your balance: {formatTokens(user?.tokenBalance ?? 0)}
                  </p>
                </div>

                {/* Potential Win */}
                <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">Potential win</p>
                  <p className="text-xl font-bold text-green-600">
                    {formatPoints(potentialWin)} points
                  </p>
                </div>

                {/* Submit */}
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleSubmit}
                  disabled={!selectedOutcome || !stakeAmount || isSubmitting}
                  isLoading={isSubmitting}
                >
                  Place Prediction
                </Button>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
