// =============================================================================
// FORMATTING UTILITIES
// =============================================================================

export function formatTokens(amount: number): string {
  return new Intl.NumberFormat('en-US').format(amount);
}

export function formatPoints(amount: number): string {
  return new Intl.NumberFormat('en-US').format(amount);
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  
  const minutes = Math.floor(Math.abs(diff) / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (diff > 0) {
    // Future
    if (days > 0) return `in ${days}d ${hours % 24}h`;
    if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
    return `in ${minutes}m`;
  } else {
    // Past
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return `${minutes}m ago`;
  }
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    // Event statuses
    OPEN: 'bg-green-100 text-green-800',
    LOCKED: 'bg-yellow-100 text-yellow-800',
    SETTLED: 'bg-gray-100 text-gray-800',
    CANCELLED: 'bg-red-100 text-red-800',
    // Prediction statuses
    PENDING: 'bg-blue-100 text-blue-800',
    WON: 'bg-green-100 text-green-800',
    LOST: 'bg-red-100 text-red-800',
    REFUNDED: 'bg-purple-100 text-purple-800',
    CASHED_OUT: 'bg-amber-100 text-amber-800',
    // Redemption statuses
    FULFILLED: 'bg-green-100 text-green-800',
  };
  return colors[status] ?? 'bg-gray-100 text-gray-800';
}

export function getTransactionColor(amount: number): string {
  return amount >= 0 ? 'text-green-600' : 'text-red-600';
}

export function getTransactionLabel(type: string): string {
  const labels: Record<string, string> = {
    DAILY_ALLOWANCE: 'Daily Allowance',
    SIGNUP_BONUS: 'Signup Bonus',
    PREDICTION_STAKE: 'Prediction Stake',
    PREDICTION_WIN: 'Prediction Win',
    PREDICTION_REFUND: 'Refund',
    REDEMPTION: 'Redemption',
    REDEMPTION_REFUND: 'Redemption Refund',
    PURCHASE: 'Token Purchase',
    ADMIN_CREDIT: 'Admin Credit',
    ADMIN_DEBIT: 'Admin Debit',
  };
  return labels[type] ?? type;
}
