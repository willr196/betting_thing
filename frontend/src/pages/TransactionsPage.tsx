import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Card, Badge, Spinner, Button, EmptyState, InlineError } from '../components/ui';
import { formatDate, formatPoints, formatTokens, getTransactionLabel } from '../lib/utils';
import type { PointsTransaction, TokenTransaction } from '../types';

type CombinedTransaction = {
  id: string;
  currency: 'TOKENS' | 'POINTS';
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  createdAt: string;
};

const PAGE_SIZE = 100;

export function TransactionsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [transactions, setTransactions] = useState<CombinedTransaction[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadTransactions();
  }, []);

  const loadTransactions = async () => {
    setIsLoading(true);
    setError('');

    try {
      const [tokenHistory, pointsHistory] = await Promise.all([
        api.getTransactions(PAGE_SIZE, 0),
        api.getPointsTransactions(PAGE_SIZE, 0),
      ]);

      const combined = mergeTransactions(
        tokenHistory.transactions,
        pointsHistory.transactions
      );

      setTransactions(combined);
    } catch {
      setError('Your activity could not be loaded right now.');
    } finally {
      setIsLoading(false);
    }
  };

  const groupedCounts = useMemo(() => {
    return transactions.reduce(
      (acc, tx) => {
        if (tx.currency === 'TOKENS') {
          acc.tokens += 1;
        } else {
          acc.points += 1;
        }
        return acc;
      },
      { tokens: 0, points: 0 }
    );
  }, [transactions]);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Activity</h1>
          <p className="mt-1 text-sm text-gray-500">Your token and points history</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void loadTransactions()} disabled={isLoading}>
          Refresh
        </Button>
      </div>

      {/* Summary */}
      {transactions.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-4">
          <Card padding="sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Tokens</p>
            <p className="mt-1 text-2xl font-semibold text-primary-700">{groupedCounts.tokens}</p>
            <p className="text-xs text-gray-400">
              {groupedCounts.tokens === 1 ? 'entry' : 'entries'}
            </p>
          </Card>
          <Card padding="sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Points</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-700">{groupedCounts.points}</p>
            <p className="text-xs text-gray-400">
              {groupedCounts.points === 1 ? 'entry' : 'entries'}
            </p>
          </Card>
        </div>
      )}

      <Card>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : error ? (
          <InlineError message={error} onRetry={() => void loadTransactions()} />
        ) : transactions.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Your token and points movements will appear here as you make predictions."
          />
        ) : (
          <div className="divide-y divide-gray-100">
            {transactions.map((tx) => (
              <TransactionRow key={`${tx.currency}-${tx.id}`} transaction={tx} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function TransactionRow({ transaction }: { transaction: CombinedTransaction }) {
  const isCredit = transaction.amount > 0;
  const currencyLabel = transaction.currency === 'TOKENS' ? 'Tokens' : 'Points';

  return (
    <div className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Badge
            className={
              transaction.currency === 'TOKENS'
                ? 'bg-primary-50 text-primary-700'
                : 'bg-emerald-50 text-emerald-700'
            }
          >
            {currencyLabel}
          </Badge>
          <Badge className="bg-gray-100 text-gray-600">{getTransactionLabel(transaction.type)}</Badge>
        </div>
        <p className="text-xs text-gray-400">{formatDate(transaction.createdAt)}</p>
        {transaction.description && (
          <p className="mt-1 text-sm text-gray-600">{transaction.description}</p>
        )}
      </div>

      <div className="text-left sm:text-right">
        <p className={`font-semibold ${isCredit ? 'text-green-600' : 'text-red-500'}`}>
          {isCredit ? '+' : '−'}
          {formatAmount(transaction.currency, Math.abs(transaction.amount))}
        </p>
        <p className="text-xs text-gray-400">
          Balance: {formatAmount(transaction.currency, transaction.balanceAfter)}
        </p>
      </div>
    </div>
  );
}

function formatAmount(currency: 'TOKENS' | 'POINTS', amount: number): string {
  return currency === 'TOKENS' ? formatTokens(amount) : formatPoints(amount);
}

function mergeTransactions(
  tokenTransactions: TokenTransaction[],
  pointsTransactions: PointsTransaction[]
): CombinedTransaction[] {
  const tokens: CombinedTransaction[] = tokenTransactions.map((tx) => ({
    id: tx.id,
    currency: 'TOKENS',
    type: tx.type,
    amount: tx.amount,
    balanceAfter: tx.balanceAfter,
    description: tx.description,
    createdAt: tx.createdAt,
  }));

  const points: CombinedTransaction[] = pointsTransactions.map((tx) => ({
    id: tx.id,
    currency: 'POINTS',
    type: tx.type,
    amount: tx.amount,
    balanceAfter: tx.balanceAfter,
    description: tx.description,
    createdAt: tx.createdAt,
  }));

  return [...tokens, ...points].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
