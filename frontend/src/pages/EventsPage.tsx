import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useBetSlip } from '../context/BetSlipContext';
import { useToast } from '../context/ToastContext';
import {
  formatDate,
  formatRelativeTime,
  formatCountdown,
  formatTokens,
  formatPoints,
  getStatusColor,
  isToday,
} from '../lib/utils';
import { Card, Badge, EmptyState, Button, FilterChip, InlineError } from '../components/ui';
import { SPORTS, getSportByKey } from '../lib/sports';
import type { Event, Prediction, LeaderboardEntry } from '../types';

export function EventsPage() {
  const { user, isAuthenticated } = useAuth();
  const { success: showSuccess } = useToast();
  const { addSelection } = useBetSlip();

  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'OPEN' | 'LOCKED' | 'SETTLED'>('all');
  const [sportFilter, setSportFilter] = useState<string>('all');

  // User's active predictions (to show "You predicted" badges)
  const [userPredictions, setUserPredictions] = useState<Prediction[]>([]);
  const [myRank, setMyRank] = useState<LeaderboardEntry | null>(null);
  const [streakCount, setStreakCount] = useState(0);
  const [todayPredictionCount, setTodayPredictionCount] = useState(0);

  useEffect(() => {
    void loadEvents();
  }, [filter]);

  // Load user context data (predictions, leaderboard rank)
  useEffect(() => {
    if (!isAuthenticated) return;

    async function loadUserContext() {
      try {
        const [predsData, rankData] = await Promise.all([
          api.getMyPredictions({ status: 'PENDING', limit: 100 }),
          api.getMyLeaderboardRank('all-time'),
        ]);
        setUserPredictions(predsData.predictions);
        setMyRank(rankData.rank);
        setStreakCount(rankData.rank?.currentStreak ?? 0);
      } catch {
        // Non-critical — page still works without this data
      }
    }

    void loadUserContext();
  }, [isAuthenticated]);

  const loadEvents = async () => {
    setIsLoading(true);
    setError('');
    try {
      const params: { status?: string; limit: number } = { limit: 50 };
      if (filter !== 'all') {
        params.status = filter;
      }
      const data = await api.getEvents(params);
      setEvents(data.events);
    } catch {
      setError('Events could not be loaded right now.');
    } finally {
      setIsLoading(false);
    }
  };

  // Derived data — apply sport filter client-side
  const sportFilteredEvents = sportFilter === 'all'
    ? events
    : events.filter((e) => e.externalSportKey === sportFilter);
  const openCount = events.filter((e) => e.status === 'OPEN').length;
  const todaysEvents = sportFilteredEvents.filter(
    (e) => isToday(e.startsAt) && (e.status === 'OPEN' || e.status === 'LOCKED')
  );
  const upcomingEvents = sportFilteredEvents.filter((e) => !isToday(e.startsAt));
  const predictionsByEventId = new Map(
    userPredictions.map((p) => [p.eventId, p])
  );

  // Count predictions on today's events
  useEffect(() => {
    const count = todaysEvents.filter((e) => predictionsByEventId.has(e.id)).length;
    setTodayPredictionCount(count);
  }, [todaysEvents.length, predictionsByEventId.size]);

  // Find next match date if no matches today
  const nextMatchDate = events
    .filter((e) => e.status === 'OPEN' && !isToday(e.startsAt) && new Date(e.startsAt) > new Date())
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0]?.startsAt;

  const handleQuickAdd = (event: Event, outcome: string) => {
    const outcomeOdds =
      event.currentOdds?.outcomes.find(
        (o) => o.name.trim().toLowerCase() === outcome.trim().toLowerCase()
      )?.price ?? event.payoutMultiplier;

    addSelection(event.id, event.title, outcome, outcomeOdds, {
      replaceExistingForEvent: true,
    });
    showSuccess(`Selected "${outcome}" for ${event.title}`);
  };

  return (
    <div>
      {/* Homepage Summary Card (Task 3.5) */}
      {isAuthenticated && user && !isLoading && (
        <Card className="mb-6 overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-primary-700 text-white">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold">
                Hey {user.email.split('@')[0]}!
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <span className="flex items-center gap-1">
                  <span className="text-lg">🪙</span>
                  <span className="font-semibold">{formatTokens(user.tokenBalance)}</span>
                  <span className="text-white/60">tokens</span>
                </span>
                <span className="text-white/30">|</span>
                <span className="flex items-center gap-1">
                  <span className="text-lg">🏆</span>
                  <span className="font-semibold">{formatPoints(user.pointsBalance)}</span>
                  <span className="text-white/60">points</span>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              {todaysEvents.length > 0 && (
                <div className="text-center">
                  <p className="text-2xl font-bold">{todayPredictionCount}/{todaysEvents.length}</p>
                  <p className="text-xs text-white/60">Today's picks</p>
                </div>
              )}
              {myRank && (
                <div className="text-center">
                  <p className="text-2xl font-bold">#{myRank.rank}</p>
                  <p className="text-xs text-white/60">Leaderboard</p>
                </div>
              )}
              {streakCount >= 2 && (
                <div className="text-center">
                  <p className="text-2xl font-bold">{streakCount}</p>
                  <p className="text-xs text-white/60">Win streak</p>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* How it works — shown for unauthenticated or new users */}
      {!isAuthenticated && <HowItWorksCard openCount={openCount} isLoading={isLoading} />}

      {/* Today's Matches (Task 3.2) */}
      {!isLoading && todaysEvents.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 text-lg font-bold text-gray-900">Today's Matches</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {todaysEvents.map((event) => {
              const existingPrediction = predictionsByEventId.get(event.id);
              return (
                <TodaysMatchCard
                  key={event.id}
                  event={event}
                  existingPrediction={existingPrediction}
                  onQuickAdd={handleQuickAdd}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* No matches today message */}
      {!isLoading && !error && todaysEvents.length === 0 && filter === 'all' && (
        <Card className="mb-6 text-center">
          <p className="text-sm text-gray-500">
            No matches today
            {nextMatchDate
              ? ` — next match ${formatRelativeTime(nextMatchDate)} (${formatDate(nextMatchDate)})`
              : ' — check back soon'}
          </p>
        </Card>
      )}

      {/* Upcoming / All Events */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">
            {todaysEvents.length > 0 ? 'Upcoming' : 'Events'}
          </h2>
        </div>

        {/* Status filters */}
        <div className="mb-3 flex flex-wrap gap-2">
          {(['all', 'OPEN', 'LOCKED', 'SETTLED'] as const).map((f) => (
            <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
            </FilterChip>
          ))}
        </div>

        {/* Sport filters */}
        {SPORTS.length > 1 && (
          <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
            <FilterChip active={sportFilter === 'all'} onClick={() => setSportFilter('all')}>
              All sports
            </FilterChip>
            {SPORTS.map((s) => (
              <FilterChip
                key={s.key}
                active={sportFilter === s.key}
                onClick={() => setSportFilter(s.key)}
              >
                <span className="mr-1">{s.emoji}</span>{s.shortName}
              </FilterChip>
            ))}
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <EventCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <InlineError message={error} onRetry={() => void loadEvents()} />
        ) : (todaysEvents.length > 0 ? upcomingEvents : sportFilteredEvents).length === 0 ? (
          <EmptyState
            title="No events right now"
            description="New prediction events are added regularly. Check back soon."
            action={
              filter !== 'all' || sportFilter !== 'all' ? (
                <Button variant="secondary" onClick={() => { setFilter('all'); setSportFilter('all'); }}>
                  Show all events
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(todaysEvents.length > 0 ? upcomingEvents : sportFilteredEvents).map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// TODAY'S MATCH CARD (prominent layout)
// =============================================================================

function TodaysMatchCard({
  event,
  existingPrediction,
  onQuickAdd,
}: {
  event: Event;
  existingPrediction?: Prediction;
  onQuickAdd: (event: Event, outcome: string) => void;
}) {
  const canPredict = event.status === 'OPEN' && new Date(event.startsAt).getTime() > Date.now();
  const kickoffTime = new Date(event.startsAt).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const sport = event.externalSportKey ? getSportByKey(event.externalSportKey) : undefined;

  // Parse team names from title (assumes "Team A vs Team B" or "Team A v Team B")
  const titleParts = event.title.split(/\s+(?:vs?\.?|[-–])\s+/i);
  const homeTeam = titleParts[0]?.trim() ?? event.title;
  const awayTeam = titleParts[1]?.trim() ?? '';

  return (
    <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
      {/* Kick-off time + sport badge */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge className={getStatusColor(event.status)}>
            {event.status === 'OPEN' ? 'Open' : 'Locked'}
          </Badge>
          {sport && (
            <span className="text-xs text-gray-400">{sport.emoji} {sport.shortName}</span>
          )}
        </div>
        <span className="text-lg font-bold text-gray-900">{kickoffTime}</span>
      </div>

      {/* Team names */}
      <div className="mb-4">
        {awayTeam ? (
          <div className="flex items-center justify-center gap-3">
            <span className="text-right text-lg font-bold text-gray-900">{homeTeam}</span>
            <span className="text-sm font-medium text-gray-400">vs</span>
            <span className="text-left text-lg font-bold text-gray-900">{awayTeam}</span>
          </div>
        ) : (
          <h3 className="text-center text-lg font-bold text-gray-900">{event.title}</h3>
        )}
      </div>

      {/* Inline odds */}
      {event.currentOdds?.outcomes && event.currentOdds.outcomes.length > 0 && (
        <div className="mb-4 flex justify-center gap-3">
          {event.currentOdds.outcomes.map((o) => (
            <div key={o.name} className="rounded-lg bg-gray-50 px-3 py-1.5 text-center text-xs">
              <span className="text-gray-500">{o.name}</span>
              <p className="font-bold text-gray-900">{o.price.toFixed(2)}</p>
            </div>
          ))}
        </div>
      )}

      {/* User's existing prediction or quick-predict buttons */}
      {existingPrediction ? (
        <div className="rounded-xl bg-primary-50 px-4 py-3 text-center">
          <p className="text-sm text-primary-700">
            You predicted: <span className="font-bold">{existingPrediction.predictedOutcome}</span>
          </p>
        </div>
      ) : canPredict ? (
        <div className="flex flex-wrap gap-2">
          {event.outcomes.map((outcome) => (
            <button
              key={outcome}
              onClick={() => onQuickAdd(event, outcome)}
              className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:border-primary-300 hover:bg-primary-50"
            >
              {outcome}
            </button>
          ))}
        </div>
      ) : (
        <Link
          to={`/events/${event.id}`}
          className="block w-full rounded-xl bg-gray-100 py-2.5 text-center text-sm font-semibold text-gray-600 hover:bg-gray-200"
        >
          View details
        </Link>
      )}

      {/* Countdown */}
      <div className="mt-3 text-center text-xs text-gray-400">
        {new Date(event.startsAt).getTime() > Date.now()
          ? `Starts ${formatCountdown(event.startsAt)}`
          : 'In progress'}
      </div>
    </Card>
  );
}

// =============================================================================
// HOW IT WORKS MODULE
// =============================================================================

function HowItWorksCard({ openCount, isLoading }: { openCount: number; isLoading: boolean }) {
  return (
    <Card className="mb-6 overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-primary-700 text-white">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/60">
            How it works
          </p>
          <h2 className="mt-1.5 text-xl font-bold text-white">
            Pick your outcomes. Earn points. Climb the board.
          </h2>
          <p className="mt-2 text-sm text-white/75">
            Browse open events below, choose an outcome, and place your prediction. Win points
            when you get it right.
          </p>
          {!isLoading && openCount > 0 && (
            <p className="mt-3 text-sm font-medium text-emerald-300">
              {openCount} {openCount === 1 ? 'event' : 'events'} open for predictions right now
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-5 sm:gap-6">
          <HowItWorksStep number="1" label="Pick an event" />
          <HowItWorksStep number="2" label="Choose an outcome" />
          <HowItWorksStep number="3" label="Win points" />
        </div>
      </div>
    </Card>
  );
}

function HowItWorksStep({ number, label }: { number: string; label: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-sm font-bold text-white">
        {number}
      </div>
      <p className="mt-2 text-xs font-medium text-white/70">{label}</p>
    </div>
  );
}

// =============================================================================
// EVENT CARD SKELETON
// =============================================================================

function EventCardSkeleton() {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="h-5 w-16 animate-pulse rounded-full bg-gray-100" />
        <div className="h-4 w-20 animate-pulse rounded bg-gray-100" />
      </div>
      <div className="mb-2 h-5 w-full animate-pulse rounded bg-gray-100" />
      <div className="mb-4 h-4 w-3/4 animate-pulse rounded bg-gray-100" />
      <div className="mb-4 space-y-2">
        <div className="h-3.5 w-1/2 animate-pulse rounded bg-gray-100" />
        <div className="h-3.5 w-2/5 animate-pulse rounded bg-gray-100" />
      </div>
      <div className="h-9 w-full animate-pulse rounded-lg bg-gray-100" />
    </Card>
  );
}

// =============================================================================
// EVENT CARD
// =============================================================================

function EventCard({ event }: { event: Event }) {
  const isOpen = event.status === 'OPEN';
  const isSettled = event.status === 'SETTLED';
  const startsAt = new Date(event.startsAt);
  const hasStarted = startsAt.getTime() < Date.now();
  const sport = event.externalSportKey ? getSportByKey(event.externalSportKey) : undefined;

  return (
    <Card className="flex flex-col transition-shadow hover:shadow-md">
      {/* Top row: status + sport badge + prediction count */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge className={getStatusColor(event.status)}>
            {event.status.charAt(0) + event.status.slice(1).toLowerCase()}
          </Badge>
          {sport && (
            <span className="text-xs text-gray-400">
              {sport.emoji} {sport.shortName}
            </span>
          )}
        </div>
        {event._count && event._count.predictions > 0 && (
          <span className="text-xs text-gray-400">
            {event._count.predictions} picks
          </span>
        )}
      </div>

      {/* Event title */}
      <h3 className="mb-1 line-clamp-2 flex-1 font-semibold text-gray-900">{event.title}</h3>

      {/* Description */}
      {event.description && (
        <p className="mb-3 line-clamp-2 text-sm text-gray-500">{event.description}</p>
      )}

      {/* Meta: timing + payout */}
      <div className="mb-4 space-y-1.5 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">📅</span>
          <span>{formatDate(event.startsAt)}</span>
        </div>
        {!hasStarted && (
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">⏱</span>
            <span>Starts {formatRelativeTime(event.startsAt)}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">✦</span>
          <span>{event.payoutMultiplier}× payout</span>
        </div>
      </div>

      {/* Inline odds (if available) */}
      {event.currentOdds?.outcomes && event.currentOdds.outcomes.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {event.currentOdds.outcomes.map((o) => (
            <span
              key={o.name}
              className="rounded-md bg-gray-50 px-2 py-0.5 text-xs text-gray-600"
            >
              {o.name} <span className="font-semibold">{o.price.toFixed(2)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Outcomes preview (fallback if no odds) */}
      {(!event.currentOdds?.outcomes || event.currentOdds.outcomes.length === 0) && (
        <div className="mb-4 flex flex-wrap gap-1">
          {event.outcomes.slice(0, 3).map((outcome, i) => (
            <span
              key={i}
              className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
            >
              {outcome}
            </span>
          ))}
          {event.outcomes.length > 3 && (
            <span className="px-1 text-xs text-gray-400">
              +{event.outcomes.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Settled result */}
      {isSettled && event.finalOutcome && (
        <div className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm">
          <span className="text-emerald-700">
            Result: <strong>{event.finalOutcome}</strong>
          </span>
        </div>
      )}

      {/* CTA */}
      <Link
        to={`/events/${event.id}`}
        className={`mt-auto block w-full rounded-xl py-2.5 text-center text-sm font-semibold transition-colors ${
          isOpen
            ? 'bg-primary-600 text-white hover:bg-primary-700'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        {isOpen ? 'Make a pick' : isSettled ? 'See results' : 'View details'}
      </Link>
    </Card>
  );
}
