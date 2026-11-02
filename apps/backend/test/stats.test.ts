import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stats } from '../src/db/schema.js';
import {
  authHeadersFor,
  buildTestApp,
  createStatsRow,
  createTournament,
  createUser,
  truncateAll,
} from './helpers.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;
type TournamentRow = Awaited<ReturnType<typeof createTournament>>;

/** Independent Elo reference: winner gain for the given team means. */
const eloDelta = (winnerRating: number, loserRating: number) =>
  32 * (1 - 1 / (1 + 10 ** ((loserRating - winnerRating) / 400)));

interface ExpectedLine {
  score: number;
  bestScore: number;
  worstScore: number;
  gameCount: number;
  winCount: number;
  loseCount: number;
  tieCount: number;
  winStreak: number;
  loseStreak: number;
  tieStreak: number;
  longuestWinStreak: number;
  longuestLoseStreak: number;
  longuestTieStreak: number;
}

const fresh = (): ExpectedLine => ({
  score: 1000,
  bestScore: 1000,
  worstScore: 1000,
  gameCount: 0,
  winCount: 0,
  loseCount: 0,
  tieCount: 0,
  winStreak: 0,
  loseStreak: 0,
  tieStreak: 0,
  longuestWinStreak: 0,
  longuestLoseStreak: 0,
  longuestTieStreak: 0,
});

function expectLine(actual: ExpectedLine | undefined, expected: ExpectedLine) {
  expect(actual).toBeDefined();
  const { score, bestScore, worstScore, ...counts } = expected;
  expect(actual!.score).toBeCloseTo(score, 9);
  expect(actual!.bestScore).toBeCloseTo(bestScore, 9);
  expect(actual!.worstScore).toBeCloseTo(worstScore, 9);
  expect(actual).toMatchObject(counts);
}

