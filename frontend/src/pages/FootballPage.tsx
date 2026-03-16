import { useEffect, useMemo, useState } from 'react';
import { useBetSlip } from '../context/BetSlipContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { formatDate, formatRelativeTime } from '../lib/utils';
import { Badge, Card, EmptyState, InlineError } from '../components/ui';
import type { Event } from '../types';

type FootballOutcomeType = 'HOME' | 'DRAW' | 'AWAY';

interface FootballOutcomeOption {
  type: FootballOutcomeType;
  outcome: string;
  label: string;
  odds: number;
}

export function FootballPage() {
  const { selections, addSelection } = useBetSlip();
  const { success: showSuccess } = useToast();

  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadFootballEvents();
  }, []);

  const selectedOutcomeByEventId = useMemo(() => {
    const map = new Map<string, string>();
    for (const selection of selections) {
      map.set(selection.eventId, selection.predictedOutcome);
    }
    return map;
  }, [selections]);

  const loadFootballEvents = async () => {
    setIsLoading(true);
    setError('');

    try {
      const data = await api.getEvents({
        status: 'OPEN',
        upcoming: true,
        sportKeyPrefix: 'soccer_',
        limit: 100,
      });
      setEvents(data.events);
    } catch {
      setError('Fixtures could not be loaded. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (event: Event, option: FootballOutcomeOption) => {
    addSelection(event.id, event.title, option.outcome, option.odds, {
      replaceExistingForEvent: true,
    });
    showSuccess(`${option.label} added to your slip`);
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Football</h1>
          <p className="mt-1 text-sm text-gray-500">
            Pick Home, Draw, or Away and build your slip.
          </p>
        </div>

        {/* Subtle refresh — not a primary action */}
        <button
          type="button"
          onClick={() => void loadFootballEvents()}
          disabled={isLoading}
          className="flex items-center gap-1.5 self-start rounded-full border border-gray-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50 sm:self-auto"
        >
          <svg
            className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Update
        </button>
      </div>

      {/* Bet slip hint */}
      <Card className="mb-6 border-primary-100 bg-primary-50/50 py-3">
        <p className="text-sm text-primary-800">
          Selecting a different option for the same match will update your pick in the slip.
        </p>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <FixtureCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <InlineError message={error} onRetry={() => void loadFootballEvents()} />
      ) : events.length === 0 ? (
        <EmptyState
          title="No fixtures available right now"
          description="Open football fixtures will appear here when available. Check back soon."
        />
      ) : (
        <div className="space-y-4">
          {events.map((event) => {
            const options = buildFootballOutcomeOptions(event);
            const selectedOutcome = selectedOutcomeByEventId.get(event.id) ?? null;

            return (
              <FixtureCard
                key={event.id}
                event={event}
                options={options}
                selectedOutcome={selectedOutcome}
                onSelect={(option) => handleSelect(event, option)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// FIXTURE CARD
// =============================================================================

function FixtureCard({
  event,
  options,
  selectedOutcome,
  onSelect,
}: {
  event: Event;
  options: FootballOutcomeOption[];
  selectedOutcome: string | null;
  onSelect: (option: FootballOutcomeOption) => void;
}) {
  return (
    <Card>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold text-gray-900">{event.title}</h2>
          <p className="mt-0.5 text-sm text-gray-500">{event.description ?? 'Football'}</p>
        </div>
        <div className="shrink-0 text-sm text-gray-400 sm:text-right">
          <p>{formatDate(event.startsAt)}</p>
          <p className="text-xs">{formatRelativeTime(event.startsAt)}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge className="bg-emerald-100 text-emerald-700">Open</Badge>
        {event._count && event._count.predictions > 0 && (
          <span className="text-xs text-gray-400">{event._count.predictions} picks</span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => {
          const isSelected =
            selectedOutcome !== null &&
            normalizeText(selectedOutcome) === normalizeText(option.outcome);

          return (
            <button
              key={`${event.id}:${option.type}`}
              type="button"
              onClick={() => onSelect(option)}
              className={`rounded-xl border px-3 py-3 text-left transition-all ${
                isSelected
                  ? 'border-primary-500 bg-primary-50 shadow-sm ring-1 ring-primary-400/30'
                  : 'border-gray-200 bg-white/80 hover:border-primary-300 hover:bg-primary-50/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{option.label}</p>
                {isSelected && (
                  <span className="text-xs font-semibold text-primary-600">✓ In slip</span>
                )}
              </div>
              <p className="mt-1 text-sm font-medium text-emerald-600">
                {option.odds.toFixed(2)}×
              </p>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// =============================================================================
// FIXTURE CARD SKELETON
// =============================================================================

function FixtureCardSkeleton() {
  return (
    <Card>
      <div className="mb-4 flex justify-between">
        <div className="space-y-2">
          <div className="h-5 w-48 animate-pulse rounded bg-gray-100" />
          <div className="h-4 w-24 animate-pulse rounded bg-gray-100" />
        </div>
        <div className="h-4 w-20 animate-pulse rounded bg-gray-100" />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
        ))}
      </div>
    </Card>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function buildFootballOutcomeOptions(event: Event): FootballOutcomeOption[] {
  const { homeTeam, awayTeam } = parseFixtureTitle(event.title);
  const drawOutcome = event.outcomes.find(isDrawOutcome) ?? null;
  const nonDrawOutcomes = event.outcomes.filter((outcome) => !isDrawOutcome(outcome));

  const homeOutcome = findTeamOutcome(nonDrawOutcomes, homeTeam) ?? nonDrawOutcomes[0] ?? null;
  const awayCandidates = nonDrawOutcomes.filter((outcome) => outcome !== homeOutcome);
  const awayOutcome = findTeamOutcome(awayCandidates, awayTeam) ?? awayCandidates[0] ?? null;

  const candidates: FootballOutcomeOption[] = [];

  if (homeOutcome) {
    candidates.push({
      type: 'HOME',
      outcome: homeOutcome,
      label: homeTeam ? `${homeTeam} (H)` : 'Home',
      odds: findOutcomeOdds(event, homeOutcome),
    });
  }

  if (drawOutcome) {
    candidates.push({
      type: 'DRAW',
      outcome: drawOutcome,
      label: 'Draw',
      odds: findOutcomeOdds(event, drawOutcome),
    });
  }

  if (awayOutcome) {
    candidates.push({
      type: 'AWAY',
      outcome: awayOutcome,
      label: awayTeam ? `${awayTeam} (A)` : 'Away',
      odds: findOutcomeOdds(event, awayOutcome),
    });
  }

  const deduped = dedupeOptionsByOutcome(candidates);
  if (deduped.length > 0) {
    return deduped;
  }

  return event.outcomes.map((outcome, index) => ({
    type: index === 0 ? 'HOME' : index === 1 ? 'AWAY' : 'DRAW',
    outcome,
    label: outcome,
    odds: findOutcomeOdds(event, outcome),
  }));
}

function dedupeOptionsByOutcome(options: FootballOutcomeOption[]): FootballOutcomeOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = normalizeText(option.outcome);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseFixtureTitle(title: string): { homeTeam: string | null; awayTeam: string | null } {
  const match = title.match(/^\s*(.+?)\s+v(?:s)?\.?\s+(.+?)\s*$/i);
  if (!match) return { homeTeam: null, awayTeam: null };
  return {
    homeTeam: match[1]?.trim() ?? null,
    awayTeam: match[2]?.trim() ?? null,
  };
}

function findTeamOutcome(outcomes: string[], teamName: string | null): string | null {
  if (!teamName) return null;
  const normalizedTeam = normalizeText(teamName);
  return (
    outcomes.find((outcome) => {
      const normalizedOutcome = normalizeText(outcome);
      return (
        normalizedOutcome === normalizedTeam ||
        normalizedOutcome.includes(normalizedTeam) ||
        normalizedTeam.includes(normalizedOutcome)
      );
    }) ?? null
  );
}

function isDrawOutcome(value: string): boolean {
  const normalized = normalizeText(value);
  return normalized.includes('draw') || normalized === 'tie';
}

function findOutcomeOdds(event: Event, outcome: string): number {
  const fromLiveOdds =
    event.currentOdds?.outcomes.find(
      (option) => normalizeText(option.name) === normalizeText(outcome)
    )?.price ?? null;

  return fromLiveOdds ?? event.payoutMultiplier;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
