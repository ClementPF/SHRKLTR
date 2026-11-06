/**
 * Stable achievement catalog. Codes are persisted in user_achievements (guarded by a CHECK
 * constraint) and notifications, so a code must never be renamed or reused; titles and
 * descriptions may change freely. Catalog order is display order.
 */
export const ACHIEVEMENT_CODES = [
  'first_win',
  'win_streak_3',
  'win_streak_5',
  'win_streak_10',
  'games_10',
  'games_50',
  'games_100',
  'giant_killer',
  'explorer_3',
  'explorer_5',
  'first_challenge_won',
  'first_group_joined',
  'invited_player_claimed',
] as const;

export type AchievementCode = (typeof ACHIEVEMENT_CODES)[number];

export interface AchievementDefinition {
  code: AchievementCode;
  title: string;
  description: string;
}

const DETAILS: Record<AchievementCode, Omit<AchievementDefinition, 'code'>> = {
  first_win: { title: 'First win', description: 'Win a game.' },
  win_streak_3: { title: 'Hat trick', description: 'Win 3 games in a row in one tournament.' },
  win_streak_5: { title: 'On fire', description: 'Win 5 games in a row in one tournament.' },
  win_streak_10: { title: 'Unstoppable', description: 'Win 10 games in a row in one tournament.' },
  games_10: { title: 'Regular', description: 'Play 10 games.' },
  games_50: { title: 'Veteran', description: 'Play 50 games.' },
  games_100: { title: 'Centurion', description: 'Play 100 games.' },
  giant_killer: {
    title: 'Giant killer',
    description: "Beat a team whose average rating was at least 200 above your team's.",
  },
  explorer_3: { title: 'Explorer', description: 'Play games in 3 different sports.' },
  explorer_5: { title: 'Globetrotter', description: 'Play games in 5 different sports.' },
  first_challenge_won: { title: 'Challenge accepted', description: 'Win an accepted challenge.' },
  first_group_joined: { title: 'Team player', description: 'Join your first group.' },
  invited_player_claimed: {
    title: 'Recruiter',
    description: 'A player you added claimed their profile.',
  },
};

export const ACHIEVEMENTS: readonly AchievementDefinition[] = ACHIEVEMENT_CODES.map((code) => ({
  code,
  ...DETAILS[code],
}));

const CODES: ReadonlySet<string> = new Set(ACHIEVEMENT_CODES);

export function isAchievementCode(code: string): code is AchievementCode {
  return CODES.has(code);
}

export function findAchievement(code: string): AchievementDefinition | undefined {
  return isAchievementCode(code) ? { code, ...DETAILS[code] } : undefined;
}

export type Thresholds = readonly (readonly [min: number, code: AchievementCode])[];

/** Current win streak within one tournament. */
export const WIN_STREAK_THRESHOLDS: Thresholds = [
  [3, 'win_streak_3'],
  [5, 'win_streak_5'],
  [10, 'win_streak_10'],
];

/** Distinct games played, all tournaments together. */
export const GAME_COUNT_THRESHOLDS: Thresholds = [
  [10, 'games_10'],
  [50, 'games_50'],
  [100, 'games_100'],
];

/** Distinct sports played, wins not required. */
export const SPORT_COUNT_THRESHOLDS: Thresholds = [
  [3, 'explorer_3'],
  [5, 'explorer_5'],
];

/** Inclusive minimum of losing-team minus winning-team average pre-game rating. */
export const GIANT_KILLER_GAP = 200;

/** Codes of every threshold reached by `value`. */
export function crossedThresholds(thresholds: Thresholds, value: number): AchievementCode[] {
  return thresholds.filter(([min]) => value >= min).map(([, code]) => code);
}
