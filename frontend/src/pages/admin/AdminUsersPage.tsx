import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Button, Card, Badge, Input, Spinner, InlineError } from '../../components/ui';
import type { AdminUser } from '../../types';

const PAGE_SIZE = 20;

export function AdminUsersPage() {
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditDesc, setCreditDesc] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await api.getAdminUsers(PAGE_SIZE, offset);
      setUsers(result.users);
      setTotal(result.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredUsers = search
    ? users.filter((u) =>
        u.email.toLowerCase().includes(search.toLowerCase())
      )
    : users;

  const handleVerifyBalance = async (userId: string) => {
    setActionLoading(userId + '-verify');
    try {
      const result = await api.verifyUserBalance(userId);
      const b = result.balance;
      if (b.discrepancy) {
        toast.warning(
          `Discrepancy found: cached=${b.cached}, calculated=${b.calculated}`
        );
      } else {
        toast.success(`Balance verified: ${b.cached} tokens (correct)`);
      }
    } catch {
      toast.error('Failed to verify balance');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRepairBalance = async (userId: string) => {
    setActionLoading(userId + '-repair');
    try {
      await api.repairUserBalance(userId);
      toast.success('Balance repaired');
      loadData();
    } catch {
      toast.error('Failed to repair balance');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreditTokens = async (userId: string) => {
    const amount = parseInt(creditAmount, 10);
    if (!amount || amount <= 0) {
      toast.warning('Enter a valid amount');
      return;
    }
    setActionLoading(userId + '-credit');
    try {
      await api.creditTokens(userId, amount, creditDesc || undefined);
      toast.success(`Credited ${amount} tokens`);
      setCreditAmount('');
      setCreditDesc('');
      loadData();
    } catch {
      toast.error('Failed to credit tokens');
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Users</h1>

      {/* Search */}
      <div className="max-w-xs">
        <Input
          placeholder="Filter by email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <InlineError message="Failed to load users" onRetry={loadData} />
      ) : filteredUsers.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-gray-500">No users found</p>
        </Card>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-3">Email</th>
                  <th className="px-3 py-3">Tokens</th>
                  <th className="px-3 py-3">Points</th>
                  <th className="px-3 py-3">Predictions</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    expanded={expandedId === user.id}
                    onToggle={() =>
                      setExpandedId(expandedId === user.id ? null : user.id)
                    }
                    onVerify={() => handleVerifyBalance(user.id)}
                    onRepair={() => handleRepairBalance(user.id)}
                    onCredit={() => handleCreditTokens(user.id)}
                    creditAmount={creditAmount}
                    onCreditAmountChange={setCreditAmount}
                    creditDesc={creditDesc}
                    onCreditDescChange={setCreditDesc}
                    actionLoading={actionLoading}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Page {currentPage} of {totalPages} ({total} users)
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
      )}
    </div>
  );
}

function UserRow({
  user,
  expanded,
  onToggle,
  onVerify,
  onRepair,
  onCredit,
  creditAmount,
  onCreditAmountChange,
  creditDesc,
  onCreditDescChange,
  actionLoading,
}: {
  user: AdminUser;
  expanded: boolean;
  onToggle: () => void;
  onVerify: () => void;
  onRepair: () => void;
  onCredit: () => void;
  creditAmount: string;
  onCreditAmountChange: (v: string) => void;
  creditDesc: string;
  onCreditDescChange: (v: string) => void;
  actionLoading: string | null;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
        onClick={onToggle}
      >
        <td className="px-3 py-3 font-medium text-gray-900">{user.email}</td>
        <td className="px-3 py-3 text-gray-600">{user.tokenBalance}</td>
        <td className="px-3 py-3 text-gray-600">{user.pointsBalance}</td>
        <td className="px-3 py-3 text-gray-500">{user._count.predictions}</td>
        <td className="px-3 py-3">
          {user.isAdmin && (
            <Badge className="bg-purple-100 text-purple-800">Admin</Badge>
          )}
        </td>
        <td className="px-3 py-3 text-gray-500">
          {new Date(user.createdAt).toLocaleDateString()}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-100 bg-gray-50/50">
          <td colSpan={6} className="px-3 py-4">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  isLoading={actionLoading === user.id + '-verify'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onVerify();
                  }}
                >
                  Verify Balance
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  isLoading={actionLoading === user.id + '-repair'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRepair();
                  }}
                >
                  Repair Balance
                </Button>
              </div>

              <div
                className="flex flex-wrap items-end gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-24">
                  <Input
                    label="Amount"
                    type="number"
                    min="1"
                    value={creditAmount}
                    onChange={(e) => onCreditAmountChange(e.target.value)}
                    placeholder="10"
                  />
                </div>
                <div className="w-48">
                  <Input
                    label="Description"
                    value={creditDesc}
                    onChange={(e) => onCreditDescChange(e.target.value)}
                    placeholder="Reason..."
                  />
                </div>
                <Button
                  size="sm"
                  isLoading={actionLoading === user.id + '-credit'}
                  onClick={onCredit}
                >
                  Credit Tokens
                </Button>
              </div>

              <p className="text-xs text-gray-400">
                ID: {user.id} | Redemptions: {user._count.redemptions}
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
