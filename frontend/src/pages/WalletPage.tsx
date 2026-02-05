import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  formatTokens,
  formatPoints,
  formatDate,
  getTransactionColor,
  getTransactionLabel,
} from '../lib/utils';
import { Card, Spinner, EmptyState } from '../components/ui';
import type { TokenAllowance, TokenTransaction } from '../types';

export function WalletPage() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<TokenTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [allowance, setAllowance] = useState<TokenAllowance | null>(null);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    setIsLoading(true);
    setError('');
    try {
      const [tokenStatus, points] = await Promise.all([
        api.getTokenAllowance(),
        api.getPointsBalance(),
      ]);

      setAllowance(tokenStatus.allowance);
      setTokenBalance(tokenStatus.balance);
      setPointsBalance(points.balance);

      const data = await api.getTransactions(100);
      setTransactions(data.transactions);
      setTotal(data.total);
    } catch (err) {
      setError('Failed to load wallet data. Please try again.');
      console.error('Failed to load transactions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate stats from transactions
  const stats = transactions.reduce(
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

      {/* Balance Card */}
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
            {allowance && (
              <p className="text-xs text-white/80 mt-2">
                Resets: {formatDate(allowance.lastResetDate)}
              </p>
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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <p className="text-sm text-gray-500">Total Earned</p>
          <p className="text-2xl font-bold text-green-600">
            +{formatTokens(stats.totalEarned)}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Total Spent</p>
          <p className="text-2xl font-bold text-red-600">
            -{formatTokens(stats.totalSpent)}
          </p>
        </Card>
      </div>

      {/* Transaction History */}
      <Card>
        <h2 className="font-semibold text-gray-900 mb-4">
          Transaction History
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({total} total)
          </span>
        </h2>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={loadTransactions}
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
          <div className="divide-y divide-gray-100">
            {transactions.map((tx) => (
              <TransactionRow key={tx.id} transaction={tx} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// =============================================================================
// TRANSACTION ROW
// =============================================================================

function TransactionRow({ transaction }: { transaction: TokenTransaction }) {
  const isCredit = transaction.amount > 0;

  const getIcon = (type: string): string => {
    const icons: Record<string, string> = {
      DAILY_ALLOWANCE: '📅',
      SIGNUP_BONUS: '🎁',
      PREDICTION_STAKE: '🎯',
      PREDICTION_WIN: '🏆',
      PREDICTION_REFUND: '↩️',
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
