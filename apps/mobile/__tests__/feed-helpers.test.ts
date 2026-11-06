import { nextPageParam } from '@/lib/pagination';
import { describeStreak, formatPoints, fromNow, rivalryLabel } from '@/lib/format';
import { donutSegments, toDonutSlices, splitRivalries } from '@/lib/rivalries';
import type { RivalryStats } from '@/api/types';

function rivalry(rival: string, score: number): RivalryStats {
  const user = {
    id: 'u',
    username: 'dev-alex',
    accountType: 'REGISTERED' as const,
    firstName: null,
    lastName: null,
    pictureUrl: null,
    locale: null,
  };
  return {
    id: `r-${rival}`,
    user,
    rival: { ...user, id: rival, username: rival },
    tournament: {
      id: 't',
      name: 'officebabyfoot',
      displayName: 'Office Babyfoot',
      isOver: false,
      sport: { id: 's', name: 'babyfoot' },
      owner: null,
    },
    score,
    bestScore: 0,
    worstScore: 0,
    gameCount: 1,
    winCount: 0,
    loseCount: 0,
    tieCount: 0,
    winStreak: 0,
    loseStreak: 0,
    tieStreak: 0,
    longestWinStreak: 0,
    longestLoseStreak: 0,
    longestTieStreak: 0,
  };
}

describe('nextPageParam', () => {
  it('asks for the next page index while pages come back full', () => {
    const next = nextPageParam(15);
    expect(next(new Array(15).fill(0), [new Array(15).fill(0)])).toBe(1);
    expect(next(new Array(15).fill(0), [[], [], new Array(15).fill(0)])).toBe(3);
  });

  it('stops once a page is shorter than the page size', () => {
    const next = nextPageParam(15);
    expect(next(new Array(14).fill(0), [new Array(14).fill(0)])).toBeUndefined();
    expect(next([], [new Array(15).fill(0), []])).toBeUndefined();
  });
});

describe('format helpers', () => {
  it('rounds points to whole numbers', () => {
    expect(formatPoints(1016.4)).toBe('1016');
    expect(formatPoints(-16.69)).toBe('-17');
    expect(formatPoints(12.86)).toBe('13');
  });

  it('renders relative dates', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    expect(fromNow('2026-11-01T10:00:00Z', now)).toBe('2 hours ago');
    expect(fromNow('2026-10-29T12:00:00Z', now)).toBe('3 days ago');
  });

  it('labels the current streak like the legacy stats card', () => {
    expect(describeStreak({ winStreak: 3, loseStreak: 0, tieStreak: 0 })).toEqual({
      label: 'Current Winning Streak',
      value: 3,
    });
    expect(describeStreak({ winStreak: 0, loseStreak: 2, tieStreak: 0 })).toEqual({
      label: 'Current Losing Streak',
      value: 2,
    });
    expect(describeStreak({ winStreak: 0, loseStreak: 0, tieStreak: 0 })).toEqual({
      label: 'Current Streak',
      value: 0,
    });
  });

  it('formats a rivalry as "rival (score)" with a fallback', () => {
    expect(rivalryLabel(rivalry('dev-sam', 57.12), '❌🎣')).toBe('dev-sam (57)');
    expect(rivalryLabel(null, '❌🎣')).toBe('❌🎣');
  });
});

describe('splitRivalries', () => {
  it('puts negative scores in SHARKS and positive in FISHES, dropping zeros', () => {
    const { sharks, fishes } = splitRivalries([
      rivalry('dev-sam', 57.12),
      rivalry('dev-taylor', 16.13),
      rivalry('dev-jordan', -3.62),
      rivalry('dev-morgan', -16.69),
      rivalry('dev-zero', 0),
    ]);
    expect(sharks.map((s) => s.rival.username)).toEqual(['dev-morgan', 'dev-jordan']);
    expect(fishes.map((s) => s.rival.username)).toEqual(['dev-sam', 'dev-taylor']);
  });

  it('builds donut slices with absolute values and "rival: score" labels', () => {
    const slices = toDonutSlices([rivalry('dev-morgan', -16.69), rivalry('dev-jordan', -3.62)]);
    expect(slices).toEqual([
      { key: 'r-dev-morgan', label: 'dev-morgan: -17', value: 16.69 },
      { key: 'r-dev-jordan', label: 'dev-jordan: -4', value: 3.62 },
    ]);
  });
});

describe('donutSegments', () => {
  const circumference = 2 * Math.PI * 50;

  it('splits the circle proportionally', () => {
    const segments = donutSegments([3, 1], { radius: 50, padAngle: 0, progress: 1 });
    expect(segments).toHaveLength(2);
    expect(segments[0]!.sweep).toBeCloseTo(270);
    expect(segments[1]!.start).toBeCloseTo(270);
    expect(segments[1]!.sweep).toBeCloseTo(90);
    expect(segments[0]!.dashLength).toBeCloseTo(circumference * 0.75);
    expect(segments[0]!.dashOffset).toBeCloseTo(0);
    expect(segments[1]!.dashOffset).toBeCloseTo(-circumference * 0.75);
    expect(segments[0]!.midAngle).toBeCloseTo(135);
  });

  it('scales every segment with the animation progress', () => {
    const [half] = donutSegments([1, 1], { radius: 50, padAngle: 0, progress: 0.5 });
    expect(half!.sweep).toBeCloseTo(90);
    expect(donutSegments([1], { radius: 50, padAngle: 0, progress: 0 })[0]!.dashLength).toBe(0);
  });

  it('leaves a gap between several slices but not around a single one', () => {
    const [single] = donutSegments([5], { radius: 50, padAngle: 4, progress: 1 });
    expect(single!.dashLength).toBeCloseTo(circumference);
    const [first, second] = donutSegments([1, 1], { radius: 50, padAngle: 4, progress: 1 });
    expect(first!.dashLength).toBeCloseTo((circumference * 176) / 360);
    // Each dash starts half a gap into its slice, so no segment runs past the path end.
    expect(-second!.dashOffset + second!.dashLength).toBeLessThan(circumference);
  });

  it('returns nothing for an empty or all-zero series', () => {
    expect(donutSegments([], { radius: 50, padAngle: 0, progress: 1 })).toEqual([]);
    expect(donutSegments([0, 0], { radius: 50, padAngle: 0, progress: 1 })).toEqual([]);
  });
});
