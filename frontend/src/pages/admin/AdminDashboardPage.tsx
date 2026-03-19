import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Button, Card, StatCard, Spinner, InlineError } from '../../components/ui';
import type { AdminStats, SettlementStatus } from '../../types';

export function AdminDashboardPage() {
  const toast = useToast();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [settlement, setSettlement] = useState<SettlementStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [settleLoading, setSettleLoading] = useState(false);
  const [autoLockLoading, setAutoLockLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(false);
    try {
      const [statsRes, settlementRes] = await Promise.all([
        api.getAdminStats(),
        api.getSettlementStatus(),
      ]);
      setStats(statsRes.stats);
      setSettlement(settlementRes.status);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSyncOdds = async () => {
    setSyncLoading(true);
    try {
      const result = await api.triggerOddsSync();
      toast.success(
        `Odds synced. ${result.updatedEvents} events updated. Quota: ${result.quota.remainingRequests ?? '?'} remaining`
      );
    } catch {
      toast.error('Failed to sync odds');
    } finally {
      setSyncLoading(false);
    }
  };

  const handleRunSettlement = async () => {
    setSettleLoading(true);
    try {
      await api.triggerSettlement();
      toast.success('Settlement run complete');
      const res = await api.getSettlementStatus();
      setSettlement(res.status);
    } catch {
      toast.error('Failed to run settlement');
    } finally {
      setSettleLoading(false);
    }
  };

  const handleAutoLock = async () => {
    setAutoLockLoading(true);
    try {
      const result = await api.autoLockEvents();
      toast.success(`Auto-locked ${result.locked} event(s)`);
      loadData();
    } catch {
      toast.error('Failed to auto-lock events');
    } finally {
      setAutoLockLoading(false);
    }
  };

  const handleImportEvents = async () => {
    setImportLoading(true);
    try {
      await api.triggerEventImport();
      toast.success('Event import complete');
      loadData();
    } catch {
      toast.error('Failed to import events');
    } finally {
      setImportLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !stats) {
    return <InlineError message="Failed to load admin stats" onRetry={loadData} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Users" value={stats.users} />
        <StatCard label="Open Events" value={stats.events.open} subValue={`${stats.events.total} total`} />
        <StatCard label="Predictions" value={stats.predictions} />
        <StatCard
          label="Pending Redemptions"
          value={stats.redemptions.pending}
          subValue={`${stats.redemptions.total} total`}
        />
        <StatCard
          label="Tokens in Circulation"
          value={stats.tokens.inCirculation.toLocaleString()}
        />
      </div>

      {/* Points stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard
          label="Points in Circulation"
          value={stats.points.inCirculation.toLocaleString()}
        />
        <StatCard
          label="Total Points Earned"
          value={stats.points.totalPaidOut.toLocaleString()}
        />
        <StatCard
          label="Total Points Redeemed"
          value={stats.points.totalRedeemed.toLocaleString()}
        />
      </div>

      {/* Quick actions */}
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Button size="sm" isLoading={syncLoading} onClick={handleSyncOdds}>
            Sync Odds
          </Button>
          <Button size="sm" isLoading={settleLoading} onClick={handleRunSettlement}>
            Run Settlement
          </Button>
          <Button size="sm" isLoading={autoLockLoading} onClick={handleAutoLock}>
            Auto-Lock Events
          </Button>
          <Button
            size="sm"
            variant="secondary"
            isLoading={importLoading}
            onClick={handleImportEvents}
          >
            Import Events
          </Button>
        </div>
      </Card>

      {/* Settlement status */}
      {settlement && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">Settlement Worker</h2>
          <div className="flex items-center gap-3">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                settlement.isRunning ? 'bg-green-500' : 'bg-gray-300'
              }`}
            />
            <span className="text-sm text-gray-600">
              {settlement.isRunning ? 'Running' : 'Idle'}
            </span>
            {settlement.lastRunAt && (
              <span className="text-sm text-gray-400">
                Last run: {new Date(settlement.lastRunAt).toLocaleString()}
              </span>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
