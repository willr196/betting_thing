import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatPoints } from '../lib/utils';
import { Badge, Card, Spinner } from './ui';
import type { LeaderboardEntry, LeaderboardPeriod } from '../types';

type LeaderboardResponse = {
  period: 'WEEKLY' | 'MONTHLY' | 'ALL_TIME';
  periodKey: string;
  leaderboard: LeaderboardEntry[];
  userRank: LeaderboardEntry | null;
};

interface LeaderboardPreviewProps {
  period?: LeaderboardPeriod;
  limit?: number;
  title?: string;
  description?: string;
}

export function LeaderboardPreview({
  period = 'weekly',
  limit = 5,
  title = "This Week's Leaders",
  description = 'Top predictors based on settled results',
}: LeaderboardPreviewProps) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let isCancelled = false;

    async function loadPreview() {
      setIsLoading(true);
      setLoadError('');

      try {
        const result = await api.getLeaderboard(period, limit);
        if (!isCancelled) {
          setData(result);
        }
      } catch {
        if (!isCancelled) {
          setLoadError('Unable to load leaderboard.');
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      isCancelled = true;
    };
  }, [limit, period]);

  const entries = data?.leaderboard ?? [];
  const userRankIsListed = data?.userRank
    ? entries.some((entry) => entry.userId === data.userRank?.userId)
    : false;

  return (
    <Card className="overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-primary-700 text-white">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/70">
            Leaderboard
          </p>
          <h2 className="mt-1 text-xl font-bold">{title}</h2>
          <p className="mt-1 text-sm text-white/75">{description}</p>
        </div>
        <Link
          to="/leaderboard"
          className="shrink-0 rounded-lg border border-white/20 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
        >
          View all
        </Link>
      </div>

      {data && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge className="bg-white/15 text-white">Period {data.periodKey}</Badge>
          {data.userRank && (
            <Badge className="bg-emerald-400/20 text-emerald-100">
              Your rank #{data.userRank.rank}
            </Badge>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : loadError ? (
        <p className="rounded-lg border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {loadError}
        </p>
      ) : entries.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/75">
          No leaderboard entries yet. Rankings will appear after settled predictions.
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.userId}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
                  #{entry.rank}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{entry.displayName}</p>
                  <p className="text-xs text-white/65">
                    {(entry.winRate * 100).toFixed(1)}% win rate
                  </p>
                </div>
              </div>
              <p className="text-sm font-semibold text-emerald-200">
                {formatPoints(entry.totalPointsWon)}
              </p>
            </div>
          ))}

          {data?.userRank && !userRankIsListed && (
            <div className="mt-3 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-emerald-50">
                  You are currently #{data.userRank.rank}
                </p>
                <p className="text-sm font-semibold text-emerald-200">
                  {formatPoints(data.userRank.totalPointsWon)}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
