import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatPoints } from '../lib/utils';
import { Card, Badge, Spinner, Button, EmptyState } from '../components/ui';
import type { LeaderboardEntry, LeaderboardPeriod } from '../types';

type LeaderboardResponse = {
  period: 'WEEKLY' | 'MONTHLY' | 'ALL_TIME';
  periodKey: string;
  leaderboard: LeaderboardEntry[];
  userRank: LeaderboardEntry | null;
};

const PERIODS: Array<{ key: LeaderboardPeriod; label: string }> = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'all-time', label: 'All-Time' },
];

export function LeaderboardPage() {
  const { user, isAuthenticated } = useAuth();
  const { error: showError } = useToast();
  const [selectedPeriod, setSelectedPeriod] = useState<LeaderboardPeriod>('weekly');
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loadError, setLoadError] = useState('');

  const authRedirect = encodeURIComponent('/leaderboard');
  const podiumEntries = data?.leaderboard.slice(0, 3) ?? [];

  useEffect(() => {
    void loadLeaderboard(selectedPeriod);
  }, [selectedPeriod]);

  const loadLeaderboard = async (period: LeaderboardPeriod) => {
    setIsLoading(true);
    setLoadError('');
    setData(null);
    try {
      const response = await api.getLeaderboard(period, 20);
      setData(response);
    } catch {
      setLoadError('Failed to load leaderboard.');
      showError('Failed to load leaderboard.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden bg-gradient-to-r from-slate-900 via-primary-700 to-emerald-600 text-white">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <Badge className="bg-white/15 text-white">Community leaderboard</Badge>
            <h1 className="mt-4 text-3xl font-bold">See who is leading the board</h1>
            <p className="mt-2 text-sm text-white/80">
              Weekly, monthly, and all-time rankings based on settled predictions and points won.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {isAuthenticated ? (
              <Link to="/events">
                <Button variant="secondary">Make predictions</Button>
              </Link>
            ) : (
              <>
                <Link to={`/register?redirect=${authRedirect}`}>
                  <Button variant="secondary">Create account</Button>
                </Link>
                <Link to={`/login?redirect=${authRedirect}`}>
                  <Button
                    variant="ghost"
                    className="border border-white/20 bg-white/10 text-white hover:bg-white/20"
                  >
                    Sign in
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        {PERIODS.map((period) => (
          <button
            key={period.key}
            type="button"
            onClick={() => setSelectedPeriod(period.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              selectedPeriod === period.key
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {period.label}
          </button>
        ))}
      </div>

      {data && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)]">
          <div className="grid gap-4 md:grid-cols-3">
            {podiumEntries.map((entry, index) => {
              const accentClass =
                index === 0
                  ? 'border-amber-200 bg-amber-50'
                  : index === 1
                    ? 'border-slate-200 bg-slate-50'
                    : 'border-orange-200 bg-orange-50';

              return (
                <Card key={entry.userId} className={`border-2 ${accentClass}`}>
                  <div className="flex items-center justify-between gap-3">
                    <Badge className="bg-gray-900 text-white">#{entry.rank}</Badge>
                    <p className="text-sm font-medium text-gray-500">
                      {(entry.winRate * 100).toFixed(1)}% win rate
                    </p>
                  </div>
                  <p className="mt-4 text-lg font-semibold text-gray-900">{entry.displayName}</p>
                  <p className="mt-1 text-3xl font-bold text-primary-700">
                    {formatPoints(entry.totalPointsWon)}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    {entry.wins}W • {entry.losses}L • {entry.totalPredictions} settled picks
                  </p>
                  <p className="mt-3 text-sm text-gray-500">
                    Current streak {entry.currentStreak} • Best {entry.longestStreak}
                  </p>
                </Card>
              );
            })}
          </div>

          <Card>
            <p className="text-sm font-medium text-gray-500">Current period</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{data.periodKey}</p>
            <p className="mt-2 text-sm text-gray-600">
              Rankings are ordered by points won, then wins, then win rate.
            </p>

            <div className="mt-5 space-y-3">
              {data.userRank ? (
                <div className="rounded-xl bg-primary-50 px-4 py-3">
                  <p className="text-sm font-medium text-primary-700">Your current rank</p>
                  <p className="mt-1 text-2xl font-bold text-primary-900">#{data.userRank.rank}</p>
                  <p className="mt-1 text-sm text-primary-700">
                    {formatPoints(data.userRank.totalPointsWon)} points won
                  </p>
                </div>
              ) : isAuthenticated ? (
                <div className="rounded-xl bg-gray-50 px-4 py-3">
                  <p className="text-sm font-medium text-gray-800">No rank yet</p>
                  <p className="mt-1 text-sm text-gray-600">
                    Settle a prediction to appear on this board.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl bg-emerald-50 px-4 py-3">
                  <p className="text-sm font-medium text-emerald-800">Join to compete</p>
                  <p className="mt-1 text-sm text-emerald-700">
                    Create an account to track your rank and climb the board.
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      <Card>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : loadError ? (
          <div className="py-10 text-center">
            <p className="mb-4 text-red-600">{loadError}</p>
            <Button onClick={() => loadLeaderboard(selectedPeriod)}>Retry</Button>
          </div>
        ) : !data || data.leaderboard.length === 0 ? (
          <EmptyState
            title="No leaderboard entries yet"
            description="Entries will appear after settled predictions."
            action={
              !isAuthenticated ? (
                <Link to={`/register?redirect=${authRedirect}`}>
                  <Button>Create account</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-2 pr-4">Rank</th>
                  <th className="py-2 pr-4">User</th>
                  <th className="py-2 pr-4">Record</th>
                  <th className="py-2 pr-4">Predictions</th>
                  <th className="py-2 pr-4">Win Rate</th>
                  <th className="py-2 pr-4">Points Won</th>
                  <th className="py-2 pr-4">Streak</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((entry) => {
                  const isCurrentUser = user?.id === entry.userId;
                  return (
                    <tr
                      key={entry.userId}
                      className={`border-b border-gray-100 ${
                        isCurrentUser ? 'bg-primary-50' : ''
                      }`}
                    >
                      <td className="py-3 pr-4 font-semibold text-gray-900">#{entry.rank}</td>
                      <td className="py-3 pr-4 text-gray-800">{entry.displayName}</td>
                      <td className="py-3 pr-4 text-gray-700">
                        {entry.wins}W - {entry.losses}L
                      </td>
                      <td className="py-3 pr-4 text-gray-700">{entry.totalPredictions}</td>
                      <td className="py-3 pr-4 text-gray-700">
                        {(entry.winRate * 100).toFixed(1)}%
                      </td>
                      <td className="py-3 pr-4 text-gray-700">
                        {formatPoints(entry.totalPointsWon)}
                      </td>
                      <td className="py-3 pr-4 text-gray-700">
                        🔥 {entry.currentStreak} (best {entry.longestStreak})
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
