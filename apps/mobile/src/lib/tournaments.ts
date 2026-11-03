import type { Stats, Tournament } from '@/api/types';

/**
 * Case-insensitive substring search over the display name, the `@name` slug and the sport.
 * A term starting with `@` only matches the slug.
 */
export function filterTournaments(
  tournaments: readonly Tournament[],
  term: string,
): readonly Tournament[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return tournaments;
  if (needle.startsWith('@')) {
    const slug = needle.slice(1);
    return tournaments.filter((t) => t.name.toLowerCase().includes(slug));
  }
  return tournaments.filter((t) =>
    [t.displayName, t.name, t.sport.name].some((field) => field.toLowerCase().includes(needle)),
  );
}

export interface RankedStats {
  position: number;
  stats: Stats;
}

/** Leaderboard order (score desc); equal scores share a position, like 1, 1, 3. */
export function rankStats(stats: readonly Stats[]): RankedStats[] {
  const sorted = [...stats].sort((a, b) => b.score - a.score);
  return sorted.map((s, index) => {
    let first = index;
    while (first > 0 && sorted[first - 1]!.score === s.score) first -= 1;
    return { position: first + 1, stats: s };
  });
}
