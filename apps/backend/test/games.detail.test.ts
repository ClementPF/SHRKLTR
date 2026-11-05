import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { outcomes, stats } from '../src/db/schema.js';
import {
  authHeadersFor,
  buildTestApp,
  createGameRow,
  createTournament,
  createUser,
  truncateAll,
} from './helpers.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;
type TournamentRow = Awaited<ReturnType<typeof createTournament>>;

interface OutcomeBody {
  id: string;
  result: 'WIN' | 'LOSS';
  scoreValue: number;
  ratingBefore: number | null;
  user: { id: string; username: string };
}

interface GameBody {
  id: string;
  date: string;
  tournament: { id: string; name: string; displayName: string; sport: { name: string } };
  outcomes: OutcomeBody[];
}

const expectedDelta = (winnerAvg: number, loserAvg: number) =>
  32 * (1 - 1 / (1 + 10 ** ((loserAvg - winnerAvg) / 400)));

describe('GET /games/:id and outcome rating snapshots', () => {
  let app: FastifyInstance;
  let tournament: TournamentRow;
  let other: TournamentRow;
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
    other = await createTournament(app.db, { name: 'pingpong', displayName: 'Ping Pong' });
    alice = await createUser(app.db, { username: 'alice' });
    bob = await createUser(app.db, { username: 'bob' });
    carol = await createUser(app.db, { username: 'carol' });
    dave = await createUser(app.db, { username: 'dave' });
  });

  const submit = async (
    caller: UserRow,
    gameOutcomes: { username: string; result: 'WIN' | 'LOSS' }[],
    name = tournament.name,
  ) => {
    const res = await app.inject({
      method: 'POST',
      url: `/tournaments/${name}/games`,
      headers: await authHeadersFor(app, caller.id),
      payload: { outcomes: gameOutcomes },
    });
    expect(res.statusCode).toBe(201);
    return res.json<GameBody>();
  };

  const getGame = async (id: string, viewer: UserRow = alice) =>
    app.inject({
      method: 'GET',
      url: `/games/${id}`,
      headers: await authHeadersFor(app, viewer.id),
    });

  const byUsername = (game: GameBody) =>
    Object.fromEntries(game.outcomes.map((o) => [o.user.username, o]));

  const scoreOf = async (user: UserRow, t: TournamentRow = tournament) => {
    const [row] = await app.db
      .select({ score: stats.score })
      .from(stats)
      .where(and(eq(stats.userId, user.id), eq(stats.tournamentId, t.id)));
    return row ? row.score : 1000;
  };

  it('requires authentication → 401', async () => {
    const posted = await submit(bob, [
      { username: 'alice', result: 'WIN' },
      { username: 'bob', result: 'LOSS' },
    ]);
    const res = await app.inject({ method: 'GET', url: `/games/${posted.id}` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('returns 404 GAME_NOT_FOUND for an unknown UUID', async () => {
    const res = await getGame('00000000-0000-4000-8000-000000000000');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'GAME_NOT_FOUND', message: expect.any(String) },
    });
  });

  it('rejects a malformed id with 400 VALIDATION_ERROR', async () => {
    const res = await getGame('not-a-uuid');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns the durable game matching the POST response and history row', async () => {
    const posted = await submit(bob, [
      { username: 'alice', result: 'WIN' },
      { username: 'bob', result: 'LOSS' },
    ]);
    // A viewer who did not play still sees open-tournament games.
    const res = await getGame(posted.id, carol);
    expect(res.statusCode).toBe(200);
    const game = res.json<GameBody>();
    expect(game).toEqual(posted);
    expect(game.tournament).toMatchObject({ id: tournament.id, name: 'babyfoot' });
    expect(game.tournament.sport.name).toEqual(expect.any(String));
    expect(game.outcomes.map((o) => [o.user.username, o.result, o.scoreValue])).toEqual([
      ['alice', 'WIN', 16],
      ['bob', 'LOSS', -16],
    ]);

    const history = await app.inject({
      method: 'GET',
      url: '/users/alice/games',
      headers: await authHeadersFor(app, alice.id),
    });
    expect(history.json<GameBody[]>()[0]).toEqual(game);
  });

  it('VAL-GAME-007: snapshots each participant’s pre-game tournament rating', async () => {
    const first = await submit(bob, [
      { username: 'alice', result: 'WIN' },
      { username: 'bob', result: 'LOSS' },
    ]);
    expect(byUsername(first).alice?.ratingBefore).toBe(1000);
    expect(byUsername(first).bob?.ratingBefore).toBe(1000);

    const aliceBefore = await scoreOf(alice);
    const bobBefore = await scoreOf(bob);
    expect([aliceBefore, bobBefore]).toEqual([1016, 984]);
    const second = await submit(alice, [
      { username: 'bob', result: 'WIN' },
      { username: 'alice', result: 'LOSS' },
    ]);
    expect(byUsername(second).alice?.ratingBefore).toBe(aliceBefore);
    expect(byUsername(second).bob?.ratingBefore).toBe(bobBefore);

    // A later game must not rewrite earlier snapshots.
    await submit(bob, [
      { username: 'alice', result: 'WIN' },
      { username: 'bob', result: 'LOSS' },
    ]);
    const reread = (await getGame(first.id)).json<GameBody>();
    expect(byUsername(reread).alice?.ratingBefore).toBe(1000);
    const reread2 = (await getGame(second.id)).json<GameBody>();
    expect(byUsername(reread2).bob?.ratingBefore).toBe(bobBefore);
    const history = await app.inject({
      method: 'GET',
      url: '/tournaments/babyfoot/games',
      headers: await authHeadersFor(app, alice.id),
    });
    const historical = history.json<GameBody[]>().find((g) => g.id === second.id);
    expect(historical && byUsername(historical).alice?.ratingBefore).toBe(aliceBefore);
  });

  it('VAL-GAME-006: team Elo uses pre-game averages and stays tournament-local', async () => {
    await submit(bob, [
      { username: 'alice', result: 'WIN' },
      { username: 'bob', result: 'LOSS' },
    ]);
    await submit(dave, [
      { username: 'carol', result: 'WIN' },
      { username: 'dave', result: 'LOSS' },
    ]);
    await submit(
      dave,
      [
        { username: 'carol', result: 'WIN' },
        { username: 'dave', result: 'LOSS' },
      ],
      other.name,
    );
    const before = {
      alice: await scoreOf(alice),
      bob: await scoreOf(bob),
      carol: await scoreOf(carol),
      dave: await scoreOf(dave),
    };
    const [otherBefore] = await app.db.select().from(stats).where(eq(stats.tournamentId, other.id));

    // alice+dave (1016, 984) beat bob+carol (984, 1016 in babyfoot).
    const game = await submit(bob, [
      { username: 'alice', result: 'WIN' },
      { username: 'dave', result: 'WIN' },
      { username: 'bob', result: 'LOSS' },
      { username: 'carol', result: 'LOSS' },
    ]);
    const delta = expectedDelta((before.alice + before.dave) / 2, (before.bob + before.carol) / 2);
    const o = byUsername(game);
    expect(o.alice?.scoreValue).toBeCloseTo(delta, 12);
    expect(o.dave?.scoreValue).toBeCloseTo(delta, 12);
    expect(o.bob?.scoreValue).toBeCloseTo(-delta, 12);
    expect(o.carol?.scoreValue).toBeCloseTo(-delta, 12);
    for (const name of ['alice', 'bob', 'carol', 'dave'] as const) {
      expect(o[name]?.ratingBefore).toBe(before[name]);
    }
    expect(await scoreOf(alice)).toBeCloseTo(before.alice + delta, 12);
    expect(await scoreOf(bob)).toBeCloseTo(before.bob - delta, 12);

    const otherAfter = await app.db.select().from(stats).where(eq(stats.tournamentId, other.id));
    expect(otherAfter.find((r) => r.id === otherBefore?.id)?.score).toBe(otherBefore?.score);
  });

  it('keeps historical outcomes without a snapshot as null', async () => {
    const { game } = await createGameRow(app.db, {
      tournamentId: tournament.id,
      outcomes: [
        { userId: alice.id, result: 'WIN', scoreValue: 16 },
        { userId: bob.id, result: 'LOSS', scoreValue: -16 },
      ],
    });
    const res = await getGame(game.id);
    expect(res.statusCode).toBe(200);
    expect(res.json<GameBody>().outcomes.map((o) => o.ratingBefore)).toEqual([null, null]);
    const rows = await app.db.select().from(outcomes).where(eq(outcomes.gameId, game.id));
    expect(rows.map((r) => r.ratingBefore)).toEqual([null, null]);
  });
});
