import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatPoints, getStatusColor, formatDate } from '../lib/utils';
import { Card, Badge, Button, EmptyState, FilterChip, InlineError } from '../components/ui';
import type { Reward, Redemption } from '../types';

export function RewardsPage() {
  const { user, refreshUser } = useAuth();
  const { success: showSuccess, error: showError } = useToast();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [pointsBalance, setPointsBalance] = useState(user?.pointsBalance ?? 0);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'store' | 'history'>('store');
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    setPointsBalance(user?.pointsBalance ?? 0);
  }, [user?.pointsBalance]);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const [pointsData, rewardsData, redemptionsData] = await Promise.all([
        api.getPointsBalance(),
        api.getRewards(),
        api.getMyRedemptions(),
      ]);
      setPointsBalance(pointsData.balance);
      setRewards(rewardsData.rewards);
      setRedemptions(redemptionsData.redemptions);

      if ((user?.pointsBalance ?? 0) !== pointsData.balance) {
        void refreshUser();
      }
    } catch {
      setLoadError('Rewards could not be loaded right now.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRedeem = async (reward: Reward) => {
    if (pointsBalance < reward.pointsCost) {
      showError('Not enough points to redeem this reward');
      return;
    }

    setRedeemingId(reward.id);

    try {
      const result = await api.redeemReward(reward.id);
      showSuccess(`Redeemed: ${reward.name}`);
      for (const achievement of result.achievementsUnlocked ?? []) {
        showSuccess(`${achievement.iconEmoji} Achievement unlocked: ${achievement.name}`);
      }
      await Promise.all([refreshUser(), loadData()]);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Redemption failed. Please try again.';
      showError(message);
    } finally {
      setRedeemingId(null);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Rewards</h1>
        <p className="mt-1 text-sm text-gray-500">
          Earn points through predictions and redeem them for rewards.
        </p>
      </div>

      {/* Points balance hero */}
      <Card className="mb-6 overflow-hidden bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white/80">Your points balance</p>
            <p className="mt-1 text-3xl font-bold">{formatPoints(pointsBalance)} points</p>
            <p className="mt-0.5 text-sm text-white/70">available to spend</p>
          </div>
          <span className="text-5xl opacity-80">🏆</span>
        </div>
      </Card>

      {/* Tabs */}
      <div className="mb-6 flex gap-2">
        <FilterChip active={activeTab === 'store'} onClick={() => setActiveTab('store')}>
          Store
        </FilterChip>
        <FilterChip active={activeTab === 'history'} onClick={() => setActiveTab('history')}>
          My Redemptions{redemptions.length > 0 ? ` (${redemptions.length})` : ''}
        </FilterChip>
      </div>

      {/* Load error */}
      {loadError && !isLoading && (
        <InlineError message={loadError} onRetry={() => void loadData()} />
      )}

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <RewardCardSkeleton key={i} />
          ))}
        </div>
      ) : loadError ? null : activeTab === 'store' ? (
        rewards.length === 0 ? (
          <EmptyStoreState pointsBalance={pointsBalance} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rewards.map((reward) => (
              <RewardCard
                key={reward.id}
                reward={reward}
                userBalance={pointsBalance}
                isRedeeming={redeemingId === reward.id}
                onRedeem={() => handleRedeem(reward)}
              />
            ))}
          </div>
        )
      ) : redemptions.length === 0 ? (
        <EmptyState
          title="No redemptions yet"
          description="When you redeem a reward, it will appear here."
          action={<Button onClick={() => setActiveTab('store')}>Browse the store</Button>}
        />
      ) : (
        <div className="space-y-4">
          {redemptions.map((redemption) => (
            <RedemptionCard key={redemption.id} redemption={redemption} />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// EMPTY STORE STATE
// =============================================================================

function EmptyStoreState({ pointsBalance }: { pointsBalance: number }) {
  return (
    <div className="space-y-6">
      {/* Coming soon notice */}
      <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 px-6 py-10 text-center">
        <div className="mx-auto mb-3 text-4xl">🎁</div>
        <h3 className="font-semibold text-gray-800">Rewards coming soon</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-gray-500">
          New rewards are added regularly. Keep earning points so you're ready to redeem when
          they drop.
        </p>
        {pointsBalance > 0 && (
          <p className="mt-3 text-sm font-medium text-emerald-600">
            You have {formatPoints(pointsBalance)} points ready to spend.
          </p>
        )}
      </div>

      {/* How to earn */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
          How to earn points
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <EarnCard
            icon="🎯"
            title="Make predictions"
            description="Earn points on every correct pick you place."
          />
          <EarnCard
            icon="🔥"
            title="Build a streak"
            description="Consecutive correct picks earn you bonus multipliers."
          />
          <EarnCard
            icon="🏆"
            title="Climb the board"
            description="Top-ranked players unlock exclusive reward tiers."
          />
        </div>
      </div>

      <div className="text-center">
        <Link to="/events">
          <Button>Browse events and start earning</Button>
        </Link>
      </div>
    </div>
  );
}

function EarnCard({
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
// REWARD CARD SKELETON
// =============================================================================

function RewardCardSkeleton() {
  return (
    <Card className="flex flex-col">
      <div className="mb-4 h-32 animate-pulse rounded-xl bg-gray-100" />
      <div className="mb-2 h-5 w-2/3 animate-pulse rounded bg-gray-100" />
      <div className="mb-3 h-4 w-full animate-pulse rounded bg-gray-100" />
      <div className="h-9 w-full animate-pulse rounded-lg bg-gray-100" />
    </Card>
  );
}

// =============================================================================
// REWARD CARD
// =============================================================================

function RewardCard({
  reward,
  userBalance,
  isRedeeming,
  onRedeem,
}: {
  reward: Reward;
  userBalance: number;
  isRedeeming: boolean;
  onRedeem: () => void;
}) {
  const canAfford = userBalance >= reward.pointsCost;
  const isOutOfStock =
    reward.stockLimit !== null && reward.stockClaimed >= reward.stockLimit;

  return (
    <Card className="flex flex-col">
      {/* Image placeholder */}
      <div className="mb-4 flex h-32 items-center justify-center rounded-xl bg-gradient-to-br from-gray-100 to-gray-50 text-4xl">
        🎁
      </div>

      <h3 className="font-semibold text-gray-900">{reward.name}</h3>

      {reward.description && (
        <p className="mt-1 flex-1 text-sm text-gray-500">{reward.description}</p>
      )}

      {reward.stockLimit && (
        <p className="mt-2 text-xs text-gray-400">
          {reward.stockLimit - reward.stockClaimed} of {reward.stockLimit} remaining
        </p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-base font-bold text-primary-700">
          {formatPoints(reward.pointsCost)} pts
        </span>
        {!canAfford && !isOutOfStock && (
          <span className="text-xs text-gray-400">
            Need {formatPoints(reward.pointsCost - userBalance)} more
          </span>
        )}
      </div>

      <Button
        className="mt-4 w-full"
        onClick={onRedeem}
        disabled={!canAfford || isOutOfStock || isRedeeming}
        isLoading={isRedeeming}
        variant={canAfford && !isOutOfStock ? 'primary' : 'secondary'}
      >
        {isOutOfStock ? 'Out of stock' : canAfford ? 'Redeem' : 'Not enough points'}
      </Button>
    </Card>
  );
}

// =============================================================================
// REDEMPTION CARD
// =============================================================================

function RedemptionCard({ redemption }: { redemption: Redemption }) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-2">
            <Badge className={getStatusColor(redemption.status)}>
              {redemption.status.charAt(0) + redemption.status.slice(1).toLowerCase()}
            </Badge>
          </div>

          <h3 className="font-semibold text-gray-900">
            {redemption.reward?.name ?? 'Reward'}
          </h3>

          <p className="mt-1 text-xs text-gray-400">
            Redeemed {formatDate(redemption.createdAt)}
          </p>

          {redemption.fulfilmentNote && (
            <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2.5">
              <p className="text-sm text-gray-600">
                <span className="font-medium text-gray-700">Note:</span>{' '}
                {redemption.fulfilmentNote}
              </p>
            </div>
          )}
        </div>

        <div className="text-right">
          <p className="text-xs text-gray-400">Cost</p>
          <p className="font-semibold text-gray-800">{formatPoints(redemption.pointsCost)} pts</p>
        </div>
      </div>
    </Card>
  );
}