describe('stats recalculation and leaderboard', () => {
  let app: FastifyInstance;
  let tournament: TournamentRow;
  let alice: UserRow;
  let bob: UserRow;
  let carol: UserRow;
  let dave: UserRow;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    tournament = await createTournament(app.db, { name: 'babyfoot', displayName: 'Baby Foot' });
    alice = await createUser(app.db, { username: 'alice' });
    bob = await createUser(app.db, { username: 'bob' });
    carol = await createUser(app.db, { username: 'carol' });
    dave = await createUser(app.db, { username: 'dave' });
  });

  const play = async (winners: UserRow[], losers: UserRow[]) => {
    const caller = losers[0];
    if (!caller) throw new Error('a game needs a loser');
    const res = await app.inject({
      method: 'POST',
      url: `/tournaments/${tournament.name}/games`,
      headers: await authHeadersFor(app, caller.id),
      payload: {
        outcomes: [
          ...winners.map((u) => ({ username: u.username, result: 'WIN' })),
          ...losers.map((u) => ({ username: u.username, result: 'LOSS' })),
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  };

  const statsOf = async (user: UserRow) => {
    const [row] = await app.db
      .select()
      .from(stats)
      .where(and(eq(stats.userId, user.id), eq(stats.tournamentId, tournament.id)));
    return row;
  };

  describe('VAL-GAME-001: first 1v1 game persists deterministic Elo', () => {
    it('stores 1016 for the winner and 984 for the loser', async () => {
      expect(await statsOf(alice)).toBeUndefined();
      expect(await statsOf(bob)).toBeUndefined();

      await play([bob], [alice]);

      expect((await statsOf(bob))?.score).toBeCloseTo(1016, 9);
      expect((await statsOf(alice))?.score).toBeCloseTo(984, 9);
    });
  });

  describe('VAL-GAME-005: stats recalculation (ported recalculateAfterOutcome_Win/Loss)', () => {
    it('lazily creates rows at 1000 with best = worst = 1000 and tracks every field', async () => {
      const a = fresh();
      const b = fresh();
      const apply = (line: ExpectedLine, won: boolean, delta: number) => {
        line.score += won ? delta : -delta;
        line.bestScore = Math.max(line.bestScore, line.score);
        line.worstScore = Math.min(line.worstScore, line.score);
        line.gameCount += 1;
        line.tieStreak = 0;
        if (won) {
          line.winCount += 1;
          line.winStreak += 1;
          line.loseStreak = 0;
          line.longuestWinStreak = Math.max(line.longuestWinStreak, line.winStreak);
        } else {
          line.loseCount += 1;
          line.loseStreak += 1;
          line.winStreak = 0;
          line.longuestLoseStreak = Math.max(line.longuestLoseStreak, line.loseStreak);
        }
      };

      // Game 1: bob beats alice. Loser's worst score drops below 1000, winner's best rises.
      await play([bob], [alice]);
      apply(b, true, 16);
      apply(a, false, 16);
      expectLine(await statsOf(bob), b);
      expectLine(await statsOf(alice), a);
      expect(b).toMatchObject({ score: 1016, bestScore: 1016, worstScore: 1000 });
      expect(a).toMatchObject({ score: 984, bestScore: 1000, worstScore: 984 });

      // Game 2: bob again → win streak 2, alice lose streak 2.
      let d = eloDelta(b.score, a.score);
      await play([bob], [alice]);
      apply(b, true, d);
      apply(a, false, d);
      expectLine(await statsOf(bob), b);
      expectLine(await statsOf(alice), a);
      expect(b).toMatchObject({ winStreak: 2, longuestWinStreak: 2 });
      expect(a).toMatchObject({ loseStreak: 2, longuestLoseStreak: 2 });

      // Game 3: alice wins → streaks reset, longest streaks kept.
      d = eloDelta(a.score, b.score);
      await play([alice], [bob]);
      apply(a, true, d);
      apply(b, false, d);
      expectLine(await statsOf(alice), a);
      expectLine(await statsOf(bob), b);
      expect(a).toMatchObject({ winStreak: 1, loseStreak: 0, longuestLoseStreak: 2 });
      expect(b).toMatchObject({ winStreak: 0, loseStreak: 1, longuestWinStreak: 2 });

      // Game 4: alice again; best/worst stay the extrema over the row's life.
      d = eloDelta(a.score, b.score);
      await play([alice], [bob]);
      apply(a, true, d);
      apply(b, false, d);
      expectLine(await statsOf(alice), a);
      expectLine(await statsOf(bob), b);
      expect(a.gameCount).toBe(4);
      expect(a.winCount + a.loseCount).toBe(4);
      expect(b.bestScore).toBeGreaterThan(b.score);
    });

    it('averages team ratings and gives every teammate the full delta', async () => {
      await createStatsRow(app.db, { userId: bob.id, tournamentId: tournament.id, score: 1100 });
      await play([bob, carol], [alice, dave]);
      const d = eloDelta((1100 + 1000) / 2, 1000);
      expect((await statsOf(bob))?.score).toBeCloseTo(1100 + d, 9);
      expect((await statsOf(carol))?.score).toBeCloseTo(1000 + d, 9);
      expect((await statsOf(alice))?.score).toBeCloseTo(1000 - d, 9);
      expect((await statsOf(dave))?.score).toBeCloseTo(1000 - d, 9);
      expect((await statsOf(carol))?.worstScore).toBe(1000);
    });

    it('keeps stats separate per tournament', async () => {
      const other = await createTournament(app.db, { name: 'chess', displayName: 'Chess' });
      await play([bob], [alice]);
      const rows = await app.db.select().from(stats).where(eq(stats.tournamentId, other.id));
      expect(rows).toHaveLength(0);
    });
  });

  describe('VAL-TOURN-008: GET /tournaments/:name/stats leaderboard', () => {
    const leaderboard = async (name = tournament.name) =>
      app.inject({
        method: 'GET',
        url: `/tournaments/${name}/stats`,
        headers: await authHeadersFor(app, alice.id),
      });

    it('sorts by score descending', async () => {
      await createStatsRow(app.db, { userId: alice.id, tournamentId: tournament.id, score: 900 });
      await createStatsRow(app.db, { userId: bob.id, tournamentId: tournament.id, score: 1100 });
      await createStatsRow(app.db, { userId: carol.id, tournamentId: tournament.id, score: 1000 });
      const res = await leaderboard();
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.map((s: { user: { username: string } }) => s.user.username)).toEqual([
        'bob',
        'carol',
        'alice',
      ]);
      expect(body.map((s: { score: number }) => s.score)).toEqual([1100, 1000, 900]);
    });

    it('reflects recorded games with a camelCase stats DTO', async () => {
      await play([bob], [alice]);
      await play([carol], [dave]);
      await play([carol], [bob]);
      const res = await leaderboard();
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const scores = body.map((s: { score: number }) => s.score);
      expect(scores).toEqual([...scores].sort((x: number, y: number) => y - x));
      expect(body[0].user.username).toBe('carol');
      expect(body[0]).toEqual({
        id: expect.any(String),
        user: expect.objectContaining({ id: carol.id, username: 'carol' }),
        tournament: expect.objectContaining({ id: tournament.id, name: 'babyfoot' }),
        score: expect.any(Number),
        bestScore: expect.any(Number),
        worstScore: 1000,
        gameCount: 2,
        winCount: 2,
        loseCount: 0,
        tieCount: 0,
        winStreak: 2,
        loseStreak: 0,
        tieStreak: 0,
        longestWinStreak: 2,
        longestLoseStreak: 0,
        longestTieStreak: 0,
        bestRivalry: expect.objectContaining({
          rival: expect.objectContaining({ username: expect.any(String) }),
          score: expect.any(Number),
        }),
        worstRivalry: null,
      });
      expect(JSON.stringify(body)).not.toMatch(/longuest|_/);
    });

    it('returns an empty array for a tournament without games', async () => {
      const res = await leaderboard();
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns 404 for an unknown tournament', async () => {
      const res = await leaderboard('nope');
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('TOURNAMENT_NOT_FOUND');
    });
  });
});
