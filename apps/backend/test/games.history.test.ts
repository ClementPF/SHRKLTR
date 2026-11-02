import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

interface GameBody {
  id: string;
  date: string;
  tournament: { name: string; sport: { name: string } };
  outcomes: { result: string; scoreValue: number; user: { username: string } }[];
}

const BASE = Date.parse('2026-01-01T12:00:00.000Z');
const minutes = (n: number) => new Date(BASE + n * 60_000);

describe('VAL-GAME-008: game history and pagination', () => {
  let app: FastifyInstance;
  let tournament: TournamentRow;
  let other: TournamentRow;
  let alice: UserRow;
  let bob: UserRow;
  let carol: UserRow;
  let headers: { authorization: string };

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
    headers = await authHeadersFor(app, alice.id);
  });

  const oneVsOne = (tournamentId: string, winner: UserRow, loser: UserRow, date: Date) =>
    createGameRow(app.db, {
      tournamentId,
      date,
      outcomes: [
        { userId: winner.id, result: 'WIN', scoreValue: 16 },
        { userId: loser.id, result: 'LOSS', scoreValue: -16 },
      ],
    });

  /** 30 games in `tournament`, inserted in shuffled date order so ordering comes from the query. */
  const seedThirtyGames = async () => {
    const order = Array.from({ length: 30 }, (_, i) => (i * 7) % 30);
    for (const i of order) await oneVsOne(tournament.id, bob, alice, minutes(i));
  };

  const get = async (url: string) => app.inject({ method: 'GET', url, headers });

  const expectDateDesc = (body: GameBody[]) => {
    const dates = body.map((g) => Date.parse(g.date));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  };

  describe('GET /tournaments/:name/games', () => {
    it('pages 30 games as 15 + 15 with differing first ids (ported pagination)', async () => {
      await seedThirtyGames();

      const page0 = await get('/tournaments/babyfoot/games?page=0&pageSize=15');
      const page1 = await get('/tournaments/babyfoot/games?page=1&pageSize=15');
      const page2 = await get('/tournaments/babyfoot/games?page=2&pageSize=15');

      expect(page0.statusCode).toBe(200);
      expect(page1.statusCode).toBe(200);
      const first: GameBody[] = page0.json();
      const second: GameBody[] = page1.json();
      expect(first).toHaveLength(15);
      expect(second).toHaveLength(15);
      expect(first[0]?.id).not.toBe(second[0]?.id);
      expect(page2.json()).toEqual([]);

      const ids = new Set([...first, ...second].map((g) => g.id));
      expect(ids.size).toBe(30);
    });

    it('returns games newest first across pages', async () => {
      await seedThirtyGames();

      const first: GameBody[] = (await get('/tournaments/babyfoot/games?pageSize=15')).json();
      const second: GameBody[] = (
        await get('/tournaments/babyfoot/games?page=1&pageSize=15')
      ).json();
      const all = [...first, ...second];

      expectDateDesc(all);
      expect(all[0]?.date).toBe(minutes(29).toISOString());
      expect(all[29]?.date).toBe(minutes(0).toISOString());
    });

    it('defaults to page 0 with 20 games', async () => {
      await seedThirtyGames();

      const res = await get('/tournaments/babyfoot/games');

      expect(res.statusCode).toBe(200);
      const body: GameBody[] = res.json();
      expect(body).toHaveLength(20);
      expect(body[0]?.date).toBe(minutes(29).toISOString());
    });

    it('serializes the game with nested tournament, outcomes and users in camelCase', async () => {
      await oneVsOne(tournament.id, bob, alice, minutes(1));

      const res = await get('/tournaments/babyfoot/games');

      const [game] = res.json() as GameBody[];
      expect(game).toMatchObject({
        date: minutes(1).toISOString(),
        tournament: { name: 'babyfoot', displayName: 'Baby Foot', isOver: false },
        outcomes: [
          { result: 'WIN', scoreValue: 16, user: { username: 'bob' } },
          { result: 'LOSS', scoreValue: -16, user: { username: 'alice' } },
        ],
      });
      expect(game?.tournament.sport.name).toEqual(expect.any(String));
      expect(res.body).not.toMatch(/_[a-z]+"\s*:/);
      expect(res.body).not.toContain('pushToken');
      expect(res.body).not.toContain('email');
    });

    it('only lists games of the requested tournament', async () => {
      await oneVsOne(tournament.id, bob, alice, minutes(1));
      await oneVsOne(other.id, bob, alice, minutes(2));

      const body: GameBody[] = (await get('/tournaments/babyfoot/games')).json();

      expect(body).toHaveLength(1);
      expect(body[0]?.tournament.name).toBe('babyfoot');
    });

    it('returns an empty array for a tournament without games', async () => {
      const res = await get('/tournaments/babyfoot/games');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns 404 for an unknown tournament', async () => {
      const res = await get('/tournaments/nope/games');
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('TOURNAMENT_NOT_FOUND');
    });

    it.each([
      ['pageSize above 100', '?pageSize=101'],
      ['pageSize 0', '?pageSize=0'],
      ['negative page', '?page=-1'],
      ['non-numeric page', '?page=abc'],
    ])('rejects %s with 400', async (_label, query) => {
      const res = await get(`/tournaments/babyfoot/games${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts pageSize 100', async () => {
      await seedThirtyGames();
      const res = await get('/tournaments/babyfoot/games?pageSize=100');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(30);
    });

    it('requires authentication', async () => {
      const res = await app.inject({ method: 'GET', url: '/tournaments/babyfoot/games' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /users/:username/games', () => {
    it('pages 30 of the user games as 15 + 15', async () => {
      await seedThirtyGames();

      const page0 = await get('/users/alice/games?page=0&pageSize=15');
      const page1 = await get('/users/alice/games?page=1&pageSize=15');

      const first: GameBody[] = page0.json();
      const second: GameBody[] = page1.json();
      expect(first).toHaveLength(15);
      expect(second).toHaveLength(15);
      expect(first[0]?.id).not.toBe(second[0]?.id);
      expectDateDesc([...first, ...second]);
    });

    it('lists only games the user played, newest first, across tournaments', async () => {
      await oneVsOne(tournament.id, bob, alice, minutes(1));
      await oneVsOne(other.id, alice, bob, minutes(3));
      await oneVsOne(tournament.id, carol, bob, minutes(2));
      await oneVsOne(other.id, carol, alice, minutes(4));

      const body: GameBody[] = (await get('/users/alice/games')).json();

      expect(body.map((g) => [g.tournament.name, g.date])).toEqual([
        ['pingpong', minutes(4).toISOString()],
        ['pingpong', minutes(3).toISOString()],
        ['babyfoot', minutes(1).toISOString()],
      ]);
      for (const game of body) {
        expect(game.outcomes.map((o) => o.user.username)).toContain('alice');
        expect(game.outcomes).toHaveLength(2);
      }
    });

    it('filters by tournamentName', async () => {
      await oneVsOne(tournament.id, bob, alice, minutes(1));
      await oneVsOne(other.id, alice, bob, minutes(3));
      await oneVsOne(tournament.id, alice, carol, minutes(2));

      const body: GameBody[] = (await get('/users/alice/games?tournamentName=babyfoot')).json();

      expect(body.map((g) => g.date)).toEqual([minutes(2).toISOString(), minutes(1).toISOString()]);
      expect(body.every((g) => g.tournament.name === 'babyfoot')).toBe(true);
    });

    it('returns 404 for an unknown tournament filter', async () => {
      const res = await get('/users/alice/games?tournamentName=nope');
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('TOURNAMENT_NOT_FOUND');
    });

    it('returns 404 for an unknown user', async () => {
      const res = await get('/users/nobody/games');
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('USER_NOT_FOUND');
    });

    it('returns an empty array for a user without games', async () => {
      const res = await get('/users/carol/games');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('rejects pageSize above 100 with 400', async () => {
      const res = await get('/users/alice/games?pageSize=101');
      expect(res.statusCode).toBe(400);
    });

    it('lists a game recorded through POST /tournaments/:name/games', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/tournaments/babyfoot/games',
        headers,
        payload: {
          outcomes: [
            { username: 'bob', result: 'WIN' },
            { username: 'alice', result: 'LOSS' },
          ],
        },
      });
      expect(created.statusCode).toBe(201);

      const [game] = (await get('/users/bob/games')).json() as GameBody[];
      expect(game).toEqual(created.json());
    });
  });
});
