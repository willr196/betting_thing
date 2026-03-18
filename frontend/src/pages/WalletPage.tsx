import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import {
  formatTokens,
  formatPoints,
  formatGBP,
  formatDate,
  formatRelativeTime,
  getTransactionColor,
  getTransactionLabel,
} from '../lib/utils';
import { Badge, Button, Card, Spinner, EmptyState } from '../components/ui';
import type {
  TokenAllowance,
  TokenTransaction,
  PointsTransaction,
  DashboardStats,
  Achievement,
} from '../types';
import { TOKEN_VALUE_GBP } from '../lib/tokenRules';

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

  const allowanceWindow = dashboard?.allowance ?? null;
  const settledPredictionCount = dashboard
    ? dashboard.predictionStats.won + dashboard.predictionStats.lost
    : 0;
  const tokenValueLabel = formatGBP(tokenBalance * TOKEN_VALUE_GBP);
  const nextRefillRelativeLabel =
    allowanceWindow === null ? 'Loading refill window' : formatRelativeTime(allowanceWindow.nextRefillAt);
  const stackRuleLabel =
    allowanceWindow === null
      ? 'Loading stack rule'
      : `${allowanceWindow.weeklyStartTokens} to start · +${allowanceWindow.dailyAllowance} daily · ${allowanceWindow.maxStack} max`;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[36px] border border-white/70 bg-[linear-gradient(135deg,rgba(32,61,57,0.97),rgba(47,114,106,0.92)_52%,rgba(199,103,23,0.88))] p-6 text-white shadow-[0_36px_90px_-54px_rgba(15,23,42,0.85)] sm:p-8">
        <div className="absolute -right-10 top-0 h-44 w-44 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-36 w-36 rounded-full bg-white/10 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-xs uppercase tracking-[0.34em] text-white/60">Wallet</p>
            <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">
              Weekly starters, daily top-ups, and clear token value.
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-white/78 sm:text-base">
              Each week begins with a 5-token allowance, then 1 token lands each day after that,
              up to the weekly cap. Every token is worth £1 in play, and win rate is based only on
              settled wins and losses.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Badge className="border border-white/20 bg-white/10 text-white">
                {allowanceWindow ? `${allowanceWindow.weeklyStartTokens} at week start` : 'Weekly start'}
              </Badge>
              <Badge className="border border-white/20 bg-white/10 text-white">
                {allowanceWindow ? `+${allowanceWindow.dailyAllowance} daily` : 'Daily top-up'}
              </Badge>
              <Badge className="border border-white/20 bg-white/10 text-white">
                {allowanceWindow ? `${allowanceWindow.maxStack} token cap` : 'Stack cap'}
              </Badge>
              <Badge className="border border-white/20 bg-white/10 text-white">
                1 token = £1
              </Badge>
              {allowanceWindow && (
                <Badge className="border border-white/20 bg-white/10 text-white">
                  Next refill {formatDate(allowanceWindow.nextRefillAt)}
                </Badge>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HeroBalanceCard
              label="Tokens live"
              value={formatTokens(tokenBalance)}
              footer={allowanceWindow ? `${tokenValueLabel} in promotional play` : 'Loading token value'}
            />
            <HeroBalanceCard
              label="Points banked"
              value={formatPoints(pointsBalance)}
              footer="Earned from wins and cashouts"
            />
            <HeroBalanceCard
              label="Tokens earned"
              value={`+${formatTokens(tokenStats.totalEarned)}`}
              footer="All-time credits in wallet history"
              tone="warm"
            />
            <HeroBalanceCard
              label="Tokens spent"
              value={`-${formatTokens(tokenStats.totalSpent)}`}
              footer="Predictions and redemptions"
              tone="warm"
            />
          </div>
        </div>
      </section>

      {dashboard && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <WalletStatCard
              label="Total Predictions"
              value={dashboard.predictionStats.total}
              detail={`${dashboard.predictionStats.pending} still pending`}
            />
            <WalletStatCard
              label="Wins / Losses"
              value={`${dashboard.predictionStats.won}/${dashboard.predictionStats.lost}`}
              detail={`${settledPredictionCount} settled results`}
            />
            <WalletStatCard
              label="Win Rate"
              value={`${dashboard.predictionStats.winRate.toFixed(1)}%`}
              detail="Calculated from wins and losses only"
              tone="success"
            />
            <WalletStatCard
              label="Total Points Earned"
              value={formatPoints(dashboard.predictionStats.totalPointsEarned)}
              detail={`${formatPoints(dashboard.predictionStats.totalWinnings)} raw winnings`}
              tone="brand"
            />
            <WalletStatCard
              label="Current Streak"
              value={dashboard.streak.current}
              detail={`Longest streak ${dashboard.streak.longest}`}
              tone={dashboard.streak.current >= 3 ? 'accent' : 'default'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <Card className="overflow-hidden bg-white/88">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Momentum</p>
                  <h2 className="mt-2 text-xl font-semibold text-gray-900">Weekly Token Schedule</h2>
                </div>
                <div className="rounded-full border border-primary-100 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
                  Week starts Monday 00:00 UTC
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[24px] border border-primary-100 bg-primary-50/70 p-4">
                  <p className="text-sm text-primary-700">Available now</p>
                  <p className="mt-2 text-3xl font-semibold text-gray-900">
                    {allowance?.tokensRemaining ?? tokenBalance}
                  </p>
                  <p className="mt-2 text-sm text-gray-600">
                    Worth {formatGBP((allowance?.tokensRemaining ?? tokenBalance) * TOKEN_VALUE_GBP)} in play.
                  </p>
                </div>
                <div className="rounded-[24px] border border-amber-100 bg-amber-50/80 p-4">
                  <p className="text-sm text-amber-800">Next daily top-up</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900">
                    {formatDate(dashboard.allowance.nextRefillAt)}
                  </p>
                  <p className="mt-2 text-sm text-gray-600">Arrives {nextRefillRelativeLabel}.</p>
                </div>
                <div className="rounded-[24px] border border-gray-200 bg-white/70 p-4">
                  <p className="text-sm text-gray-500">Last allowance checkpoint</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900">
                    {formatDate(dashboard.allowance.lastRefillAt)}
                  </p>
                </div>
                <div className="rounded-[24px] border border-gray-200 bg-white/70 p-4">
                  <p className="text-sm text-gray-500">Stack rule</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900">
                    {stackRuleLabel}
                  </p>
                  <p className="mt-2 text-sm text-gray-600">
                    Monday brings the starter stack, then one token arrives each day after that.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="overflow-hidden bg-white/88">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Flow</p>
                  <h2 className="mt-2 text-xl font-semibold text-gray-900">Recent Activity</h2>
                </div>
                <div className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-500">
                  Latest 5 events
                </div>
              </div>
              {dashboard.recentActivity.length === 0 ? (
                <p className="text-sm text-gray-500">No recent activity yet.</p>
              ) : (
                <div className="space-y-3">
                  {dashboard.recentActivity.map((activity) => (
                    <div
                      key={`${activity.currency}-${activity.id}`}
                      className="flex items-center justify-between rounded-[22px] border border-gray-100 bg-gray-50/80 px-4 py-3 text-sm"
                    >
                      <div className="min-w-0 pr-4">
                        <p className="truncate font-medium text-gray-800">
                          {activity.currency === 'TOKENS' ? '🪙' : '🏆'} {getTransactionLabel(activity.type)}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">{formatRelativeTime(activity.createdAt)}</p>
                      </div>
                      <p className={`shrink-0 font-semibold ${getTransactionColor(activity.amount)}`}>
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

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="bg-white/88">
              <div className="mb-4">
                <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Progress</p>
                <h2 className="mt-2 text-xl font-semibold text-gray-900">Closest Achievements</h2>
              </div>
              {dashboard.achievementProgress.length === 0 ? (
                <p className="text-sm text-gray-500">All achievements unlocked.</p>
              ) : (
                <div className="space-y-3">
                  {dashboard.achievementProgress.map((item) => (
                    <div key={item.key} className="rounded-[22px] border border-gray-100 bg-gray-50/70 p-4">
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <p className="font-medium text-gray-800">
                          {item.iconEmoji} {item.name}
                        </p>
                        <p className="text-gray-500">
                          {item.currentValue}/{item.threshold}
                        </p>
                      </div>
                      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white">
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
          </div>
        </>
      )}

      <Card className="bg-white/88">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Collection</p>
            <h2 className="mt-2 text-xl font-semibold text-gray-900">Achievements</h2>
          </div>
          <div className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-500">
            {achievements.length} tracked
          </div>
        </div>
        {achievements.length === 0 ? (
          <p className="text-sm text-gray-500">No achievements yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {achievements.map((achievement) => {
              const unlocked = Boolean(achievement.unlockedAt);
              return (
                <div
                  key={achievement.key}
                  className={`rounded-[24px] border p-4 transition-transform duration-200 hover:-translate-y-0.5 ${
                    unlocked
                      ? 'border-emerald-200 bg-[linear-gradient(135deg,rgba(236,253,245,0.95),rgba(209,250,229,0.8))]'
                      : 'border-gray-200 bg-gray-50/80'
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

      <div className="inline-flex rounded-full border border-white/70 bg-white/80 p-1 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.35)]">
        <button
          onClick={() => setActiveTab('tokens')}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
            activeTab === 'tokens'
              ? 'bg-primary-600 text-white shadow-[0_18px_30px_-20px_rgba(47,114,106,0.9)]'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Token History
          {tokenTotal > 0 && (
            <span className="ml-2 text-xs opacity-75">({tokenTotal})</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('points')}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
            activeTab === 'points'
              ? 'bg-emerald-600 text-white shadow-[0_18px_30px_-20px_rgba(5,150,105,0.9)]'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Points History
          {pointsTotal > 0 && (
            <span className="ml-2 text-xs opacity-75">({pointsTotal})</span>
          )}
        </button>
      </div>

      {activeTab === 'tokens' && (
        <Card className="bg-white/88">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Ledger</p>
              <h2 className="mt-2 text-xl font-semibold text-gray-900">Token Transactions</h2>
            </div>
            <div className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-500">
              {tokenTotal} total
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-600 mb-4">{error}</p>
              <Button onClick={loadWalletData}>Retry</Button>
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
                    className="rounded-full px-4 py-2 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50 disabled:opacity-50"
                  >
                    {isLoadingMore ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {activeTab === 'points' && (
        <Card className="bg-white/88">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Ledger</p>
              <h2 className="mt-2 text-xl font-semibold text-gray-900">Points Transactions</h2>
            </div>
            <div className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-500">
              {pointsTotal} total
            </div>
          </div>

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
                    className="rounded-full px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
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

function HeroBalanceCard({
  label,
  value,
  footer,
  tone = 'cool',
}: {
  label: string;
  value: string;
  footer: string;
  tone?: 'cool' | 'warm';
}) {
  return (
    <div
      className={`rounded-[28px] border p-5 backdrop-blur ${
        tone === 'warm'
          ? 'border-white/10 bg-black/10'
          : 'border-white/15 bg-white/10'
      }`}
    >
      <p className="text-sm uppercase tracking-[0.18em] text-white/60">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-white/72">{footer}</p>
    </div>
  );
}

function WalletStatCard({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: 'default' | 'brand' | 'success' | 'accent';
}) {
  const valueClasses = {
    default: 'text-gray-900',
    brand: 'text-primary-700',
    success: 'text-emerald-700',
    accent: 'text-amber-700',
  };

  return (
    <Card className="bg-white/88">
      <p className="text-xs uppercase tracking-[0.28em] text-gray-400">{label}</p>
      <p className={`mt-3 text-3xl font-semibold ${valueClasses[tone]}`}>{value}</p>
      <p className="mt-2 text-sm text-gray-500">{detail}</p>
    </Card>
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
    <div className="flex items-center justify-between rounded-[22px] px-2 py-3 transition-colors hover:bg-black/[0.015]">
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
    <div className="flex items-center justify-between rounded-[22px] px-2 py-3 transition-colors hover:bg-black/[0.015]">
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
