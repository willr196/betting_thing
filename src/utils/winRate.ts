function resolvedPredictionCount(wins: number, losses: number): number {
  return Math.max(0, wins) + Math.max(0, losses);
}

export function calculateWinRateRatio(wins: number, losses: number): number {
  const resolved = resolvedPredictionCount(wins, losses);
  if (resolved === 0) {
    return 0;
  }

  return Number((wins / resolved).toFixed(4));
}

export function calculateWinRatePercent(wins: number, losses: number): number {
  const resolved = resolvedPredictionCount(wins, losses);
  if (resolved === 0) {
    return 0;
  }

  return Number(((wins / resolved) * 100).toFixed(2));
}
