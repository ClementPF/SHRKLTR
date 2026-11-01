import type { FastifyInstance } from 'fastify';
import { count, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { games, outcomes, rivalryStats, stats } from '../src/db/schema.js';
import {
  authHeadersFor,
  buildTestApp,
  createGameRow,
  createStatsRow,
  createTournament,
  createUser,
  truncateAll,
} from './helpers.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;
type TournamentRow = Awaited<ReturnType<typeof createTournament>>;
type Result = 'WIN' | 'LOSS' | 'TIE';

describe('POST /tournaments/:name/games', () => {
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

  const submit = async (
    caller: UserRow,
    gameOutcomes: { username: string; result: Result }[],
    name = tournament.name,
  ) =>
    app.inject({
      method: 'POST',
      url: `/tournaments/${encodeURIComponent(name)}/games`,
      headers: await authHeadersFor(app, caller.id),
      payload: { outcomes: gameOutcomes },
    });

  const tableCounts = async () => {
    const [g] = await app.db.select({ n: count() }).from(games);
    const [o] = await app.db.select({ n: count() }).from(outcomes);
    const [s] = await app.db.select({ n: count() }).from(stats);
    const [r] = await app.db.select({ n: count() }).from(rivalryStats);
    return { games: g?.n, outcomes: o?.n, stats: s?.n, rivalries: r?.n };
  };

  it('requires authentication → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tournaments/${tournament.name}/games`,
      payload: { outcomes: [] },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  describe('VAL-GAME-004: validation matrix (ported validateGame_*)', () => {
    it.each<[string, () => { username: string; result: Result }[]]>([
      ['empty outcomes', () => []],
      [
        '3 winners vs 1 loser (validateGame_2vs2_failure_1)',
        () => [
          { username: 'bob', result: 'WIN' },
          { username: 'carol', result: 'WIN' },
          { username: 'dave', result: 'WIN' },
          { username: 'alice', result: 'LOSS' },
        ],
      ],
      [
        'winners only',
        () => [
          { username: 'bob', result: 'WIN' },
          { username: 'carol', result: 'WIN' },
        ],
      ],
      [
        'same player as winner and loser (validateGame_1vs1_failure)',
        () => [
          { username: 'alice', result: 'WIN' },
          { username: 'alice', result: 'LOSS' },
        ],
      ],
      [
        'repeated loser in 2v2 (validateGame_2vs2 duplicate)',
        () => [
          { username: 'bob', result: 'WIN' },
          { username: 'carol', result: 'WIN' },
          { username: 'alice', result: 'LOSS' },
          { username: 'alice', result: 'LOSS' },
        ],
      ],
      [
        'a TIE result',
        () => [
          { username: 'bob', result: 'TIE' },
          { username: 'alice', result: 'TIE' },
        ],
      ],
      [
        'a TIE mixed into a decisive game',
        () => [
          { username: 'bob', result: 'WIN' },
          { username: 'carol', result: 'TIE' },
          { username: 'alice', result: 'LOSS' },
        ],
      ],
      [
        'an unknown username',
        () => [
          { username: 'ghost', result: 'WIN' },
          { username: 'alice', result: 'LOSS' },
        ],
      ],
    ])('rejects %s → 400 with no writes', async (_label, build) => {
      const before = await tableCounts();
      const res = await submit(alice, build());
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: { code: expect.any(String), message: expect.any(String) },
      });
      expect(await tableCounts()).toEqual(before);
    });

    it('rejects a malformed body (missing outcomes) → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/tournaments/${tournament.name}/games`,
        headers: await authHeadersFor(app, alice.id),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an unknown tournament → 404', async () => {
      const res = await submit(
        alice,
        [
          { username: 'bob', result: 'WIN' },
          { username: 'alice', result: 'LOSS' },
        ],
        'nope',
      );
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('TOURNAMENT_NOT_FOUND');
    });

    it('rejects a winning caller → 403 (validateGame_1vs1_failure_3)', async () => {
      const res = await submit(alice, [
        { username: 'alice', result: 'WIN' },
        { username: 'bob', result: 'LOSS' },
      ]);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('CALLER_MUST_LOSE');
      expect((await tableCounts()).games).toBe(0);
    });

    it('rejects a caller absent from the game → 403', async () => {
      const res = await submit(dave, [
        { username: 'alice', result: 'WIN' },
        { username: 'bob', result: 'LOSS' },
      ]);
      expect(res.statusCode).toBe(403);
      expect((await tableCounts()).games).toBe(0);
    });

    it('accepts a 1v1 with a losing caller → 201 (validateGame_1vs1_success)', async () => {
      const res = await submit(alice, [
        { username: 'bob', result: 'WIN' },
        { username: 'alice', result: 'LOSS' },
      ]);
      expect(res.statusCode).toBe(201);
      const scores = Object.fromEntries(
        res
          .json()
          .outcomes.map((o: { user: { username: string }; scoreValue: number }) => [
            o.user.username,
            o.scoreValue,
          ]),
      );
      expect(scores).toEqual({ bob: 16, alice: -16 });
    });

    it('accepts a 2v2 with a losing caller → 201 with the full game DTO (validateGame_2vs2_success)', async () => {
      const before = Date.now();
      const res = await submit(alice, [
        { username: 'bob', result: 'WIN' },
        { username: 'carol', result: 'WIN' },
        { username: 'alice', result: 'LOSS' },
        { username: 'dave', result: 'LOSS' },
      ]);
      const after = Date.now();
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toEqual({
        id: expect.any(String),
        date: expect.any(String),
        tournament: expect.objectContaining({
          id: tournament.id,
          name: 'babyfoot',
          displayName: 'Baby Foot',
          isOver: false,
          sport: expect.objectContaining({ id: tournament.sportId }),
        }),
        outcomes: expect.any(Array),
      });
      const date = Date.parse(body.date);
      expect(body.date).toBe(new Date(date).toISOString());
      expect(date).toBeGreaterThanOrEqual(before - 1000);
      expect(date).toBeLessThanOrEqual(after + 1000);

      expect(body.outcomes).toHaveLength(4);
      const byUser = new Map<
        string,
        { id: string; result: string; scoreValue: number; user: { id: string } }
      >(body.outcomes.map((o: { user: { username: string } }) => [o.user.username, o]));
      expect(byUser.get('bob')).toMatchObject({
        result: 'WIN',
        scoreValue: 16,
        user: { id: bob.id },
      });
      expect(byUser.get('carol')).toMatchObject({
        result: 'WIN',
        scoreValue: 16,
        user: { id: carol.id },
      });
      expect(byUser.get('alice')).toMatchObject({
        result: 'LOSS',
        scoreValue: -16,
        user: { id: alice.id },
      });
      expect(byUser.get('dave')).toMatchObject({
        result: 'LOSS',
        scoreValue: -16,
        user: { id: dave.id },
      });
      expect(byUser.get('bob')?.user).toEqual({
        id: bob.id,
        username: 'bob',
        firstName: bob.firstName,
        lastName: bob.lastName,
        pictureUrl: null,
        locale: null,
      });
      expect(JSON.stringify(body)).not.toMatch(/_/);

      const gameRows = await app.db.select().from(games);
      expect(gameRows).toHaveLength(1);
      expect(gameRows[0]?.id).toBe(body.id);
      expect(gameRows[0]?.tournamentId).toBe(tournament.id);
      expect(gameRows[0]?.date.toISOString()).toBe(body.date);
      const outcomeRows = await app.db.select().from(outcomes);
      expect(outcomeRows).toHaveLength(4);
      expect(outcomeRows.every((o) => o.gameId === body.id)).toBe(true);
    });

    it('ignores client-supplied date, tournament and scoreValue', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/tournaments/${tournament.name}/games`,
        headers: await authHeadersFor(app, alice.id),
        payload: {
          date: '2001-01-01T00:00:00.000Z',
          tournament: { name: 'other' },
          outcomes: [
            { username: 'bob', result: 'WIN', scoreValue: 500 },
            { username: 'alice', result: 'LOSS', scoreValue: 500 },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(new Date(body.date).getUTCFullYear()).toBeGreaterThan(2001);
      expect(body.tournament.name).toBe('babyfoot');
      expect(body.outcomes.map((o: { scoreValue: number }) => Math.abs(o.scoreValue))).toEqual([
        16, 16,
      ]);
    });

    it('computes deltas from current tournament ratings', async () => {
      await createStatsRow(app.db, { userId: bob.id, tournamentId: tournament.id, score: 1200 });
      const res = await submit(alice, [
        { username: 'bob', result: 'WIN' },
        { username: 'alice', result: 'LOSS' },
      ]);
      expect(res.statusCode).toBe(201);
      const win = res.json().outcomes.find((o: { result: string }) => o.result === 'WIN') as {
        scoreValue: number;
      };
      expect(win.scoreValue).toBeCloseTo(7.688098347265349, 9);
    });
  });

  describe('VAL-GAME-010: atomicity', () => {
    it('a failure mid-transaction leaves zero partial writes', async () => {
      // Pre-existing data must survive untouched.
      await createStatsRow(app.db, { userId: alice.id, tournamentId: tournament.id, score: 1100 });
      await createStatsRow(app.db, { userId: bob.id, tournamentId: tournament.id, score: 900 });
      await createGameRow(app.db, {
        tournamentId: tournament.id,
        outcomes: [
          { userId: bob.id, result: 'WIN', scoreValue: 10 },
          { userId: alice.id, result: 'LOSS', scoreValue: -10 },
        ],
      });
      const before = await tableCounts();
      const statsBefore = await app.db.select().from(stats).orderBy(stats.id);

      // The game row is inserted before outcomes, so failing an outcome insert aborts the
      // transaction after a partial write.
      await app.db.execute(sql`
        create or replace function test_fail_outcome_insert() returns trigger as $$
        begin
          raise exception 'injected outcome failure';
        end;
        $$ language plpgsql
      `);
      await app.db.execute(sql`
        create trigger test_fail_outcome_insert before insert on outcomes
        for each row when (new.result = 'LOSS') execute function test_fail_outcome_insert()
      `);
      try {
        const res = await submit(alice, [
          { username: 'bob', result: 'WIN' },
          { username: 'carol', result: 'WIN' },
          { username: 'alice', result: 'LOSS' },
          { username: 'dave', result: 'LOSS' },
        ]);
        expect(res.statusCode).toBe(500);
        expect(res.json().error.code).toBe('INTERNAL_ERROR');
      } finally {
        await app.db.execute(sql`drop trigger if exists test_fail_outcome_insert on outcomes`);
        await app.db.execute(sql`drop function if exists test_fail_outcome_insert()`);
      }

      expect(await tableCounts()).toEqual(before);
      expect(await app.db.select().from(stats).orderBy(stats.id)).toEqual(statsBefore);

      // After the injected failure is removed the same submission succeeds.
      const ok = await submit(alice, [
        { username: 'bob', result: 'WIN' },
        { username: 'alice', result: 'LOSS' },
      ]);
      expect(ok.statusCode).toBe(201);
    });
  });
});
