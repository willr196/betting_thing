import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, EmptyState, Input, Spinner } from '../components/ui';
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
    if (inviteFromQuery) {
      setShowJoin(true);
    }
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
      setLoadError('Failed to load leagues.');
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
      showSuccess('League created');
      navigate(`/leagues/${result.league.id}`);
    } catch (error) {
      if (error instanceof ApiError) {
        showError(error.message);
      } else {
        showError('Failed to create league');
      }
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleJoinLeague(event: FormEvent) {
    event.preventDefault();
    setJoinLoading(true);

    try {
      const result = await api.joinLeague(joinCode);
      showSuccess('Joined league');
      navigate(`/leagues/${result.league.id}`);
    } catch (error) {
      if (error instanceof ApiError) {
        showError(error.message);
      } else {
        showError('Failed to join league');
      }
    } finally {
      setJoinLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leagues</h1>
          <p className="mt-1 text-gray-600">Create private leagues and compete with friends</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowJoin(true)}>
            Join League
          </Button>
          <Button onClick={() => setShowCreate(true)}>Create League</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : loadError ? (
        <Card>
          <div className="space-y-3 text-center">
            <p className="text-red-600">{loadError}</p>
            <Button onClick={() => void loadLeagues()}>Retry</Button>
          </div>
        </Card>
      ) : leagues.length === 0 ? (
        <EmptyState
          title="No leagues yet"
          description="Create your first league or join one with an invite code."
          action={
            <div className="flex justify-center gap-2">
              <Button variant="secondary" onClick={() => setShowJoin(true)}>
                Join League
              </Button>
              <Button onClick={() => setShowCreate(true)}>Create League</Button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {leagues.map((league) => (
            <Card key={league.id} className="hover:shadow-md transition-shadow">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-2xl">{league.emoji}</span>
                <Badge className={league.isOpen ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}>
                  {league.isOpen ? 'Open' : 'Closed'}
                </Badge>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">{league.name}</h3>
              {league.description && (
                <p className="mt-1 text-sm text-gray-600 line-clamp-2">{league.description}</p>
              )}

              <div className="mt-4 space-y-1 text-sm text-gray-600">
                <p>Members: {league.memberCount}/{league.maxMembers}</p>
                <p>Role: {league.role}</p>
                {league.weekly ? (
                  <p>
                    This week: #{league.weekly.rank} • {formatPoints(league.weekly.pointsEarned)}
                  </p>
                ) : (
                  <p>This week: no standings yet</p>
                )}
                <p>Joined: {formatDate(league.joinedAt)}</p>
              </div>

              <Link
                to={`/leagues/${league.id}`}
                className="mt-4 block rounded-lg bg-primary-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-primary-700"
              >
                View League
              </Link>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title="Create League">
          <form className="space-y-4" onSubmit={handleCreateLeague}>
            <Input
              label="Name"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              minLength={2}
              maxLength={50}
              required
            />
            <Input
              label="Description"
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
              maxLength={200}
            />
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Emoji</p>
              <div className="flex flex-wrap gap-2">
                {EMOJI_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setCreateEmoji(emoji)}
                    className={`rounded-lg border px-3 py-2 text-xl ${
                      createEmoji === emoji
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
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
        <Modal onClose={() => setShowJoin(false)} title="Join League">
          <form className="space-y-4" onSubmit={handleJoinLeague}>
            <Input
              label="Invite Code"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase().trim())}
              minLength={8}
              maxLength={8}
              required
              placeholder="ABCD1234"
            />
            <div className="flex justify-end gap-2">
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
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>
        {children}
      </Card>
    </div>
  );
}
