// =============================================================================
// SPORTS CONFIGURATION
// =============================================================================
// Central registry for all supported sports. Controls which sports are
// actively synced from The Odds API and imported into the platform.
//
// To enable a new sport: set `enabled: true` and ensure THE_ODDS_API_KEY has
// quota for it. Each enabled sport costs API credits per odds sync cycle.

export interface SportConfig {
  key: string;       // The Odds API sport key
  name: string;      // Full display name
  shortName: string; // Short display name for badges/tabs
  emoji: string;     // Visual identifier
  enabled: boolean;  // Whether to sync odds and allow importing for this sport
  priority: number;  // Processing order (lower = first)
}

export const SPORTS: SportConfig[] = [
  { key: 'soccer_epl', name: 'Premier League', shortName: 'EPL', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', enabled: true, priority: 1 },
  { key: 'soccer_uefa_champs_league', name: 'Champions League', shortName: 'UCL', emoji: '🏆', enabled: true, priority: 2 },
  { key: 'soccer_spain_la_liga', name: 'La Liga', shortName: 'La Liga', emoji: '🇪🇸', enabled: false, priority: 3 },
  { key: 'soccer_italy_serie_a', name: 'Serie A', shortName: 'Serie A', emoji: '🇮🇹', enabled: false, priority: 4 },
  { key: 'soccer_germany_bundesliga', name: 'Bundesliga', shortName: 'Bundesliga', emoji: '🇩🇪', enabled: false, priority: 5 },
  { key: 'soccer_france_ligue_one', name: 'Ligue 1', shortName: 'Ligue 1', emoji: '🇫🇷', enabled: false, priority: 6 },
];

export function getEnabledSports(): SportConfig[] {
  return SPORTS.filter((s) => s.enabled).sort((a, b) => a.priority - b.priority);
}

export function getSportByKey(key: string): SportConfig | undefined {
  return SPORTS.find((s) => s.key === key);
}

/** Convenience map: sport key → display name (all sports, not just enabled) */
export const SPORT_NAMES: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.key, s.name])
);
