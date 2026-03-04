import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { Card, Badge, Spinner, Button, EmptyState } from '../components/ui';
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
  const { error: showError } = useToast();
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
      setError('Failed to load transactions.');
      showError('Failed to load transactions. Please try again.');
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
          <h1 className="text-2xl font-bold text-gray-900">Transaction History</h1>
          <p className="mt-1 text-gray-600">Your token and points ledger activity</p>
        </div>
        <Button variant="secondary" onClick={loadTransactions} disabled={isLoading}>
          Refresh
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4">
        <Card>
          <p className="text-sm text-gray-500">Token Entries</p>
          <p className="text-2xl font-semibold text-primary-700">{groupedCounts.tokens}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Points Entries</p>
          <p className="text-2xl font-semibold text-emerald-700">{groupedCounts.points}</p>
        </Card>
      </div>

      <Card>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <p className="mb-4 text-red-600">{error}</p>
            <Button onClick={loadTransactions}>Retry</Button>
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState
            title="No transactions yet"
            description="Your token and points history will appear here."
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

  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Badge
            className={
              transaction.currency === 'TOKENS'
                ? 'bg-primary-100 text-primary-800'
                : 'bg-emerald-100 text-emerald-800'
            }
          >
            {transaction.currency}
          </Badge>
          <Badge className="bg-gray-100 text-gray-700">{getTransactionLabel(transaction.type)}</Badge>
        </div>
        <p className="text-xs text-gray-500">{formatDate(transaction.createdAt)}</p>
        {transaction.description && (
          <p className="mt-1 text-sm text-gray-600">{transaction.description}</p>
        )}
      </div>

      <div className="text-left sm:text-right">
        <p className={`font-semibold ${isCredit ? 'text-green-600' : 'text-red-600'}`}>
          {isCredit ? '+' : '-'}
          {formatAmount(transaction.currency, Math.abs(transaction.amount))}
        </p>
        <p className="text-xs text-gray-500">
          Running balance: {formatAmount(transaction.currency, transaction.balanceAfter)}
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
