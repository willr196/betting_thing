import { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { Badge, Button, Card, EmptyState, FilterChip, InlineError, Spinner } from '../components/ui';
import { formatPoints, formatTokens } from '../lib/utils';
import type { PointsTransaction, TokenTransaction } from '../types';

const PAGE_SIZE = 20;

export function TransactionHistoryPage() {
  const { error: showError } = useToast();
  const [activeTab, setActiveTab] = useState<'tokens' | 'points'>('tokens');

  const [tokenTransactions, setTokenTransactions] = useState<TokenTransaction[]>([]);
  const [tokenTotal, setTokenTotal] = useState(0);
  const [isTokensLoading, setIsTokensLoading] = useState(true);
  const [isLoadingMoreTokens, setIsLoadingMoreTokens] = useState(false);
  const [tokenError, setTokenError] = useState('');

  const [pointsTransactions, setPointsTransactions] = useState<PointsTransaction[]>([]);
  const [pointsTotal, setPointsTotal] = useState(0);
  const [isPointsLoading, setIsPointsLoading] = useState(false);
  const [isLoadingMorePoints, setIsLoadingMorePoints] = useState(false);
  const [pointsError, setPointsError] = useState('');
  const [hasLoadedPoints, setHasLoadedPoints] = useState(false);

  useEffect(() => {
    void loadTokenTransactions(true);
  }, []);

  useEffect(() => {
    if (activeTab === 'points' && !hasLoadedPoints && !isPointsLoading) {
      void loadPointsTransactions(true);
    }
  }, [activeTab, hasLoadedPoints, isPointsLoading]);

  const loadTokenTransactions = async (reset = false) => {
    if (reset) {
      setIsTokensLoading(true);
      setTokenError('');
    } else {
      setIsLoadingMoreTokens(true);
    }

    try {
      const offset = reset ? 0 : tokenTransactions.length;
      const data = await api.getTransactions(PAGE_SIZE, offset);
      setTokenTransactions((previous) =>
        reset ? data.transactions : [...previous, ...data.transactions]
      );
      setTokenTotal(data.total);
    } catch {
      if (reset) {
        setTokenError('Token transactions could not be loaded right now.');
      } else {
        showError('Unable to load more token transactions');
      }
    } finally {
      if (reset) {
        setIsTokensLoading(false);
      } else {
        setIsLoadingMoreTokens(false);
      }
    }
  };

  const loadPointsTransactions = async (reset = false) => {
    if (reset) {
      setIsPointsLoading(true);
      setPointsError('');
      setHasLoadedPoints(true);
    } else {
      setIsLoadingMorePoints(true);
    }

    try {
      const offset = reset ? 0 : pointsTransactions.length;
      const data = await api.getPointsTransactions(PAGE_SIZE, offset);
      setPointsTransactions((previous) =>
        reset ? data.transactions : [...previous, ...data.transactions]
      );
      setPointsTotal(data.total);
    } catch {
      if (reset) {
        setPointsError('Points transactions could not be loaded right now.');
      } else {
        showError('Unable to load more points transactions');
      }
    } finally {
      if (reset) {
        setIsPointsLoading(false);
      } else {
        setIsLoadingMorePoints(false);
      }
    }
  };

  const hasMoreTokens = tokenTransactions.length < tokenTotal;
  const hasMorePoints = pointsTransactions.length < pointsTotal;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Transaction History</h1>
        <p className="mt-1 text-sm text-gray-500">
          Review every token stake, allowance top-up, cashout, and points movement.
        </p>
      </div>

      <div className="mb-6 flex gap-2">
        <FilterChip active={activeTab === 'tokens'} onClick={() => setActiveTab('tokens')}>
          Tokens
        </FilterChip>
        <FilterChip active={activeTab === 'points'} onClick={() => setActiveTab('points')}>
          Points
        </FilterChip>
      </div>

      {activeTab === 'tokens' ? (
        <TransactionSection
          currency="TOKENS"
          transactions={tokenTransactions}
          isLoading={isTokensLoading}
          isLoadingMore={isLoadingMoreTokens}
          error={tokenError}
          hasMore={hasMoreTokens}
          onRetry={() => void loadTokenTransactions(true)}
          onLoadMore={() => void loadTokenTransactions(false)}
        />
      ) : (
        <TransactionSection
          currency="POINTS"
          transactions={pointsTransactions}
          isLoading={isPointsLoading}
          isLoadingMore={isLoadingMorePoints}
          error={pointsError}
          hasMore={hasMorePoints}
          onRetry={() => void loadPointsTransactions(true)}
          onLoadMore={() => void loadPointsTransactions(false)}
        />
      )}
    </div>
  );
}

