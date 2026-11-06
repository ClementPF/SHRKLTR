import dayjs from 'dayjs';

import type { AchievementCode } from '@/api/types';

const ICONS: Record<AchievementCode, string> = {
  first_win: '🏆',
  win_streak_3: '🔥',
  win_streak_5: '⚡',
  win_streak_10: '🌋',
  games_10: '🎯',
  games_50: '🎖️',
  games_100: '💯',
  giant_killer: '🗡️',
  explorer_3: '🧭',
  explorer_5: '🌍',
  first_challenge_won: '⚔️',
  first_group_joined: '🤝',
  invited_player_claimed: '📨',
};

export const LOCKED_ICON = '🔒';

/** Unknown codes (a newer server catalog) fall back to a generic medal. */
export function badgeIcon(code: AchievementCode): string {
  return ICONS[code] ?? '🏅';
}

export function unlockDate(isoDate: string): string {
  return dayjs(isoDate).format('MMM D, YYYY');
}

export function badgeLabel(title: string, unlocked: boolean): string {
  return `${title}, ${unlocked ? 'unlocked' : 'locked'}`;
}
