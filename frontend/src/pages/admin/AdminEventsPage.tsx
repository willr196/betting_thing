import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import {
  Button,
  Card,
  Badge,
  FilterChip,
  Input,
  Spinner,
  InlineError,
} from '../../components/ui';
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

// ---------------------------------------------------------------------------
// Bulk import helpers
// ---------------------------------------------------------------------------

type BulkRow = {
  title: string;
  startsAt: string;
  outcomes: string[];
  odds: number[];
  description: string;
  error?: string;
};

function parseBulkPaste(text: string): BulkRow[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .map((line) => {
      // Support both tab (Google Sheets paste) and comma separated
      const sep = line.includes('\t') ? '\t' : ',';
      const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
      // Expected columns: Title | Date (YYYY-MM-DD or DD/MM/YYYY) | Time (HH:MM) | Outcomes (pipe-sep) | Odds (pipe-sep) | Description?
      const [titleRaw = '', dateRaw = '', timeRaw = '', outcomesRaw = '', oddsRaw = '', descRaw = ''] = cols;

      const title = titleRaw.trim();
      if (!title) return { title: '', startsAt: '', outcomes: [], odds: [], description: '', error: 'Missing title' };

      // Parse date — accept YYYY-MM-DD or DD/MM/YYYY
      let isoDate = dateRaw.trim();
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(isoDate)) {
        const [d, m, y] = isoDate.split('/');
        isoDate = `${y}-${m}-${d}`;
      }
      const time = timeRaw.trim() || '12:00';
      const startsAt = `${isoDate}T${time}:00`;
      if (isNaN(new Date(startsAt).getTime())) {
        return { title, startsAt: '', outcomes: [], odds: [], description: '', error: `Invalid date: "${dateRaw} ${timeRaw}"` };
      }

      const outcomes = outcomesRaw.split('|').map((o) => o.trim()).filter(Boolean);
      if (outcomes.length < 2) {
        return { title, startsAt, outcomes, odds: [], description: '', error: 'Need at least 2 outcomes (pipe-separated)' };
      }

      const odds = oddsRaw.split('|').map((o) => parseFloat(o.trim()));
      if (odds.length !== outcomes.length || odds.some((o) => !isFinite(o) || o <= 1)) {
        return { title, startsAt, outcomes, odds, description: '', error: 'Odds must match outcomes count and each be > 1' };
      }

      return { title, startsAt, outcomes, odds, description: descRaw.trim() };
    });
}

type EventFormRow = {
  id: string;
  name: string;
  price: string;
};

type EventFormState = {
  title: string;
  description: string;
  startsAt: string;
  payoutMultiplier: string;
  outcomes: EventFormRow[];
  detachFromExternalSource: boolean;
};

