// =============================================================================
// FRONTEND SPORTS CONFIG
// =============================================================================
// Only includes sports that are enabled on the backend.
// Update this when toggling enabled sports in src/config/sports.ts.

export interface SportConfig {
  key: string;
  name: string;
  shortName: string;
  emoji: string;
}

export const SPORTS: SportConfig[] = [
  { key: 'soccer_epl', name: 'Premier League', shortName: 'EPL', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { key: 'soccer_uefa_champs_league', name: 'Champions League', shortName: 'UCL', emoji: '🏆' },
];

export function getSportByKey(key: string): SportConfig | undefined {
  return SPORTS.find((s) => s.key === key);
}
