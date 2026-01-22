import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, formatRelativeTime, getStatusColor } from '../lib/utils';
import { Card, Badge, Spinner, EmptyState, Button } from '../components/ui';
import type { Event } from '../types';

export function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'OPEN' | 'LOCKED' | 'SETTLED'>('all');

  useEffect(() => {
    loadEvents();
  }, [filter]);

  const loadEvents = async () => {
    setIsLoading(true);
    try {
      const params: { status?: string; limit: number } = { limit: 50 };
      if (filter !== 'all') {
        params.status = filter;
      }
      const data = await api.getEvents(params);
      setEvents(data.events);
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Events</h1>
          <p className="text-gray-600 mt-1">Choose an event and make your prediction</p>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mt-4 sm:mt-0">
          {(['all', 'OPEN', 'LOCKED', 'SETTLED'] as const).map((f) => (
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
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          title="No events found"
          description="Check back later for new prediction opportunities"
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
// EVENT CARD
// =============================================================================

function EventCard({ event }: { event: Event }) {
  const isOpen = event.status === 'OPEN';
  const startsAt = new Date(event.startsAt);
  const hasStarted = startsAt.getTime() < Date.now();

  return (
    <Card className="hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <Badge className={getStatusColor(event.status)}>{event.status}</Badge>
        {event._count && (
          <span className="text-xs text-gray-500">
            {event._count.predictions} predictions
          </span>
        )}
      </div>

      <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">
        {event.title}
      </h3>

      {event.description && (
        <p className="text-sm text-gray-600 mb-3 line-clamp-2">
          {event.description}
        </p>
      )}

      <div className="space-y-2 text-sm text-gray-500 mb-4">
        <div className="flex items-center gap-2">
          <span>📅</span>
          <span>{formatDate(event.startsAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>⏱️</span>
          <span>{hasStarted ? 'Started' : formatRelativeTime(event.startsAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>💰</span>
          <span>{event.payoutMultiplier}x payout</span>
        </div>
      </div>

      {/* Outcomes preview */}
      <div className="flex flex-wrap gap-1 mb-4">
        {event.outcomes.slice(0, 3).map((outcome, i) => (
          <span
            key={i}
            className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600"
          >
            {outcome}
          </span>
        ))}
        {event.outcomes.length > 3 && (
          <span className="px-2 py-0.5 text-xs text-gray-500">
            +{event.outcomes.length - 3} more
          </span>
        )}
      </div>

      {/* Final outcome if settled */}
      {event.finalOutcome && (
        <div className="mb-4 p-2 bg-green-50 rounded-lg text-sm">
          <span className="text-green-700">
            🏆 Result: <strong>{event.finalOutcome}</strong>
          </span>
        </div>
      )}

      <Link to={`/events/${event.id}`}>
        <Button
          variant={isOpen ? 'primary' : 'secondary'}
          className="w-full"
        >
          {isOpen ? 'Make Prediction' : 'View Details'}
        </Button>
      </Link>
    </Card>
  );
}
