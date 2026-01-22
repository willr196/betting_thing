import { useState, useEffect } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatPoints, getStatusColor, formatDate } from '../lib/utils';
import { Card, Badge, Button, Spinner, EmptyState } from '../components/ui';
import type { Reward, Redemption } from '../types';

export function RewardsPage() {
  const { user, refreshUser } = useAuth();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'store' | 'history'>('store');
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [rewardsData, redemptionsData] = await Promise.all([
        api.getRewards(),
        api.getMyRedemptions(),
      ]);
      setRewards(rewardsData.rewards);
      setRedemptions(redemptionsData.redemptions);
    } catch (error) {
      console.error('Failed to load rewards:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRedeem = async (reward: Reward) => {
    if ((user?.pointsBalance ?? 0) < reward.pointsCost) {
      setError('Insufficient balance');
      return;
    }

    setError('');
    setSuccess('');
    setRedeemingId(reward.id);

    try {
      await api.redeemReward(reward.id);
      setSuccess(`Successfully redeemed ${reward.name}!`);
      await Promise.all([refreshUser(), loadData()]);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to redeem reward');
      }
    } finally {
      setRedeemingId(null);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Rewards</h1>
        <p className="text-gray-600 mt-1">
          Redeem your points for real rewards
        </p>
      </div>

      {/* Balance */}
      <Card className="mb-6 bg-gradient-to-r from-emerald-500 to-teal-500 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-primary-100">Your Balance</p>
            <p className="text-3xl font-bold">
              {formatPoints(user?.pointsBalance ?? 0)} points
            </p>
          </div>
          <span className="text-5xl">🏆</span>
        </div>
      </Card>

      {/* Alerts */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-600">
          {success}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('store')}
          className={`px-4 py-2 font-medium rounded-lg transition-colors ${
            activeTab === 'store'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Store
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 font-medium rounded-lg transition-colors ${
            activeTab === 'history'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          My Redemptions
          {redemptions.length > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-white/20 rounded-full text-xs">
              {redemptions.length}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : activeTab === 'store' ? (
        rewards.length === 0 ? (
          <EmptyState
            title="No rewards available"
            description="Check back later for new rewards"
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rewards.map((reward) => (
              <RewardCard
                key={reward.id}
                reward={reward}
                userBalance={user?.pointsBalance ?? 0}
                isRedeeming={redeemingId === reward.id}
                onRedeem={() => handleRedeem(reward)}
              />
            ))}
          </div>
        )
      ) : redemptions.length === 0 ? (
        <EmptyState
          title="No redemptions yet"
          description="Redeem your first reward from the store"
          action={
            <Button onClick={() => setActiveTab('store')}>Browse Store</Button>
          }
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
      <div className="h-32 bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg mb-4 flex items-center justify-center text-4xl">
        🎁
      </div>

      <h3 className="font-semibold text-gray-900 mb-1">{reward.name}</h3>
      
      {reward.description && (
        <p className="text-sm text-gray-600 mb-3 flex-1">{reward.description}</p>
      )}

      {/* Stock info */}
      {reward.stockLimit && (
        <p className="text-xs text-gray-500 mb-3">
          {reward.stockLimit - reward.stockClaimed} of {reward.stockLimit} remaining
        </p>
      )}

      {/* Price */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-lg font-bold text-primary-600">
          {formatPoints(reward.pointsCost)} points
        </span>
        {!canAfford && (
          <span className="text-xs text-red-500">
            Need {formatPoints(reward.pointsCost - userBalance)} more
          </span>
        )}
      </div>

      <Button
        onClick={onRedeem}
        disabled={!canAfford || isOutOfStock || isRedeeming}
        isLoading={isRedeeming}
        className="w-full"
      >
        {isOutOfStock ? 'Out of Stock' : canAfford ? 'Redeem' : 'Insufficient Balance'}
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
          <div className="flex items-center gap-2 mb-2">
            <Badge className={getStatusColor(redemption.status)}>
              {redemption.status}
            </Badge>
          </div>

          <h3 className="font-semibold text-gray-900">
            {redemption.reward?.name ?? 'Unknown Reward'}
          </h3>

          <p className="text-sm text-gray-500 mt-1">
            Redeemed on {formatDate(redemption.createdAt)}
          </p>

          {redemption.fulfilmentNote && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">
                <span className="font-medium">Note:</span> {redemption.fulfilmentNote}
              </p>
            </div>
          )}
        </div>

        <div className="text-right">
          <p className="text-sm text-gray-500">Cost</p>
          <p className="font-semibold">{formatPoints(redemption.pointsCost)} points</p>
        </div>
      </div>
    </Card>
  );
}
