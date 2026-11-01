import { describe, expect, it } from 'vitest';
import { computeDeltas, DEFAULT_RATING, K_FACTOR, type EloOutcome } from '../src/elo/elo.js';

const TOLERANCE_DIGITS = 9;

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

describe('elo engine', () => {
  it('uses K=32 and a default rating of 1000', () => {
    expect(K_FACTOR).toBe(32);
    expect(DEFAULT_RATING).toBe(1000);
  });

  it('VAL-GAME-001: two new 1v1 players → winner 1016.0, loser 984.0 exactly', () => {
    const outcomes: EloOutcome[] = [
      { username: 'alex', result: 'WIN' },
      { username: 'sam', result: 'LOSS' },
    ];
    const deltas = computeDeltas(outcomes, new Map());

    expect(deltas.get('alex')).toBe(16);
    expect(deltas.get('sam')).toBe(-16);
    expect(DEFAULT_RATING + deltas.get('alex')!).toBe(1016.0);
    expect(DEFAULT_RATING + deltas.get('sam')!).toBe(984.0);
  });

  it('VAL-GAME-002: 1200 beats 1000 → +7.6880983… / −7.6880983… (no rounding)', () => {
    const outcomes: EloOutcome[] = [
      { username: 'alex', result: 'WIN' },
      { username: 'sam', result: 'LOSS' },
    ];
    const deltas = computeDeltas(
      outcomes,
      new Map([
        ['alex', 1200],
        ['sam', 1000],
      ]),
    );

    const expected = 32 * (1 - 1 / (1 + 10 ** -0.5));
    expect(deltas.get('alex')).toBeCloseTo(expected, TOLERANCE_DIGITS);
    expect(deltas.get('alex')).toBeCloseTo(7.688098347265349, TOLERANCE_DIGITS);
    expect(1200 + deltas.get('alex')!).toBeCloseTo(1207.688098347265, TOLERANCE_DIGITS);
    expect(1000 + deltas.get('sam')!).toBeCloseTo(992.311901652735, TOLERANCE_DIGITS);
    expect(deltas.get('sam')).toBe(-deltas.get('alex')!);
  });

  it('symmetric reverse case: 1000 upsets 1200 → +24.3119016… / −24.3119016…', () => {
    const outcomes: EloOutcome[] = [
      { username: 'sam', result: 'WIN' },
      { username: 'alex', result: 'LOSS' },
    ];
    const deltas = computeDeltas(
      outcomes,
      new Map([
        ['alex', 1200],
        ['sam', 1000],
      ]),
    );

    const favouriteDelta = 32 * (1 - 1 / (1 + 10 ** -0.5));
    // The upset gain plus the favourite's gain always add up to K.
    expect(deltas.get('sam')).toBeCloseTo(32 - favouriteDelta, TOLERANCE_DIGITS);
    expect(deltas.get('sam')).toBeCloseTo(24.311901652734651, TOLERANCE_DIGITS);
    expect(deltas.get('alex')).toBeCloseTo(-(32 - favouriteDelta), TOLERANCE_DIGITS);
  });

  it('VAL-GAME-003: 2v2 uses team-average ratings, full delta per player, zero-sum', () => {
    const outcomes: EloOutcome[] = [
      { username: 'a', result: 'WIN' },
      { username: 'b', result: 'WIN' },
      { username: 'c', result: 'LOSS' },
      { username: 'd', result: 'LOSS' },
    ];
    const ratings = new Map([
      ['a', 1100],
      ['b', 1300],
      ['c', 1000],
      ['d', 1000],
    ]);
    const deltas = computeDeltas(outcomes, ratings);

    // Rw = 1200, Rl = 1000 → same expected score as the 1200-vs-1000 1v1.
    const expected = 32 * (1 - 1 / (1 + 10 ** ((1000 - 1200) / 400)));
    expect(deltas.size).toBe(4);
    expect(deltas.get('a')).toBeCloseTo(expected, TOLERANCE_DIGITS);
    expect(deltas.get('b')).toBeCloseTo(expected, TOLERANCE_DIGITS);
    expect(deltas.get('c')).toBeCloseTo(-expected, TOLERANCE_DIGITS);
    expect(deltas.get('d')).toBeCloseTo(-expected, TOLERANCE_DIGITS);
    expect(sum(deltas.values())).toBeCloseTo(0, TOLERANCE_DIGITS);
  });

  it('2v2 with unrated players defaults them to 1000 inside the team average', () => {
    const outcomes: EloOutcome[] = [
      { username: 'a', result: 'LOSS' },
      { username: 'b', result: 'WIN' },
      { username: 'c', result: 'WIN' },
      { username: 'd', result: 'LOSS' },
    ];
    // Winners: b=1050, c=default 1000 → Rw = 1025. Losers: a=1400, d=default 1000 → Rl = 1200.
    const deltas = computeDeltas(
      outcomes,
      new Map([
        ['a', 1400],
        ['b', 1050],
      ]),
    );

    const ew = 1 / (1 + 10 ** ((1200 - 1025) / 400));
    const expected = 32 * (1 - ew);
    expect(deltas.get('b')).toBeCloseTo(expected, TOLERANCE_DIGITS);
    expect(deltas.get('c')).toBeCloseTo(expected, TOLERANCE_DIGITS);
    expect(deltas.get('a')).toBeCloseTo(-expected, TOLERANCE_DIGITS);
    expect(deltas.get('d')).toBeCloseTo(-expected, TOLERANCE_DIGITS);
    expect(sum(deltas.values())).toBeCloseTo(0, TOLERANCE_DIGITS);
  });

  it('accepts a plain record of ratings', () => {
    const deltas = computeDeltas(
      [
        { username: 'alex', result: 'WIN' },
        { username: 'sam', result: 'LOSS' },
      ],
      { alex: 1200, sam: 1000 },
    );
    expect(deltas.get('alex')).toBeCloseTo(32 * (1 - 1 / (1 + 10 ** -0.5)), TOLERANCE_DIGITS);
  });

  it('does not mutate its inputs', () => {
    const outcomes: EloOutcome[] = [
      { username: 'alex', result: 'WIN' },
      { username: 'sam', result: 'LOSS' },
    ];
    const ratings = new Map([['alex', 1200]]);
    computeDeltas(outcomes, ratings);
    expect([...ratings.entries()]).toEqual([['alex', 1200]]);
    expect(outcomes).toHaveLength(2);
  });

  it('rejects a game without both a winner and a loser', () => {
    expect(() => computeDeltas([{ username: 'alex', result: 'WIN' }], new Map())).toThrow();
    expect(() => computeDeltas([], new Map())).toThrow();
  });
});
