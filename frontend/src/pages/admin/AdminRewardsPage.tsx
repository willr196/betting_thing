import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Button, Card, Badge, FilterChip, Input, Spinner, InlineError } from '../../components/ui';
import type { Reward, AdminRedemption, RedemptionStatus } from '../../types';

const REDEMPTION_FILTERS: { label: string; value: string | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Fulfilled', value: 'FULFILLED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

const REDEMPTION_STATUS_COLORS: Record<RedemptionStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  FULFILLED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

export function AdminRewardsPage() {
  const [tab, setTab] = useState<'rewards' | 'redemptions'>('rewards');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Rewards</h1>
      <div className="flex gap-2">
        <FilterChip active={tab === 'rewards'} onClick={() => setTab('rewards')}>
          Rewards
        </FilterChip>
        <FilterChip
          active={tab === 'redemptions'}
          onClick={() => setTab('redemptions')}
        >
          Redemptions
        </FilterChip>
      </div>

      {tab === 'rewards' ? <RewardsTab /> : <RedemptionsTab />}
    </div>
  );
}

// =============================================================================
// REWARDS TAB
// =============================================================================

function RewardsTab() {
  const toast = useToast();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingReward, setEditingReward] = useState<Reward | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pointsCost, setPointsCost] = useState('');
  const [stockLimit, setStockLimit] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const loadRewards = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await api.getAdminRewards();
      setRewards(result.rewards);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRewards();
  }, [loadRewards]);

  const openCreate = () => {
    setEditingReward(null);
    setName('');
    setDescription('');
    setPointsCost('');
    setStockLimit('');
    setImageUrl('');
    setShowModal(true);
  };

  const openEdit = (reward: Reward) => {
    setEditingReward(reward);
    setName(reward.name);
    setDescription(reward.description || '');
    setPointsCost(String(reward.pointsCost));
    setStockLimit(reward.stockLimit ? String(reward.stockLimit) : '');
    setImageUrl(reward.imageUrl || '');
    setShowModal(true);
  };

  const handleSubmit = async () => {
    const cost = parseInt(pointsCost, 10);
    if (!name || !cost || cost <= 0) {
      toast.warning('Name and valid points cost are required');
      return;
    }
    setActionLoading(true);
    try {
      if (editingReward) {
        await api.updateAdminReward(editingReward.id, {
          name,
          description: description || undefined,
          pointsCost: cost,
          stockLimit: stockLimit ? parseInt(stockLimit, 10) : null,
          imageUrl: imageUrl || null,
        });
        toast.success('Reward updated');
      } else {
        await api.createAdminReward({
          name,
          description: description || undefined,
          pointsCost: cost,
          stockLimit: stockLimit ? parseInt(stockLimit, 10) : undefined,
          imageUrl: imageUrl || undefined,
        });
        toast.success('Reward created');
      }
      setShowModal(false);
      loadRewards();
    } catch {
      toast.error('Failed to save reward');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleActive = async (reward: Reward) => {
    try {
      await api.updateAdminReward(reward.id, { isActive: !reward.isActive });
      toast.success(reward.isActive ? 'Reward deactivated' : 'Reward activated');
      loadRewards();
    } catch {
      toast.error('Failed to update reward');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <InlineError message="Failed to load rewards" onRetry={loadRewards} />;
  }

  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate}>
          Create Reward
        </Button>
      </div>

      {rewards.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-gray-500">No rewards yet</p>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Points Cost</th>
                <th className="px-3 py-3">Stock</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rewards.map((reward) => (
                <tr key={reward.id} className="border-b border-gray-100">
                  <td className="px-3 py-3 font-medium text-gray-900">{reward.name}</td>
                  <td className="px-3 py-3 text-gray-600">
                    {reward.pointsCost.toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-gray-500">
                    {reward.stockLimit
                      ? `${reward.stockClaimed}/${reward.stockLimit}`
                      : `${reward.stockClaimed} claimed`}
                  </td>
                  <td className="px-3 py-3">
                    <Badge
                      className={
                        reward.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }
                    >
                      {reward.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(reward)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(reward)}
                      >
                        {reward.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-md bg-white">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              {editingReward ? 'Edit Reward' : 'Create Reward'}
            </h2>
            <div className="space-y-3">
              <Input
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Reward name"
              />
              <Input
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
              />
              <Input
                label="Points Cost"
                type="number"
                min="1"
                value={pointsCost}
                onChange={(e) => setPointsCost(e.target.value)}
                placeholder="100"
              />
              <Input
                label="Stock Limit (blank = unlimited)"
                type="number"
                min="1"
                value={stockLimit}
                onChange={(e) => setStockLimit(e.target.value)}
                placeholder="Unlimited"
              />
              <Input
                label="Image URL"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button size="sm" isLoading={actionLoading} onClick={handleSubmit}>
                {editingReward ? 'Save' : 'Create'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

// =============================================================================
// REDEMPTIONS TAB
// =============================================================================

function RedemptionsTab() {
  const toast = useToast();
  const [redemptions, setRedemptions] = useState<AdminRedemption[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [fulfilNote, setFulfilNote] = useState('');
  const [fulfilId, setFulfilId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const PAGE_SIZE = 20;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await api.getAdminRedemptions(statusFilter, PAGE_SIZE, offset);
      setRedemptions(result.redemptions);
      setTotal(result.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [offset, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFulfil = async (id: string) => {
    setActionLoading(id);
    try {
      await api.fulfilRedemption(id, fulfilNote || undefined);
      toast.success('Redemption fulfilled');
      setFulfilId(null);
      setFulfilNote('');
      loadData();
    } catch {
      toast.error('Failed to fulfil redemption');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: string) => {
    setActionLoading(id);
    try {
      await api.cancelRedemption(id);
      toast.success('Redemption cancelled, points refunded');
      loadData();
    } catch {
      toast.error('Failed to cancel redemption');
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <InlineError message="Failed to load redemptions" onRetry={loadData} />;
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {REDEMPTION_FILTERS.map((f) => (
          <FilterChip
            key={f.label}
            active={statusFilter === f.value}
            onClick={() => {
              setStatusFilter(f.value);
              setOffset(0);
            }}
          >
            {f.label}
          </FilterChip>
        ))}
      </div>

      {redemptions.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-gray-500">No redemptions found</p>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-3 py-3">User</th>
                <th className="px-3 py-3">Reward</th>
                <th className="px-3 py-3">Points</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {redemptions.map((r) => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="px-3 py-3 text-gray-700">
                    {r.user?.email || r.userId.slice(0, 8)}
                  </td>
                  <td className="px-3 py-3 text-gray-700">
                    {r.reward?.name || r.rewardId.slice(0, 8)}
                  </td>
                  <td className="px-3 py-3 text-gray-600">{r.pointsCost}</td>
                  <td className="px-3 py-3">
                    <Badge className={REDEMPTION_STATUS_COLORS[r.status]}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-gray-500">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-3">
                    {r.status === 'PENDING' && (
                      <div className="flex items-center gap-1">
                        {fulfilId === r.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              className="w-32 rounded border border-gray-300 px-2 py-1 text-xs"
                              placeholder="Note (optional)"
                              value={fulfilNote}
                              onChange={(e) => setFulfilNote(e.target.value)}
                            />
                            <Button
                              size="sm"
                              isLoading={actionLoading === r.id}
                              onClick={() => handleFulfil(r.id)}
                            >
                              Confirm
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setFulfilId(null);
                                setFulfilNote('');
                              }}
                            >
                              X
                            </Button>
                          </div>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={() => setFulfilId(r.id)}
                            >
                              Fulfil
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              isLoading={actionLoading === r.id}
                              onClick={() => handleCancel(r.id)}
                            >
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                    {r.status === 'FULFILLED' && r.fulfilmentNote && (
                      <span className="text-xs text-gray-400">{r.fulfilmentNote}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
