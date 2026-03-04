import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import {
  formatTokens,
  formatPoints,
  formatDate,
  formatRelativeTime,
  getTransactionColor,
  getTransactionLabel,
} from '../lib/utils';
import { Card, Spinner, EmptyState } from '../components/ui';
import type {
  TokenAllowance,
  TokenTransaction,
  PointsTransaction,
  DashboardStats,
  Achievement,
} from '../types';

export function WalletPage() {
  const { error: showError } = useToast();
  const PAGE_SIZE = 20;

  const [activeTab, setActiveTab] = useState<'tokens' | 'points'>('tokens');

  // Token history
  const [transactions, setTransactions] = useState<TokenTransaction[]>([]);
  const [tokenTotal, setTokenTotal] = useState(0);
  const [tokenOffset, setTokenOffset] = useState(0);
  const [tokenHasMore, setTokenHasMore] = useState(false);

  // Points history
  const [pointsTransactions, setPointsTransactions] = useState<PointsTransaction[]>([]);
  const [pointsTotal, setPointsTotal] = useState(0);
  const [pointsOffset, setPointsOffset] = useState(0);
  const [pointsHasMore, setPointsHasMore] = useState(false);
  const [isPointsLoading, setIsPointsLoading] = useState(false);
  const [isLoadingMorePoints, setIsLoadingMorePoints] = useState(false);

  // Shared
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [allowance, setAllowance] = useState<TokenAllowance | null>(null);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    loadWalletData();
  }, []);

  // Load points history when tab is first switched to points
  useEffect(() => {
    if (activeTab === 'points' && pointsTransactions.length === 0 && !isPointsLoading) {
      loadPointsTransactions();
    }
  }, [activeTab]);

  const loadWalletData = async () => {
    setIsLoading(true);
    setError('');
    try {
      const [tokenStatus, points, data, dashboardStats, achievementsData] = await Promise.all([
        api.getTokenAllowance(),
        api.getPointsBalance(),
        api.getTransactions(PAGE_SIZE, 0),
        api.getDashboardStats(),
        api.getAchievements(),
      ]);

      setAllowance(tokenStatus.allowance);
      setTokenBalance(tokenStatus.balance);
      setPointsBalance(points.balance);
      setDashboard(dashboardStats);
      setAchievements(achievementsData.achievements);

      setTransactions(data.transactions);
      setTokenTotal(data.total);
      setTokenOffset(PAGE_SIZE);
      setTokenHasMore(data.transactions.length < data.total);
    } catch (err) {
      setError('Failed to load wallet data. Please try again.');
      showError('Failed to load wallet data');
      console.error('Failed to load transactions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMoreTokens = async () => {
    setIsLoadingMore(true);
    try {
      const data = await api.getTransactions(PAGE_SIZE, tokenOffset);
      setTransactions((prev) => [...prev, ...data.transactions]);
      setTokenOffset((prev) => prev + PAGE_SIZE);
      setTokenHasMore(transactions.length + data.transactions.length < data.total);
    } catch (err) {
      showError('Failed to load more token transactions');
      console.error('Failed to load more transactions:', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const loadPointsTransactions = async () => {
    setIsPointsLoading(true);
    try {
      const data = await api.getPointsTransactions(PAGE_SIZE, 0);
      setPointsTransactions(data.transactions);
      setPointsTotal(data.total);
      setPointsOffset(PAGE_SIZE);
      setPointsHasMore(data.transactions.length < data.total);
    } catch (err) {
      showError('Failed to load points history');
      console.error('Failed to load points transactions:', err);
    } finally {
      setIsPointsLoading(false);
    }
  };

  const loadMorePoints = async () => {
    setIsLoadingMorePoints(true);
    try {
      const data = await api.getPointsTransactions(PAGE_SIZE, pointsOffset);
      setPointsTransactions((prev) => [...prev, ...data.transactions]);
      setPointsOffset((prev) => prev + PAGE_SIZE);
      setPointsHasMore(pointsTransactions.length + data.transactions.length < data.total);
    } catch (err) {
      showError('Failed to load more points transactions');
      console.error('Failed to load more points transactions:', err);
    } finally {
      setIsLoadingMorePoints(false);
    }
  };

  // Calculate token stats from loaded transactions
  const tokenStats = transactions.reduce(
    (acc, tx) => {
      if (tx.amount > 0) {
        acc.totalEarned += tx.amount;
      } else {
        acc.totalSpent += Math.abs(tx.amount);
      }
      return acc;
    },
    { totalEarned: 0, totalSpent: 0 }
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Wallet</h1>
        <p className="text-gray-600 mt-1">Your tokens, points, and history</p>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2">
        <Card className="bg-gradient-to-r from-primary-500 to-accent-500 text-white">
          <div className="text-center py-4">
            <p className="text-white/80 text-sm uppercase tracking-wide">
              Tokens Available
            </p>
            <p className="text-5xl font-bold my-2">
              {formatTokens(tokenBalance)}
            </p>
            <p className="text-white/80">tokens</p>
            {dashboard && (
              <>
                <p className="mt-2 text-xs text-white/80">
                  Next reset: {formatDate(dashboard.allowance.nextResetAt)}
                </p>
                <p className="text-xs text-white/80">
                  Days to max stack: {dashboard.allowance.daysUntilMaxStack}
                </p>
              </>
            )}
          </div>
        </Card>
        <Card className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white">
          <div className="text-center py-4">
            <p className="text-white/80 text-sm uppercase tracking-wide">
              Points Balance
            </p>
            <p className="text-5xl font-bold my-2">
              {formatPoints(pointsBalance)}
            </p>
            <p className="text-white/80">points</p>
          </div>
        </Card>
      </div>

      {/* Token Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <p className="text-sm text-gray-500">Total Earned</p>
          <p className="text-2xl font-bold text-green-600">
            +{formatTokens(tokenStats.totalEarned)}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Total Spent</p>
          <p className="text-2xl font-bold text-red-600">
            -{formatTokens(tokenStats.totalSpent)}
          </p>
        </Card>
      </div>

      {dashboard && (
        <>
          <div className="grid gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <p className="text-sm text-gray-500">Total Predictions</p>
              <p className="text-2xl font-semibold text-gray-900">
                {dashboard.predictionStats.total}
              </p>
            </Card>
            <Card>
              <p className="text-sm text-gray-500">Wins / Losses</p>
              <p className="text-2xl font-semibold text-gray-900">
                {dashboard.predictionStats.won}/{dashboard.predictionStats.lost}
              </p>
            </Card>
            <Card>
              <p className="text-sm text-gray-500">Win Rate</p>
              <p className="text-2xl font-semibold text-emerald-700">
                {dashboard.predictionStats.winRate.toFixed(1)}%
              </p>
            </Card>
            <Card>
              <p className="text-sm text-gray-500">Total Points Earned</p>
              <p className="text-2xl font-semibold text-primary-700">
                {formatPoints(dashboard.predictionStats.totalPointsEarned)}
              </p>
            </Card>
          </div>

          <div className="grid gap-4 mb-6 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 font-semibold text-gray-900">Streak</h2>
              <p
                className={`text-3xl font-bold ${
                  dashboard.streak.current >= 3 ? 'text-amber-600 animate-pulse' : 'text-gray-900'
                }`}
              >
                🔥 {dashboard.streak.current}
              </p>
              <p className="mt-2 text-sm text-gray-600">
                Longest streak: {dashboard.streak.longest}
              </p>
            </Card>

            <Card>
              <h2 className="mb-3 font-semibold text-gray-900">Recent Activity</h2>
              {dashboard.recentActivity.length === 0 ? (
                <p className="text-sm text-gray-500">No recent activity yet.</p>
              ) : (
                <div className="space-y-2">
                  {dashboard.recentActivity.map((activity) => (
                    <div key={`${activity.currency}-${activity.id}`} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="font-medium text-gray-800">
                          {activity.currency === 'TOKENS' ? '🪙' : '🏆'} {getTransactionLabel(activity.type)}
                        </p>
                        <p className="text-xs text-gray-500">{formatRelativeTime(activity.createdAt)}</p>
                      </div>
                      <p className={getTransactionColor(activity.amount)}>
                        {activity.amount > 0 ? '+' : ''}
                        {activity.currency === 'TOKENS'
                          ? formatTokens(activity.amount)
                          : formatPoints(activity.amount)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 mb-6 lg:grid-cols-2">
            <Card>
              <h2 className="mb-4 font-semibold text-gray-900">Closest Achievements</h2>
              {dashboard.achievementProgress.length === 0 ? (
                <p className="text-sm text-gray-500">All achievements unlocked.</p>
              ) : (
                <div className="space-y-3">
                  {dashboard.achievementProgress.map((item) => (
                    <div key={item.key}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <p className="font-medium text-gray-800">
                          {item.iconEmoji} {item.name}
                        </p>
                        <p className="text-gray-500">
                          {item.currentValue}/{item.threshold}
                        </p>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-primary-500"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <h2 className="mb-4 font-semibold text-gray-900">Daily Allowance Status</h2>
              <div className="space-y-2 text-sm">
                <p className="text-gray-700">
                  Tokens remaining: <span className="font-semibold">{allowance?.tokensRemaining ?? 0}</span>
                </p>
                <p className="text-gray-700">
                  Next reset: <span className="font-semibold">{formatDate(dashboard.allowance.nextResetAt)}</span>
                </p>
                <p className="text-gray-700">
                  Days until max stack: <span className="font-semibold">{dashboard.allowance.daysUntilMaxStack}</span>
                </p>
              </div>
            </Card>
          </div>
        </>
      )}

      <Card className="mb-6">
        <h2 className="mb-4 font-semibold text-gray-900">Achievements</h2>
        {achievements.length === 0 ? (
          <p className="text-sm text-gray-500">No achievements yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {achievements.map((achievement) => {
              const unlocked = Boolean(achievement.unlockedAt);
              return (
                <div
                  key={achievement.key}
                  className={`rounded-lg border p-3 ${
                    unlocked ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <p className="font-medium text-gray-900">
                    {achievement.iconEmoji} {achievement.name}
                  </p>
                  <p className="mt-1 text-xs text-gray-600">{achievement.description}</p>
                  {unlocked ? (
                    <p className="mt-2 text-xs font-medium text-emerald-700">
                      Unlocked {formatDate(achievement.unlockedAt as string)}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-gray-500">
                      Progress: {achievement.currentValue}/{achievement.threshold}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* History Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveTab('tokens')}
          className={`px-4 py-2 font-medium rounded-lg transition-colors ${
            activeTab === 'tokens'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Token History
          {tokenTotal > 0 && (
            <span className="ml-2 text-xs opacity-75">({tokenTotal})</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('points')}
          className={`px-4 py-2 font-medium rounded-lg transition-colors ${
            activeTab === 'points'
              ? 'bg-emerald-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Points History
          {pointsTotal > 0 && (
            <span className="ml-2 text-xs opacity-75">({pointsTotal})</span>
          )}
        </button>
      </div>

      {/* Token History */}
      {activeTab === 'tokens' && (
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">
            Token Transactions
          </h2>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-600 mb-4">{error}</p>
              <button
                onClick={loadWalletData}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                Retry
              </button>
            </div>
          ) : transactions.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              description="Your token history will appear here"
            />
          ) : (
            <>
              <div className="divide-y divide-gray-100">
                {transactions.map((tx) => (
                  <TokenTransactionRow key={tx.id} transaction={tx} />
                ))}
              </div>
              {tokenHasMore && (
                <div className="mt-4 text-center">
                  <button
                    onClick={loadMoreTokens}
                    disabled={isLoadingMore}
                    className="px-4 py-2 text-sm font-medium text-primary-600 hover:text-primary-800 disabled:opacity-50"
                  >
                    {isLoadingMore ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* Points History */}
      {activeTab === 'points' && (
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4">
            Points Transactions
          </h2>

          {isPointsLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : pointsTransactions.length === 0 ? (
            <EmptyState
              title="No points transactions yet"
              description="Win predictions or cash out to earn points"
            />
          ) : (
            <>
              <div className="divide-y divide-gray-100">
                {pointsTransactions.map((tx) => (
                  <PointsTransactionRow key={tx.id} transaction={tx} />
                ))}
              </div>
              {pointsHasMore && (
                <div className="mt-4 text-center">
                  <button
                    onClick={loadMorePoints}
                    disabled={isLoadingMorePoints}
                    className="px-4 py-2 text-sm font-medium text-emerald-600 hover:text-emerald-800 disabled:opacity-50"
                  >
                    {isLoadingMorePoints ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}

// =============================================================================
// TOKEN TRANSACTION ROW
// =============================================================================

function TokenTransactionRow({ transaction }: { transaction: TokenTransaction }) {
  const isCredit = transaction.amount > 0;

  const getIcon = (type: string): string => {
    const icons: Record<string, string> = {
      DAILY_ALLOWANCE: '📅',
      SIGNUP_BONUS: '🎁',
      PREDICTION_STAKE: '🎯',
      PREDICTION_WIN: '🏆',
      PREDICTION_REFUND: '↩️',
      STREAK_BONUS: '🔥',
      CASHOUT: '💸',
      REDEMPTION: '🎁',
      REDEMPTION_REFUND: '↩️',
      PURCHASE: '💳',
      ADMIN_CREDIT: '⭐',
      ADMIN_DEBIT: '⚠️',
    };
    return icons[type] ?? '💰';
  };

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3">
        <span className="text-xl">{getIcon(transaction.type)}</span>
        <div>
          <p className="font-medium text-gray-900">
            {getTransactionLabel(transaction.type)}
          </p>
          <p className="text-xs text-gray-500">
            {formatDate(transaction.createdAt)}
          </p>
          {transaction.description && (
            <p className="text-xs text-gray-400 mt-0.5">
              {transaction.description}
            </p>
          )}
        </div>
      </div>

      <div className="text-right">
        <p className={`font-semibold ${getTransactionColor(transaction.amount)}`}>
          {isCredit ? '+' : ''}{formatTokens(transaction.amount)}
        </p>
        <p className="text-xs text-gray-500">
          Balance: {formatTokens(transaction.balanceAfter)}
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// POINTS TRANSACTION ROW
// =============================================================================

function PointsTransactionRow({ transaction }: { transaction: PointsTransaction }) {
  const isCredit = transaction.amount > 0;

  const getIcon = (type: string): string => {
    const icons: Record<string, string> = {
      PREDICTION_WIN: '🏆',
      CASHOUT: '💸',
      REDEMPTION: '🎁',
      REDEMPTION_REFUND: '↩️',
      ADMIN_CREDIT: '⭐',
      ADMIN_DEBIT: '⚠️',
    };
    return icons[type] ?? '🏅';
  };

  const getLabel = (type: string): string => {
    const labels: Record<string, string> = {
      PREDICTION_WIN: 'Prediction Win',
      CASHOUT: 'Cashout',
      REDEMPTION: 'Reward Redeemed',
      REDEMPTION_REFUND: 'Redemption Refund',
      ADMIN_CREDIT: 'Admin Credit',
      ADMIN_DEBIT: 'Admin Debit',
    };
    return labels[type] ?? type;
  };

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3">
        <span className="text-xl">{getIcon(transaction.type)}</span>
        <div>
          <p className="font-medium text-gray-900">
            {getLabel(transaction.type)}
          </p>
          <p className="text-xs text-gray-500">
            {formatDate(transaction.createdAt)}
          </p>
          {transaction.description && (
            <p className="text-xs text-gray-400 mt-0.5">
              {transaction.description}
            </p>
          )}
        </div>
      </div>

      <div className="text-right">
        <p className={`font-semibold ${getTransactionColor(transaction.amount)}`}>
          {isCredit ? '+' : ''}{formatPoints(transaction.amount)} pts
        </p>
        <p className="text-xs text-gray-500">
          Balance: {formatPoints(transaction.balanceAfter)}
        </p>
      </div>
    </div>
  );
}
