import { useEffect, useState } from 'react';
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
  const { user } = useAuth();
  const { error: showError } = useToast();
  const [selectedPeriod, setSelectedPeriod] = useState<LeaderboardPeriod>('weekly');
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    void loadLeaderboard(selectedPeriod);
  }, [selectedPeriod]);

  const loadLeaderboard = async (period: LeaderboardPeriod) => {
    setIsLoading(true);
    setLoadError('');
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
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Leaderboard</h1>
        <p className="mt-1 text-gray-600">Top predictors by period performance</p>
      </div>

      <div className="mb-6 flex gap-2">
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
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              Period key: <span className="font-medium text-gray-900">{data.periodKey}</span>
            </p>
            {data.userRank && (
              <Badge className="bg-primary-100 text-primary-800">
                Your rank: #{data.userRank.rank}
              </Badge>
            )}
          </div>
        </Card>
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
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-2 pr-4">Rank</th>
                  <th className="py-2 pr-4">User</th>
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