type EventPayload = {
  title: string;
  description?: string | null;
  startsAt?: string;
  outcomes: string[];
  payoutMultiplier: number;
  odds: Array<{ name: string; price: number }>;
  detachFromExternalSource: boolean;
};

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
  const [showEditor, setShowEditor] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AdminEvent | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [form, setForm] = useState<EventFormState>(createEmptyEventForm);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<BulkRow[] | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [staleCount, setStaleCount] = useState(0);

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
    void loadData();
  }, [loadData]);

  useEffect(() => {
    api.getStaleEvents().then((r) => setStaleCount(r.count)).catch(() => {});
  }, []);

  const handleBulkImport = async () => {
    if (!bulkPreview) return;
    const valid = bulkPreview.filter((r) => !r.error);
    if (!valid.length) return;
    setBulkLoading(true);
    try {
      const result = await api.bulkCreateEvents(
        valid.map((r) => ({
          title: r.title,
          description: r.description || undefined,
          startsAt: new Date(r.startsAt).toISOString(),
          outcomes: r.outcomes,
          payoutMultiplier: 2.0,
          odds: r.outcomes.map((name, i) => ({ name, price: r.odds[i] })),
        }))
      );
      toast.success(`Created ${result.count} events`);
      setShowBulkImport(false);
      setBulkPasteText('');
      setBulkPreview(null);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk import failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const editorLockedOutcomes = useMemo(
    () => (editingEvent?._count?.predictions ?? 0) > 0,
    [editingEvent]
  );

  const openCreateEditor = () => {
    setEditingEvent(null);
    setForm(createEmptyEventForm());
    setShowEditor(true);
  };

  const openEditEditor = (event: AdminEvent) => {
    setEditingEvent(event);
    setForm(eventToFormState(event));
    setShowEditor(true);
  };

  const closeEditor = () => {
    setShowEditor(false);
    setEditingEvent(null);
    setForm(createEmptyEventForm());
  };

  const handleFilterChange = (value: string | undefined) => {
    setStatusFilter(value);
    setOffset(0);
  };

  const handleLock = async (eventId: string) => {
    setActionLoading(eventId);
    try {
      await api.lockEvent(eventId);
      toast.success('Event locked');
      await loadData();
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
      await loadData();
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
      const settlement = result.settlement as {
        winners?: number;
        losers?: number;
      };
      toast.success(
        `Settled: ${settlement.winners ?? 0} winners, ${settlement.losers ?? 0} losers`
      );
      setSettleModalEvent(null);
      setSelectedOutcome('');
      await loadData();
    } catch {
      toast.error('Failed to settle event');
    } finally {
      setActionLoading(null);
    }
  };

  const updateForm = <K extends keyof EventFormState>(key: K, value: EventFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateOutcomeRow = (rowId: string, field: 'name' | 'price', value: string) => {
    setForm((current) => ({
      ...current,
      outcomes: current.outcomes.map((row) =>
        row.id === rowId ? { ...row, [field]: value } : row
      ),
    }));
  };

  const addOutcomeRow = () => {
    setForm((current) => ({
      ...current,
      outcomes: [...current.outcomes, createOutcomeRow('', current.payoutMultiplier || '2.0')],
    }));
  };

  const removeOutcomeRow = (rowId: string) => {
    setForm((current) => ({
      ...current,
      outcomes: current.outcomes.filter((row) => row.id !== rowId),
    }));
  };

  const handleEditorSubmit = async () => {
    const parsed = buildEventPayload(form, editingEvent);
    if (!parsed.ok) {
      toast.warning(parsed.message);
      return;
    }

    setEditorLoading(true);
    try {
      if (editingEvent) {
        await api.updateAdminEvent(editingEvent.id, parsed.payload);
        toast.success('Event updated');
      } else {
        await api.createAdminEvent({
          title: parsed.payload.title,
          description: parsed.payload.description ?? undefined,
          startsAt: parsed.payload.startsAt as string,
          outcomes: parsed.payload.outcomes,
          payoutMultiplier: parsed.payload.payoutMultiplier,
          odds: parsed.payload.odds,
          detachFromExternalSource: parsed.payload.detachFromExternalSource,
        });
        toast.success('Event created');
      }

      closeEditor();
      await loadData();
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : 'Failed to save event';
      toast.error(message);
    } finally {
      setEditorLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Events</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create local events, edit odds manually, and settle matches without the external
            odds feed.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowBulkImport(true)}>
            Bulk Import
          </Button>
          <Button size="sm" onClick={openCreateEditor}>
            Create Event
          </Button>
        </div>
      </div>

      <Card className="bg-slate-900 text-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/60">
              Manual Mode
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              Local-only odds stay usable from the database
            </h2>
          </div>
          <p className="max-w-2xl text-sm text-white/75">
            If you detach an event from the API, predictions and settlement continue to work off
            the saved event odds instead of live sync.
          </p>
        </div>
      </Card>

      {staleCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">{staleCount} locked {staleCount === 1 ? 'event' : 'events'} not yet settled</span>
          <button
            className="ml-auto text-amber-700 underline"
            onClick={() => handleFilterChange('LOCKED')}
          >
            View locked
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <FilterChip
            key={filter.label}
            active={statusFilter === filter.value}
            onClick={() => handleFilterChange(filter.value)}
          >
            {filter.label}
          </FilterChip>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <InlineError message="Failed to load events" onRetry={() => void loadData()} />
      ) : events.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-gray-500">No events found</p>
        </Card>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-3">Title</th>
                  <th className="px-3 py-3">Source</th>
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
                    onEdit={() => openEditEditor(event)}
                    onLock={() => void handleLock(event.id)}
                    onCancel={() => void handleCancel(event.id)}
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

      {showEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-h-[90vh] w-full max-w-4xl overflow-y-auto bg-white">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {editingEvent ? 'Edit Event' : 'Create Event'}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Set outcome names and prices directly in the admin panel.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={closeEditor}>
                Close
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Title"
                value={form.title}
                onChange={(e) => updateForm('title', e.target.value)}
                placeholder="Arsenal vs Chelsea"
              />
              <Input
                label="Base payout multiplier"
                type="number"
                min="1"
                max="10"
                step="0.01"
                value={form.payoutMultiplier}
                onChange={(e) => updateForm('payoutMultiplier', e.target.value)}
              />
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateForm('description', e.target.value)}
                  rows={3}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Competition, market notes, or admin context"
                />
              </div>
              <Input
                label="Starts at"
                type="datetime-local"
                value={form.startsAt}
                disabled={editingEvent?.status === 'LOCKED'}
                onChange={(e) => updateForm('startsAt', e.target.value)}
              />
              <label className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.detachFromExternalSource}
                  onChange={(e) =>
                    updateForm('detachFromExternalSource', e.target.checked)
                  }
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                Use local odds only and disconnect this event from API sync
              </label>
            </div>

            {editingEvent?.status === 'LOCKED' && (
              <p className="mt-3 text-sm text-amber-700">
                Locked events can still have prices adjusted for admin control, but their start
                time is fixed.
              </p>
            )}

            {editorLockedOutcomes && (
              <p className="mt-3 text-sm text-amber-700">
                Outcome names are locked because predictions already exist. You can still adjust
                the prices for those outcomes.
              </p>
            )}

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                  Outcomes And Odds
                </h3>
                {!editorLockedOutcomes && (
                  <Button variant="secondary" size="sm" onClick={addOutcomeRow}>
                    Add Outcome
                  </Button>
                )}
              </div>

              <div className="space-y-3">
                {form.outcomes.map((row, index) => (
                  <div
                    key={row.id}
                    className="grid gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
                  >
                    <Input
                      label={`Outcome ${index + 1}`}
                      value={row.name}
                      disabled={editorLockedOutcomes}
                      onChange={(e) => updateOutcomeRow(row.id, 'name', e.target.value)}
                      placeholder="Home Win"
                    />
                    <Input
                      label="Decimal odds"
                      type="number"
                      min="1.01"
                      step="0.01"
                      value={row.price}
                      onChange={(e) => updateOutcomeRow(row.id, 'price', e.target.value)}
                      placeholder="2.10"
                    />
                    <div className="flex items-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={editorLockedOutcomes || form.outcomes.length <= 2}
                        onClick={() => removeOutcomeRow(row.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={closeEditor}>
                Cancel
              </Button>
              <Button size="sm" isLoading={editorLoading} onClick={handleEditorSubmit}>
                {editingEvent ? 'Save Changes' : 'Create Event'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {showBulkImport && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <Card className="my-8 w-full max-w-4xl bg-white">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Bulk Import Events</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Paste rows directly from Google Sheets or enter CSV. One event per line.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setShowBulkImport(false); setBulkPreview(null); setBulkPasteText(''); }}>
                Close
              </Button>
            </div>

            <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500 font-mono">
              <p className="mb-1 font-semibold text-gray-600">Format (columns separated by Tab or comma):</p>
              <p>Title | Date (YYYY-MM-DD or DD/MM/YYYY) | Time (HH:MM) | Outcomes (pipe-separated) | Odds (pipe-separated) | Description (optional)</p>
              <p className="mt-2 text-gray-400">Example:</p>
              <p>Arsenal vs Chelsea	2026-05-10	15:00	Arsenal Win|Draw|Chelsea Win	2.10|3.40|3.80	Premier League</p>
            </div>

            <textarea
              className="mb-3 block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={8}
              placeholder="Paste from Google Sheets or type CSV rows here..."
              value={bulkPasteText}
              onChange={(e) => { setBulkPasteText(e.target.value); setBulkPreview(null); }}
            />

            <div className="flex gap-2 mb-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setBulkPreview(parseBulkPaste(bulkPasteText))}
                disabled={!bulkPasteText.trim()}
              >
                Preview
              </Button>
            </div>

            {bulkPreview && (
              <>
                <div className="mb-4 overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 text-gray-500 uppercase tracking-wide">
                        <th className="px-3 py-2">Title</th>
                        <th className="px-3 py-2">Starts At</th>
                        <th className="px-3 py-2">Outcomes</th>
                        <th className="px-3 py-2">Odds</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkPreview.map((row, i) => (
                        <tr key={i} className={`border-b border-gray-100 ${row.error ? 'bg-red-50' : 'bg-white'}`}>
                          <td className="px-3 py-2 font-medium text-gray-900">{row.title || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{row.startsAt ? new Date(row.startsAt).toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{row.outcomes.join(', ') || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{row.odds.join(', ') || '—'}</td>
                          <td className="px-3 py-2">
                            {row.error
                              ? <span className="text-red-600 font-medium">{row.error}</span>
                              : <span className="text-green-600 font-medium">OK</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    {bulkPreview.filter((r) => !r.error).length} valid / {bulkPreview.length} total
                  </p>
                  <Button
                    size="sm"
                    isLoading={bulkLoading}
                    disabled={!bulkPreview.some((r) => !r.error)}
                    onClick={() => void handleBulkImport()}
                  >
                    Import {bulkPreview.filter((r) => !r.error).length} Events
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {settleModalEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
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
              {settleModalEvent.outcomes.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {outcome}
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
                onClick={() => void handleSettle()}
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
  onEdit,
  onLock,
  onCancel,
  onSettle,
  isActionLoading,
}: {
  event: AdminEvent;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onLock: () => void;
  onCancel: () => void;
  onSettle: () => void;
  isActionLoading: boolean;
}) {
  const outcomePrices = getOutcomePrices(event);
  const isLocalOnly = !event.externalEventId || !event.externalSportKey;
  const canEdit = event.status === 'OPEN' || event.status === 'LOCKED';

  return (
    <>
      <tr
        className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
        onClick={onToggle}
      >
        <td className="px-3 py-3 font-medium text-gray-900">{event.title}</td>
        <td className="px-3 py-3">
          <Badge
            className={
              isLocalOnly
                ? 'bg-slate-900 text-white'
                : 'bg-blue-50 text-blue-700'
            }
          >
            {isLocalOnly ? 'Local only' : 'API linked'}
          </Badge>
        </td>
        <td className="px-3 py-3 text-gray-500">
          {new Date(event.startsAt).toLocaleString()}
        </td>
        <td className="px-3 py-3">
          <Badge className={STATUS_COLORS[event.status]}>{event.status}</Badge>
        </td>
        <td className="px-3 py-3 text-gray-500">{event._count?.predictions ?? 0}</td>
        <td className="px-3 py-3">
          <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={onEdit}>
                Edit
              </Button>
            )}
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs font-semibold uppercase text-gray-400">Outcomes</p>
                <ul className="mt-1 space-y-1">
                  {event.outcomes.map((outcome) => (
                    <li key={outcome} className="text-sm text-gray-700">
                      <span className="font-medium">{outcome}</span>
                      <span className="ml-2 text-gray-500">
                        @ {(outcomePrices.get(outcome) ?? event.payoutMultiplier).toFixed(2)}
                      </span>
                      {event.finalOutcome === outcome && (
                        <span className="ml-2 font-semibold text-green-600">(Winner)</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-400">Details</p>
                <p className="mt-1 text-sm text-gray-600">
                  Base payout: {event.payoutMultiplier.toFixed(2)}x
                </p>
                {event.description && (
                  <p className="mt-1 text-sm text-gray-500">{event.description}</p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-400">Source</p>
                <p className="mt-1 text-sm text-gray-600">
                  {isLocalOnly
                    ? 'Using stored local odds'
                    : `Linked to ${event.externalSportKey?.replace(/_/g, ' ')}`}
                </p>
                {event.oddsUpdatedAt && (
                  <p className="mt-1 text-sm text-gray-500">
                    Odds updated {new Date(event.oddsUpdatedAt).toLocaleString()}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-400">IDs</p>
                <p className="mt-1 break-all text-xs text-gray-400">ID: {event.id}</p>
                {event.externalEventId && (
                  <p className="mt-0.5 break-all text-xs text-gray-400">
                    External: {event.externalEventId}
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

function createEmptyEventForm(): EventFormState {
  return {
    title: '',
    description: '',
    startsAt: toDateTimeInputValue(new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    payoutMultiplier: '2.0',
    outcomes: [createOutcomeRow('', '2.0'), createOutcomeRow('', '2.0')],
    detachFromExternalSource: true,
  };
}

function createOutcomeRow(name: string, price: string): EventFormRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    price,
  };
}

function eventToFormState(event: AdminEvent): EventFormState {
  const oddsMap = getOutcomePrices(event);

  return {
    title: event.title,
    description: event.description ?? '',
    startsAt: toDateTimeInputValue(event.startsAt),
    payoutMultiplier: String(event.payoutMultiplier),
    outcomes: event.outcomes.map((outcome) =>
      createOutcomeRow(
        outcome,
        String(oddsMap.get(outcome) ?? event.payoutMultiplier)
      )
    ),
    detachFromExternalSource: true,
  };
}

function buildEventPayload(
  form: EventFormState,
  editingEvent: AdminEvent | null
):
  | { ok: true; payload: EventPayload }
  | { ok: false; message: string } {
  const title = form.title.trim();
  if (!title) {
    return { ok: false, message: 'Title is required.' };
  }

  const payoutMultiplier = Number(form.payoutMultiplier);
  if (!Number.isFinite(payoutMultiplier) || payoutMultiplier < 1 || payoutMultiplier > 10) {
    return { ok: false, message: 'Base payout multiplier must be between 1 and 10.' };
  }

  if (!editingEvent || editingEvent.status === 'OPEN') {
    if (!form.startsAt) {
      return { ok: false, message: 'Start time is required.' };
    }

    const startsAtMs = new Date(form.startsAt).getTime();
    if (!Number.isFinite(startsAtMs) || startsAtMs <= Date.now()) {
      return { ok: false, message: 'Start time must be in the future.' };
    }
  }

  const normalizedOutcomes = form.outcomes.map((row) => ({
    name: row.name.trim().replace(/\s+/g, ' '),
    price: Number(row.price),
  }));

  if (normalizedOutcomes.length < 2) {
    return { ok: false, message: 'At least 2 outcomes are required.' };
  }

  if (normalizedOutcomes.some((row) => !row.name)) {
    return { ok: false, message: 'Every outcome needs a name.' };
  }

  const uniqueNames = new Set(normalizedOutcomes.map((row) => row.name.toLowerCase()));
  if (uniqueNames.size !== normalizedOutcomes.length) {
    return { ok: false, message: 'Outcome names must be unique.' };
  }

  if (
    normalizedOutcomes.some((row) => !Number.isFinite(row.price) || row.price <= 1)
  ) {
    return { ok: false, message: 'Each outcome price must be greater than 1.' };
  }

  const payload: EventPayload = {
    title,
    outcomes: normalizedOutcomes.map((row) => row.name),
    payoutMultiplier,
    odds: normalizedOutcomes,
    detachFromExternalSource: form.detachFromExternalSource,
  };

  const description = form.description.trim();
  if (description) {
    payload.description = description;
  } else if (editingEvent) {
    payload.description = null;
  }

  if (!editingEvent || editingEvent.status === 'OPEN') {
    payload.startsAt = new Date(form.startsAt).toISOString();
  }

  return { ok: true, payload };
}

function getOutcomePrices(event: AdminEvent) {
  const map = new Map<string, number>();
  for (const outcome of event.currentOdds?.outcomes ?? []) {
    map.set(outcome.name, outcome.price);
  }
  return map;
}

function toDateTimeInputValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