function TransactionSection({
  currency,
  transactions,
  isLoading,
  isLoadingMore,
  error,
  hasMore,
  onRetry,
  onLoadMore,
}: {
  currency: 'TOKENS' | 'POINTS';
  transactions: TokenTransaction[] | PointsTransaction[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string;
  hasMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <InlineError message={error} onRetry={onRetry} />;
  }

  if (transactions.length === 0) {
    return (
      <EmptyState
        title={`No ${currency === 'TOKENS' ? 'token' : 'points'} transactions yet`}
        description="Your ledger history will appear here as you use the platform."
      />
    );
  }

  return (
    <Card>
      <div className="divide-y divide-gray-100">
        {transactions.map((transaction) => (
          <TransactionRow
            key={transaction.id}
            currency={currency}
            transaction={transaction}
          />
        ))}
      </div>

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="secondary"
            onClick={onLoadMore}
            isLoading={isLoadingMore}
            disabled={isLoadingMore}
          >
            Load more
          </Button>
        </div>
      )}
    </Card>
  );
}

function TransactionRow({
  currency,
  transaction,
}: {
  currency: 'TOKENS' | 'POINTS';
  transaction: TokenTransaction | PointsTransaction;
}) {
  const amount = Math.abs(transaction.amount);
  const amountLabel =
    currency === 'TOKENS'
      ? `${formatTokens(amount)} tokens`
      : `${formatPoints(amount)} pts`;
  const balanceLabel =
    currency === 'TOKENS'
      ? `${formatTokens(transaction.balanceAfter)} tokens`
      : `${formatPoints(transaction.balanceAfter)} pts`;

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-gray-900">
            {formatTransactionTimestamp(transaction.createdAt)}
          </p>
          <Badge className={getTransactionBadgeClasses(currency, transaction.type)}>
            {transaction.type}
          </Badge>
        </div>
        <p className="text-sm text-gray-600">
          {transaction.description?.trim() || 'Ledger entry recorded on your account.'}
        </p>
      </div>

      <div className="text-left sm:min-w-[150px] sm:text-right">
        <p className={`text-sm font-semibold ${transaction.amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {transaction.amount >= 0 ? '+' : '-'}
          {amountLabel}
        </p>
        <p className="mt-1 text-xs text-gray-400">Balance: {balanceLabel}</p>
      </div>
    </div>
  );
}

function formatTransactionTimestamp(createdAt: string): string {
  const value = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - value.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffMinutes < 1) {
    return 'Just now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  }

  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  }

  const sameYear = value.getFullYear() === now.getFullYear();

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(value);
}

function getTransactionBadgeClasses(currency: 'TOKENS' | 'POINTS', type: string): string {
  if (currency === 'TOKENS') {
    const tokenClasses: Record<string, string> = {
      DAILY_ALLOWANCE: 'bg-green-50 text-green-700',
      SIGNUP_BONUS: 'bg-emerald-50 text-emerald-700',
      PREDICTION_STAKE: 'bg-red-50 text-red-700',
      PREDICTION_REFUND: 'bg-blue-50 text-blue-700',
      STREAK_BONUS: 'bg-amber-50 text-amber-700',
      ADMIN_CREDIT: 'bg-fuchsia-50 text-fuchsia-700',
      ADMIN_DEBIT: 'bg-gray-100 text-gray-700',
    };

    return tokenClasses[type] ?? 'bg-gray-100 text-gray-700';
  }

  const pointsClasses: Record<string, string> = {
    PREDICTION_WIN: 'bg-green-50 text-green-700',
    CASHOUT: 'bg-blue-50 text-blue-700',
    REDEMPTION: 'bg-red-50 text-red-700',
    REDEMPTION_REFUND: 'bg-amber-50 text-amber-700',
    ADMIN_CREDIT: 'bg-fuchsia-50 text-fuchsia-700',
    ADMIN_DEBIT: 'bg-gray-100 text-gray-700',
  };

  return pointsClasses[type] ?? 'bg-gray-100 text-gray-700';
}
