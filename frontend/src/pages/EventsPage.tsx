import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, formatRelativeTime, getStatusColor } from '../lib/utils';
import { Card, Badge, EmptyState, Button, FilterChip, InlineError } from '../components/ui';
import type { Event } from '../types';

export function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'OPEN' | 'LOCKED' | 'SETTLED'>('all');

  useEffect(() => {
    void loadEvents();
  }, [filter]);

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

  const openCount = events.filter((e) => e.status === 'OPEN').length;

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Events</h1>
        <p className="mt-1 text-sm text-gray-500">
          Browse open events, pick an outcome, and add it to your slip.
        </p>
      </div>

      {/* How it works — always visible, never fails */}
      <HowItWorksCard openCount={openCount} isLoading={isLoading} />

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        {(['all', 'OPEN', 'LOCKED', 'SETTLED'] as const).map((f) => (
          <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
          </FilterChip>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <EventCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <InlineError message={error} onRetry={() => void loadEvents()} />
      ) : events.length === 0 ? (
        <EmptyState
          title="No events right now"
          description="New prediction events are added regularly. Check back soon."
          action={
            filter !== 'all' ? (
              <Button variant="secondary" onClick={() => setFilter('all')}>
                Show all events
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
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

  return (
    <Card className="flex flex-col transition-shadow hover:shadow-md">
      {/* Top row: status + prediction count */}
      <div className="mb-3 flex items-center justify-between">
        <Badge className={getStatusColor(event.status)}>
          {event.status.charAt(0) + event.status.slice(1).toLowerCase()}
        </Badge>
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

      {/* Outcomes preview */}
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
