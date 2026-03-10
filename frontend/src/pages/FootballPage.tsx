import { useEffect, useMemo, useState } from 'react';
import { useBetSlip } from '../context/BetSlipContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { formatDate, formatRelativeTime } from '../lib/utils';
import { Badge, Button, Card, EmptyState, Spinner } from '../components/ui';
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
    } catch (loadError) {
      setError('Failed to load football fixtures. Please try again.');
      console.error('Failed to load football fixtures:', loadError);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (event: Event, option: FootballOutcomeOption) => {
    addSelection(
      event.id,
      event.title,
      option.outcome,
      option.odds,
      { replaceExistingForEvent: true }
    );
    showSuccess(`Selected ${option.label} for ${event.title}`);
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Football</h1>
          <p className="mt-1 text-gray-600">
            Pick Home, Draw, or Away and build your accumulator in the bet slip.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void loadFootballEvents()}>
          Refresh Fixtures
        </Button>
      </div>

      <Card className="mb-6 border-primary-100 bg-primary-50/60">
        <p className="text-sm text-primary-900">
          Clicking another option on the same match updates that match pick in your slip.
        </p>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="py-12 text-center">
          <p className="mb-4 text-red-600">{error}</p>
          <Button onClick={() => void loadFootballEvents()}>Retry</Button>
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          title="No football fixtures available"
          description="Check back soon for more matches."
        />
      ) : (
        <div className="space-y-4">
          {events.map((event) => {
            const options = buildFootballOutcomeOptions(event);
            const selectedOutcome = selectedOutcomeByEventId.get(event.id) ?? null;

            return (
              <Card key={event.id}>
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{event.title}</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      {event.description ?? 'Football'}
                    </p>
                  </div>
                  <div className="text-sm text-gray-500 sm:text-right">
                    <p>{formatDate(event.startsAt)}</p>
                    <p>{formatRelativeTime(event.startsAt)}</p>
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Badge className="bg-green-100 text-green-700">OPEN</Badge>
                  {event._count && (
                    <span className="text-xs text-gray-500">
                      {event._count.predictions} predictions
                    </span>
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
                        onClick={() => handleSelect(event, option)}
                        className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                          isSelected
                            ? 'border-primary-600 bg-primary-50'
                            : 'border-gray-200 bg-white hover:border-primary-300 hover:bg-primary-50/40'
                        }`}
                      >
                        <p className="text-sm font-semibold text-gray-900">{option.label}</p>
                        <p className="mt-1 text-sm text-green-700">{option.odds.toFixed(2)}x</p>
                      </button>
                    );
                  })}
                </div>

                {selectedOutcome && (
                  <p className="mt-3 text-sm text-primary-700">
                    Selected: {selectedOutcome}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function parseFixtureTitle(title: string): { homeTeam: string | null; awayTeam: string | null } {
  const match = title.match(/^\s*(.+?)\s+v(?:s)?\.?\s+(.+?)\s*$/i);
  if (!match) {
    return { homeTeam: null, awayTeam: null };
  }

  return {
    homeTeam: match[1]?.trim() ?? null,
    awayTeam: match[2]?.trim() ?? null,
  };
}

function findTeamOutcome(outcomes: string[], teamName: string | null): string | null {
  if (!teamName) {
    return null;
  }

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
