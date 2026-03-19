import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Button, Card, Spinner, InlineError } from '../../components/ui';
import { SPORTS } from '../../lib/sports';
import type { SettlementStatus, OddsQuota, AuditLogEntry } from '../../types';

export function AdminSystemPage() {
  const toast = useToast();
  const [settlement, setSettlement] = useState<SettlementStatus | null>(null);
  const [quota, setQuota] = useState<OddsQuota | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [syncLoading, setSyncLoading] = useState(false);
  const [settleLoading, setSettleLoading] = useState(false);
  const [autoLockLoading, setAutoLockLoading] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const [sportImportLoading, setSportImportLoading] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(false);
    try {
      const [settlementRes, quotaRes, auditRes] = await Promise.all([
        api.getSettlementStatus(),
        api.getOddsQuota(),
        api.getAuditLog(20, 0),
      ]);
      setSettlement(settlementRes.status);
      setQuota(quotaRes.quota);
      setAuditEntries(auditRes.entries);
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
      setQuota(result.quota);
      toast.success(
        `Synced ${result.updatedEvents} events. ${result.quota.remainingRequests ?? '?'} API calls remaining.`
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
      toast.success('Settlement complete');
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
    } catch {
      toast.error('Failed to auto-lock');
    } finally {
      setAutoLockLoading(false);
    }
  };

  const handleRecalcLeagues = async () => {
    setRecalcLoading(true);
    try {
      await api.recalculateLeagues();
      toast.success('League standings recalculated');
    } catch {
      toast.error('Failed to recalculate leagues');
    } finally {
      setRecalcLoading(false);
    }
  };

  const handleImportSport = async (sportKey: string, sportName: string) => {
    setSportImportLoading(sportKey);
    try {
      const result = await api.importEventsBySport(sportKey);
      toast.success(
        `${sportName}: ${result.imported} imported, ${result.updated} updated, ${result.skipped} skipped`
      );
    } catch {
      toast.error(`Failed to import ${sportName}`);
    } finally {
      setSportImportLoading(null);
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
    return <InlineError message="Failed to load system data" onRetry={loadData} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">System</h1>

      {/* Settlement worker */}
      <Card>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Settlement Worker</h2>
        <div className="flex items-center gap-3 mb-4">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              settlement?.isRunning ? 'bg-green-500' : 'bg-gray-300'
            }`}
          />
          <span className="text-sm text-gray-600">
            {settlement?.isRunning ? 'Running' : 'Idle'}
          </span>
          {settlement?.lastRunAt && (
            <span className="text-sm text-gray-400">
              Last: {new Date(settlement.lastRunAt).toLocaleString()}
            </span>
          )}
        </div>
        <Button size="sm" isLoading={settleLoading} onClick={handleRunSettlement}>
          Run Settlement Now
        </Button>
      </Card>

      {/* Odds API */}
      <Card>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Odds API</h2>
        {quota && (
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs font-semibold uppercase text-gray-400">Monthly Quota</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {quota.monthlyQuota}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-gray-400">Remaining</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {quota.remainingRequests ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-gray-400">Usage</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {quota.remainingPercent != null
                  ? `${(100 - quota.remainingPercent).toFixed(1)}%`
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-gray-400">Polling</p>
              <p
                className={`mt-1 text-sm font-semibold ${
                  quota.nonEssentialPollingAllowed
                    ? 'text-green-600'
                    : 'text-red-600'
                }`}
              >
                {quota.nonEssentialPollingAllowed ? 'Allowed' : 'Paused'}
              </p>
            </div>
          </div>
        )}
        <Button size="sm" isLoading={syncLoading} onClick={handleSyncOdds}>
          Sync Odds Now
        </Button>
      </Card>

      {/* Quick actions */}
      <Card>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Other Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            size="sm"
            isLoading={autoLockLoading}
            onClick={handleAutoLock}
          >
            Auto-Lock Started Events
          </Button>
          <Button
            variant="secondary"
            size="sm"
            isLoading={recalcLoading}
            onClick={handleRecalcLeagues}
          >
            Recalculate League Standings
          </Button>
        </div>
      </Card>

      {/* Sport Management */}
      <Card>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Sport Management</h2>
        <p className="mb-4 text-sm text-gray-500">
          Enabled sports are defined in <code className="rounded bg-gray-100 px-1 text-xs">src/config/sports.ts</code>.
          Toggle <code className="rounded bg-gray-100 px-1 text-xs">enabled: true/false</code> to add or remove sports from sync.
        </p>
        <div className="divide-y divide-gray-100">
          {SPORTS.map((sport) => (
            <div key={sport.key} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{sport.emoji}</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">{sport.name}</p>
                  <p className="text-xs text-gray-400">{sport.key}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                isLoading={sportImportLoading === sport.key}
                onClick={() => handleImportSport(sport.key, sport.name)}
              >
                Import Events
              </Button>
            </div>
          ))}
        </div>
      </Card>

      {/* Audit log */}
      <Card>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Recent Audit Log</h2>
        {auditEntries.length === 0 ? (
          <p className="text-sm text-gray-500">No audit entries</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">Action</th>
                  <th className="px-2 py-2">Target</th>
                  <th className="px-2 py-2">Details</th>
                  <th className="px-2 py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.map((entry) => (
                  <tr key={entry.id} className="border-b border-gray-100">
                    <td className="px-2 py-2 font-medium text-gray-700">{entry.action}</td>
                    <td className="px-2 py-2 text-gray-500">
                      {entry.targetType}
                      {entry.targetId && (
                        <span className="ml-1 text-xs text-gray-400">
                          {entry.targetId.slice(0, 8)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-400 max-w-xs truncate">
                      {entry.details ? JSON.stringify(entry.details) : '—'}
                    </td>
                    <td className="px-2 py-2 text-gray-500">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
