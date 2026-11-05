import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import type { RivalryStats, StatFields } from '@/api/types';

dayjs.extend(relativeTime);

export function formatPoints(value: number): string {
  return Math.round(value).toFixed(0);
}

/** Signed Elo change with one decimal, e.g. "+15.7". */
export function signedElo(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

export function gameDate(isoDate: string): string {
  return dayjs(isoDate).format('ddd D MMM YYYY, HH:mm');
}

export function fromNow(isoDate: string, now: Date = new Date()): string {
  return dayjs(isoDate).from(now);
}

export function describeStreak({
  winStreak,
  loseStreak,
  tieStreak,
}: Pick<StatFields, 'winStreak' | 'loseStreak' | 'tieStreak'>): { label: string; value: number } {
  const kind =
    winStreak > 0 ? 'Winning ' : loseStreak > 0 ? 'Losing ' : tieStreak > 0 ? 'Tie ' : '';
  return { label: `Current ${kind}Streak`, value: Math.max(winStreak, loseStreak, tieStreak) };
}

export function rivalryLabel(rivalry: RivalryStats | null, fallback: string): string {
  return rivalry ? `${rivalry.rival.username} (${formatPoints(rivalry.score)})` : fallback;
}
