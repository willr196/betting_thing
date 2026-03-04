import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, EmptyState, Spinner } from '../components/ui';
import { formatDate, formatPoints } from '../lib/utils';
import type { League, LeagueMember, LeagueMembershipSummary, LeagueStandingRow } from '../types';

type LeagueDetailResponse = {
  league: League;
  membership: LeagueMembershipSummary;
  memberCount: number;
};

const MS_IN_DAY = 24 * 60 * 60 * 1000;

function getISOWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / MS_IN_DAY) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function previousWeek(weekKey: string): string {
  const [year, week] = weekKey.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime());
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  const prev = new Date(monday.getTime() - 7 * MS_IN_DAY);
  return getISOWeekKey(prev);
}

export function LeagueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { success: showSuccess, error: showError } = useToast();

  const [leagueData, setLeagueData] = useState<LeagueDetailResponse | null>(null);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [standings, setStandings] = useState<LeagueStandingRow[]>([]);
  const [requester, setRequester] = useState<LeagueStandingRow | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [period, setPeriod] = useState<'weekly' | 'all-time'>('weekly');
  const [weekKey, setWeekKey] = useState(getISOWeekKey());

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingStandings, setIsRefreshingStandings] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const periodKey = period === 'weekly' ? weekKey : undefined;
  const isOwner = leagueData?.membership.role === 'OWNER';

  const weekLabel = useMemo(() => {
    if (period !== 'weekly') return null;
    return weekKey;
  }, [period, weekKey]);

  useEffect(() => {
    if (!id) return;
    void loadPage(id);
  }, [id]);

  useEffect(() => {
    if (!id || !leagueData) return;
    void loadStandings(id, true);
  }, [id, period, weekKey]);

  async function loadPage(leagueId: string) {
    setIsLoading(true);
    try {
      const [detail, memberResult, standingsResult] = await Promise.all([
        api.getLeague(leagueId),
        api.getLeagueMembers(leagueId),
        api.getLeagueStandings(leagueId, period, periodKey),
      ]);
      setLeagueData(detail);
      setMembers(memberResult.members);
      setStandings(standingsResult.standings);
      setRequester(standingsResult.requester);
      setUpdatedAt(standingsResult.updatedAt);
    } catch (error) {
      if (error instanceof ApiError) {
        showError(error.message);
      } else {
        showError('Failed to load league');
      }
      navigate('/leagues');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadStandings(leagueId: string, silent = false) {
    if (!silent) {
      setIsRefreshingStandings(true);
    }
    try {
      const result = await api.getLeagueStandings(leagueId, period, periodKey);
      setStandings(result.standings);
      setRequester(result.requester);
      setUpdatedAt(result.updatedAt);
    } catch (error) {
      if (!silent) {
        if (error instanceof ApiError) {
          showError(error.message);
        } else {
          showError('Failed to load standings');
        }
      }
    } finally {
      if (!silent) {
        setIsRefreshingStandings(false);
      }
    }
  }

  async function handleCopyInvite() {
    if (!id) return;
    setIsCopying(true);
    try {
      const invite = await api.getLeagueInvite(id);
      await navigator.clipboard.writeText(invite.inviteUrl);
      showSuccess('Invite link copied');
    } catch {
      showError('Failed to copy invite link');
    } finally {
      setIsCopying(false);
    }
  }

  async function handleKick(userId: string) {
    if (!id) return;
    if (!window.confirm('Remove this member from the league?')) {
      return;
    }
    try {
      await api.kickLeagueMember(id, userId);
      showSuccess('Member removed');
      const [memberResult] = await Promise.all([
        api.getLeagueMembers(id),
        loadStandings(id, true),
      ]);
      setMembers(memberResult.members);
      if (leagueData) {
        setLeagueData({
          ...leagueData,
          memberCount: Math.max(leagueData.memberCount - 1, 1),
        });
      }
    } catch (error) {
      if (error instanceof ApiError) {
        showError(error.message);
      } else {
        showError('Failed to remove member');
      }
    }
  }

  async function handleLeaveLeague() {
    if (!id || !leagueData || leagueData.membership.role === 'OWNER') return;
    if (!window.confirm('Leave this league?')) return;
    setIsLeaving(true);
    try {
      await api.leaveLeague(id);
      showSuccess('Left league');
      navigate('/leagues');
    } catch (error) {
      if (error instanceof ApiError) {
        showError(error.message);
      } else {
        showError('Failed to leave league');
      }
    } finally {
      setIsLeaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!leagueData) {
    return (
      <EmptyState title="League not found" description="The requested league could not be loaded." />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xl">{leagueData.league.emoji}</span>
              <h1 className="text-2xl font-bold text-gray-900">{leagueData.league.name}</h1>
              <Badge className={leagueData.league.isOpen ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}>
                {leagueData.league.isOpen ? 'Open' : 'Closed'}
              </Badge>
            </div>
            {leagueData.league.description && (
              <p className="text-gray-600">{leagueData.league.description}</p>
            )}
            <p className="mt-2 text-sm text-gray-500">
              Members: {leagueData.memberCount}/{leagueData.league.maxMembers} • Your role: {leagueData.membership.role}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => void handleCopyInvite()} isLoading={isCopying}>
              Copy Invite
            </Button>
            {isOwner ? (
              <Link to={`/leagues/${leagueData.league.id}/settings`}>
                <Button>Settings</Button>
              </Link>
            ) : (
              <Button variant="danger" onClick={() => void handleLeaveLeague()} isLoading={isLeaving}>
                Leave League
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPeriod('weekly')}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${
                period === 'weekly'
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              This Week
            </button>
            <button
              type="button"
              onClick={() => setPeriod('all-time')}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${
                period === 'all-time'
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              All Time
            </button>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            {period === 'weekly' && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setWeekKey(previousWeek(weekKey))}>
                  Previous Week
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setWeekKey(getISOWeekKey())}>
                  Current Week
                </Button>
                <span className="font-medium">{weekLabel}</span>
              </>
            )}
            {updatedAt && <span>Updated {formatDate(updatedAt)}</span>}
            {requester && <Badge className="bg-primary-100 text-primary-700">Your rank: #{requester.rank}</Badge>}
          </div>
        </div>

        {isRefreshingStandings ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : standings.length === 0 ? (
          <EmptyState title="No standings yet" description="Standings will appear after recalculation." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-2 pr-4">Rank</th>
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4">Points</th>
                  <th className="py-2 pr-4">W</th>
                  <th className="py-2 pr-4">L</th>
                  <th className="py-2 pr-4">Predictions</th>
                  <th className="py-2 pr-4">Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row) => (
                  <tr
                    key={row.userId}
                    className={`border-b border-gray-100 ${
                      row.userId === requester?.userId ? 'bg-primary-50' : ''
                    }`}
                  >
                    <td className="py-3 pr-4 font-semibold text-gray-900">#{row.rank}</td>
                    <td className="py-3 pr-4 text-gray-800">{row.displayName}</td>
                    <td className="py-3 pr-4 text-gray-700">{formatPoints(row.pointsEarned)}</td>
                    <td className="py-3 pr-4 text-gray-700">{row.predictionsWon}</td>
                    <td className="py-3 pr-4 text-gray-700">{row.predictionsLost}</td>
                    <td className="py-3 pr-4 text-gray-700">{row.totalPredictions}</td>
                    <td className="py-3 pr-4 text-gray-700">{(row.winRate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Members</h2>
        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.userId}
              className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
            >
              <div>
                <p className="font-medium text-gray-900">{member.displayName}</p>
                <p className="text-xs text-gray-500">Joined {formatDate(member.joinedAt)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={member.role === 'OWNER' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}>
                  {member.role}
                </Badge>
                {isOwner && member.role !== 'OWNER' && (
                  <Button size="sm" variant="danger" onClick={() => void handleKick(member.userId)}>
                    Kick
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

