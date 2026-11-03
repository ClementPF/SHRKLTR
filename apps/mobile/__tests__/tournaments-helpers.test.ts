import type { Stats, Tournament } from '@/api/types';
import { filterTournaments, rankStats } from '@/lib/tournaments';

const tournament = (name: string, displayName: string, sport: string): Tournament => ({
  id: `t-${name}`,
  name,
  displayName,
  isOver: false,
  sport: { id: `s-${sport}`, name: sport },
  owner: null,
});

const list = [
  tournament('officebabyfoot', 'Office Babyfoot', 'babyfoot'),
  tournament('fridaypingpong', 'Friday Ping Pong', 'ping-pong'),
  tournament('chessclub', 'Chess Club', 'chess'),
];

describe('filterTournaments', () => {
  it('returns every tournament for a blank term', () => {
    expect(filterTournaments(list, '')).toEqual(list);
    expect(filterTournaments(list, '   ')).toEqual(list);
  });

  it('matches the display name case-insensitively', () => {
    expect(filterTournaments(list, 'ping p').map((t) => t.name)).toEqual(['fridaypingpong']);
  });

  it('matches the sport name', () => {
    expect(filterTournaments(list, 'CHESS').map((t) => t.name)).toEqual(['chessclub']);
    expect(filterTournaments(list, 'babyfoot').map((t) => t.name)).toEqual(['officebabyfoot']);
  });

  it('matches the @name slug, with or without the @', () => {
    expect(filterTournaments(list, '@officebaby').map((t) => t.name)).toEqual(['officebabyfoot']);
    expect(filterTournaments(list, 'fridayping').map((t) => t.name)).toEqual(['fridaypingpong']);
  });

  it('restricts an @ term to the slug', () => {
    expect(filterTournaments(list, '@chess club')).toEqual([]);
  });

  it('treats regex characters literally', () => {
    expect(filterTournaments(list, '.*')).toEqual([]);
    expect(() => filterTournaments(list, '(')).not.toThrow();
  });
});

const stat = (username: string, score: number) =>
  ({ id: `st-${username}`, score, user: { username } }) as unknown as Stats;

describe('rankStats', () => {
  it('orders by score descending and numbers positions from 1', () => {
    const ranked = rankStats([stat('b', 990), stat('a', 1030), stat('c', 1001)]);
    expect(ranked.map((r) => [r.position, r.stats.user.username])).toEqual([
      [1, 'a'],
      [2, 'c'],
      [3, 'b'],
    ]);
  });

  it('gives equal scores the same position and skips the next ones', () => {
    const ranked = rankStats([stat('a', 1016), stat('b', 1000), stat('c', 1016), stat('d', 984)]);
    expect(ranked.map((r) => [r.position, r.stats.user.username])).toEqual([
      [1, 'a'],
      [1, 'c'],
      [3, 'b'],
      [4, 'd'],
    ]);
  });

  it('does not mutate its input', () => {
    const input = [stat('b', 1), stat('a', 2)];
    rankStats(input);
    expect(input.map((s) => s.user.username)).toEqual(['b', 'a']);
  });
});
