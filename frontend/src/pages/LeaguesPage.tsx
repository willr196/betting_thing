import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, Input, InlineError, Spinner } from '../components/ui';
import { formatPoints, formatDate } from '../lib/utils';
import type { LeagueListItem } from '../types';

const EMOJI_OPTIONS = ['⚽', '🏆', '🎯', '🔥', '💎', '👑', '🦁', '🐉', '⭐', '🤝'];

export function LeaguesPage() {
  const { success: showSuccess, error: showError } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const inviteFromQuery = useMemo(
    () => new URLSearchParams(location.search).get('code')?.toUpperCase().trim() ?? '',
    [location.search]
  );

  const [leagues, setLeagues] = useState<LeagueListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createEmoji, setCreateEmoji] = useState('⚽');
  const [createLoading, setCreateLoading] = useState(false);

  const [joinCode, setJoinCode] = useState(inviteFromQuery);
  const [joinLoading, setJoinLoading] = useState(false);

  useEffect(() => {
    setJoinCode(inviteFromQuery);
    if (inviteFromQuery) setShowJoin(true);
  }, [inviteFromQuery]);

  useEffect(() => {
    void loadLeagues();
  }, []);

  async function loadLeagues() {
    setIsLoading(true);
    setLoadError('');
    try {
      const data = await api.getMyLeagues();
      setLeagues(data.leagues);
    } catch {
      setLoadError('Your leagues could not be loaded right now.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateLeague(event: FormEvent) {
    event.preventDefault();
    setCreateLoading(true);

    try {
      const result = await api.createLeague({
        name: createName.trim(),
        description: createDescription.trim() || undefined,
        emoji: createEmoji,
      });
      showSuccess('League created successfully');
      navigate(`/leagues/${result.league.id}`);
    } catch (error) {
      showError(error instanceof ApiError ? error.message : 'Failed to create league');
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleJoinLeague(event: FormEvent) {
    event.preventDefault();
    setJoinLoading(true);

    try {
      const result = await api.joinLeague(joinCode);
      showSuccess("You've joined the league");
      navigate(`/leagues/${result.league.id}`);
    } catch (error) {
      showError(error instanceof ApiError ? error.message : 'Failed to join league');
    } finally {
      setJoinLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leagues</h1>
          <p className="mt-1 text-sm text-gray-500">
            Compete with friends in private leagues and track your standings.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={() => setShowJoin(true)}>
            Join a League
          </Button>
          <Button onClick={() => setShowCreate(true)}>Create League</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : loadError ? (
        <InlineError message={loadError} onRetry={() => void loadLeagues()} />
      ) : leagues.length === 0 ? (
        <LeaguesEmptyState
          onCreateClick={() => setShowCreate(true)}
          onJoinClick={() => setShowJoin(true)}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {leagues.map((league) => (
            <LeagueCard key={league.id} league={league} />
          ))}
        </div>
      )}

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title="Create a league">
          <form className="space-y-4" onSubmit={handleCreateLeague}>
            <Input
              label="League name"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              minLength={2}
              maxLength={50}
              required
              placeholder="e.g. The Wednesday Crew"
            />
            <Input
              label="Description (optional)"
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
              maxLength={200}
              placeholder="What's this league about?"
            />
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Pick an icon</p>
              <div className="flex flex-wrap gap-2">
                {EMOJI_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setCreateEmoji(emoji)}
                    className={`rounded-xl border px-3 py-2 text-xl transition-colors ${
                      createEmoji === emoji
                        ? 'border-primary-400 bg-primary-50 shadow-sm'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={createLoading}>
                Create
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {showJoin && (
        <Modal onClose={() => setShowJoin(false)} title="Join a league">
          <p className="mb-4 text-sm text-gray-500">
            Enter the 8-character invite code shared by the league owner.
          </p>
          <form className="space-y-4" onSubmit={handleJoinLeague}>
            <Input
              label="Invite code"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase().trim())}
              minLength={8}
              maxLength={8}
              required
              placeholder="ABCD1234"
              className="font-mono tracking-widest"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={() => setShowJoin(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={joinLoading}>
                Join
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

function LeaguesEmptyState({
  onCreateClick,
  onJoinClick,
}: {
  onCreateClick: () => void;
  onJoinClick: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Primary empty state */}
      <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 px-6 py-10 text-center">
        <div className="mx-auto mb-3 text-4xl">🏆</div>
        <h3 className="font-semibold text-gray-800">You're not in any leagues yet</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-gray-500">
          Create a private league to compete with friends, or join one using an invite code.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Button variant="secondary" onClick={onJoinClick}>
            Join a League
          </Button>
          <Button onClick={onCreateClick}>Create League</Button>
        </div>
      </div>

      {/* Value prop cards */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
          Why join a league?
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <ValueCard
            icon="⚔️"
            title="Private competition"
            description="Compete head-to-head with people you know across every week."
          />
          <ValueCard
            icon="📊"
            title="Track standings"
            description="See weekly and all-time rankings for everyone in your league."
          />
          <ValueCard
            icon="🔗"
            title="Easy to invite"
            description="Share a simple code and your friends can join in seconds."
          />
        </div>
      </div>
    </div>
  );
}

function ValueCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <Card padding="sm" className="text-center">
      <div className="mb-2 text-2xl">{icon}</div>
      <p className="font-semibold text-gray-800">{title}</p>
      <p className="mt-1 text-xs text-gray-500">{description}</p>
    </Card>
  );
}

// =============================================================================
// LEAGUE CARD
// =============================================================================

function LeagueCard({ league }: { league: LeagueListItem }) {
  const isOwner = league.role === 'OWNER';

  return (
    <Card className="flex flex-col transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-2xl">{league.emoji}</span>
        <div className="flex items-center gap-1.5">
          {isOwner && (
            <Badge className="bg-amber-50 text-amber-700">Owner</Badge>
          )}
          <Badge
            className={
              league.isOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
            }
          >
            {league.isOpen ? 'Open' : 'Closed'}
          </Badge>
        </div>
      </div>

      <h3 className="text-base font-semibold text-gray-900">{league.name}</h3>

      {league.description && (
        <p className="mt-1 line-clamp-2 text-sm text-gray-500">{league.description}</p>
      )}

      <div className="mt-4 space-y-1 text-sm text-gray-500">
        <div className="flex items-center justify-between">
          <span>Members</span>
          <span className="font-medium text-gray-700">
            {league.memberCount} / {league.maxMembers}
          </span>
        </div>
        {league.weekly ? (
          <div className="flex items-center justify-between">
            <span>This week</span>
            <span className="font-medium text-gray-700">
              #{league.weekly.rank} · {formatPoints(league.weekly.pointsEarned)} pts
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span>This week</span>
            <span className="text-gray-400">No picks yet</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span>Joined</span>
          <span className="font-medium text-gray-700">{formatDate(league.joinedAt)}</span>
        </div>
      </div>

      <Link
        to={`/leagues/${league.id}`}
        className="mt-5 block w-full rounded-xl bg-primary-600 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-primary-700"
      >
        View League
      </Link>
    </Card>
  );
}

// =============================================================================
// MODAL
// =============================================================================

function Modal({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <Card className="w-full max-w-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
        {children}
      </Card>
    </div>
  );
}
