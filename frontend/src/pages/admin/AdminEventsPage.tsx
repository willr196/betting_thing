import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Button, Card, Badge, FilterChip, Spinner, InlineError } from '../../components/ui';
import type { AdminEvent, EventStatus } from '../../types';

const STATUS_FILTERS: { label: string; value: string | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Open', value: 'OPEN' },
  { label: 'Locked', value: 'LOCKED' },
  { label: 'Settled', value: 'SETTLED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

const STATUS_COLORS: Record<EventStatus, string> = {
  OPEN: 'bg-green-100 text-green-800',
  LOCKED: 'bg-yellow-100 text-yellow-800',
  SETTLED: 'bg-gray-100 text-gray-600',
  CANCELLED: 'bg-red-100 text-red-800',
};

const PAGE_SIZE = 20;

export function AdminEventsPage() {
  const toast = useToast();
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [settleModalEvent, setSettleModalEvent] = useState<AdminEvent | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await api.getAdminEvents(PAGE_SIZE, offset, statusFilter);
      setEvents(result.events);
      setTotal(result.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [offset, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFilterChange = (value: string | undefined) => {
    setStatusFilter(value);
    setOffset(0);
  };

  const handleLock = async (eventId: string) => {
    setActionLoading(eventId);
    try {
      await api.lockEvent(eventId);
      toast.success('Event locked');
      loadData();
    } catch {
      toast.error('Failed to lock event');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (eventId: string) => {
    setActionLoading(eventId);
    try {
      const result = await api.cancelEvent(eventId);
      toast.success(`Event cancelled. ${result.cancellation.refunded} predictions refunded.`);
      loadData();
    } catch {
      toast.error('Failed to cancel event');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSettle = async () => {
    if (!settleModalEvent || !selectedOutcome) return;
    setActionLoading(settleModalEvent.id);
    try {
      const result = await api.settleEvent(settleModalEvent.id, selectedOutcome);
      const s = result.settlement;
      toast.success(
        `Settled: ${s.winners ?? 0} winners, ${s.losers ?? 0} losers`
      );
      setSettleModalEvent(null);
      setSelectedOutcome('');
      loadData();
    } catch {
      toast.error('Failed to settle event');
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Events</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <FilterChip
            key={f.label}
            active={statusFilter === f.value}
            onClick={() => handleFilterChange(f.value)}
          >
            {f.label}
          </FilterChip>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <InlineError message="Failed to load events" onRetry={loadData} />
      ) : events.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-gray-500">No events found</p>
        </Card>
      ) : (
        <>
          {/* Event table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-3">Title</th>
                  <th className="px-3 py-3">Sport</th>
                  <th className="px-3 py-3">Starts At</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Predictions</th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    expanded={expandedId === event.id}
                    onToggle={() =>
                      setExpandedId(expandedId === event.id ? null : event.id)
                    }
                    onLock={() => handleLock(event.id)}
                    onCancel={() => handleCancel(event.id)}
                    onSettle={() => {
                      setSettleModalEvent(event);
                      setSelectedOutcome(event.outcomes[0] || '');
                    }}
                    isActionLoading={actionLoading === event.id}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Page {currentPage} of {totalPages} ({total} events)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Settle modal */}
      {settleModalEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-md bg-white">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Settle: {settleModalEvent.title}
            </h2>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Select winning outcome
            </label>
            <select
              value={selectedOutcome}
              onChange={(e) => setSelectedOutcome(e.target.value)}
              className="mb-4 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {settleModalEvent.outcomes.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSettleModalEvent(null);
                  setSelectedOutcome('');
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                isLoading={actionLoading === settleModalEvent.id}
                onClick={handleSettle}
                disabled={!selectedOutcome}
              >
                Confirm Settlement
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function EventRow({
  event,
  expanded,
  onToggle,
  onLock,
  onCancel,
  onSettle,
  isActionLoading,
}: {
  event: AdminEvent;
  expanded: boolean;
  onToggle: () => void;
  onLock: () => void;
  onCancel: () => void;
  onSettle: () => void;
  isActionLoading: boolean;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
        onClick={onToggle}
      >
        <td className="px-3 py-3 font-medium text-gray-900">{event.title}</td>
        <td className="px-3 py-3 text-gray-500">
          {event.externalSportKey?.replace('soccer_', '').replace(/_/g, ' ') || '—'}
        </td>
        <td className="px-3 py-3 text-gray-500">
          {new Date(event.startsAt).toLocaleString()}
        </td>
        <td className="px-3 py-3">
          <Badge className={STATUS_COLORS[event.status]}>{event.status}</Badge>
        </td>
        <td className="px-3 py-3 text-gray-500">{event._count?.predictions ?? 0}</td>
        <td className="px-3 py-3">
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            {event.status === 'OPEN' && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  isLoading={isActionLoading}
                  onClick={onLock}
                >
                  Lock
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  isLoading={isActionLoading}
                  onClick={onCancel}
                >
                  Cancel
                </Button>
              </>
            )}
            {event.status === 'LOCKED' && (
              <>
                <Button size="sm" isLoading={isActionLoading} onClick={onSettle}>
                  Settle
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  isLoading={isActionLoading}
                  onClick={onCancel}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-100 bg-gray-50/50">
          <td colSpan={6} className="px-3 py-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs font-semibold uppercase text-gray-400">Outcomes</p>
                <ul className="mt-1 space-y-1">
                  {event.outcomes.map((o) => (
                    <li key={o} className="text-sm text-gray-700">
                      {o}
                      {event.finalOutcome === o && (
                        <span className="ml-1 text-green-600 font-semibold">(Winner)</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-400">Details</p>
                <p className="mt-1 text-sm text-gray-600">
                  Payout multiplier: {event.payoutMultiplier}x
                </p>
                {event.description && (
                  <p className="mt-1 text-sm text-gray-500">{event.description}</p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-400">IDs</p>
                <p className="mt-1 text-xs text-gray-400 break-all">ID: {event.id}</p>
                {event.externalEventId && (
                  <p className="mt-0.5 text-xs text-gray-400 break-all">
                    Ext: {event.externalEventId}
                  </p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
