import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authHeadersFor,
  buildTestApp,
  createTournament,
  createUser,
  truncateAll,
} from './helpers.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;

interface RivalryBody {
  user: { username: string };
  rival: { username: string };
  tournament: { name: string };
  score: number;
  gameCount: number;
}

interface StatsBody {
  user: { username: string };
  tournament: { name: string };
  score: number;
  gameCount: number;
  bestRivalry: RivalryBody | null;
  worstRivalry: RivalryBody | null;
}

const pairs = (rows: RivalryBody[]) =>
  rows.map((r) => `${r.tournament.name}:${r.user.username}->${r.rival.username}`);

describe('stats and rivalry read routes', () => {
  let app: FastifyInstance;
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

  const play = async (tournament: string, winner: UserRow, loser: UserRow) => {
    const res = await app.inject({
      method: 'POST',
      url: `/tournaments/${tournament}/games`,
      headers: await authHeadersFor(app, loser.id),
      payload: {
        outcomes: [
          { username: winner.username, result: 'WIN' },
          { username: loser.username, result: 'LOSS' },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
  };

  beforeEach(async () => {
    await truncateAll(app.db);
    await createTournament(app.db, { name: 'babyfoot', displayName: 'Baby Foot' });
    await createTournament(app.db, { name: 'pingpong', displayName: 'Ping Pong' });
    alice = await createUser(app.db, { username: 'alice' });
    bob = await createUser(app.db, { username: 'bob' });
    carol = await createUser(app.db, { username: 'carol' });
    await createUser(app.db, { username: 'idle' });
    headers = await authHeadersFor(app, alice.id);

    await play('babyfoot', bob, alice);
    await play('babyfoot', carol, alice);
    await play('pingpong', alice, bob);
  });

  const get = (url: string) => app.inject({ method: 'GET', url, headers });

  describe('GET /users/:username/stats', () => {
    it('lists the user stats of every tournament played', async () => {
      const res = await get('/users/alice/stats');

      expect(res.statusCode).toBe(200);
      const body: StatsBody[] = res.json();
      expect(body.map((s) => [s.tournament.name, s.user.username, s.gameCount])).toEqual([
        ['babyfoot', 'alice', 2],
        ['pingpong', 'alice', 1],
      ]);
      const babyfoot = body[0];
      expect(babyfoot?.score).toBeLessThan(1000);
      expect(babyfoot?.bestRivalry).toBeNull();
      expect(babyfoot?.worstRivalry?.user.username).toBe('alice');
      expect(body[1]?.score).toBeCloseTo(1016, 9);
      expect(body[1]?.bestRivalry?.rival.username).toBe('bob');
      expect(res.body).not.toContain('longuest');
    });

    it('returns an empty array for a user who never played', async () => {
      const res = await get('/users/idle/stats');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns 404 for an unknown user', async () => {
      const res = await get('/users/nobody/stats');
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('GET /users/:username/rivalries', () => {
    it('lists the user rivalries across tournaments', async () => {
      const body: RivalryBody[] = (await get('/users/alice/rivalries')).json();
      expect(pairs(body).sort()).toEqual([
        'babyfoot:alice->bob',
        'babyfoot:alice->carol',
        'pingpong:alice->bob',
      ]);
    });

    it('filters by tournamentName', async () => {
      const body: RivalryBody[] = (
        await get('/users/alice/rivalries?tournamentName=babyfoot')
      ).json();
      expect(pairs(body).sort()).toEqual(['babyfoot:alice->bob', 'babyfoot:alice->carol']);
      expect(body.every((r) => r.score < 0)).toBe(true);
    });

    it('returns 404 for an unknown tournament filter or user', async () => {
      expect((await get('/users/alice/rivalries?tournamentName=nope')).statusCode).toBe(404);
      expect((await get('/users/nobody/rivalries')).statusCode).toBe(404);
    });
  });

  describe('GET /tournaments/:name/rivalries', () => {
    it('lists every directional rivalry of the tournament', async () => {
      const body: RivalryBody[] = (await get('/tournaments/babyfoot/rivalries')).json();
      expect(pairs(body).sort()).toEqual([
        'babyfoot:alice->bob',
        'babyfoot:alice->carol',
        'babyfoot:bob->alice',
        'babyfoot:carol->alice',
      ]);
    });

    it('filters by userName and rivalName', async () => {
      const mine: RivalryBody[] = (
        await get('/tournaments/babyfoot/rivalries?userName=alice')
      ).json();
      expect(pairs(mine).sort()).toEqual(['babyfoot:alice->bob', 'babyfoot:alice->carol']);

      const one: RivalryBody[] = (
        await get('/tournaments/babyfoot/rivalries?userName=alice&rivalName=bob')
      ).json();
      expect(pairs(one)).toEqual(['babyfoot:alice->bob']);
      expect(one[0]?.score).toBeCloseTo(-16, 9);
    });

    it('returns 404 for an unknown tournament or user filter', async () => {
      expect((await get('/tournaments/nope/rivalries')).statusCode).toBe(404);
      expect((await get('/tournaments/babyfoot/rivalries?userName=nobody')).statusCode).toBe(404);
      expect((await get('/tournaments/babyfoot/rivalries?rivalName=nobody')).statusCode).toBe(404);
    });
  });

  describe('GET /stats', () => {
    it('returns the stats of a user in a tournament', async () => {
      const res = await get('/stats?userName=bob&tournamentName=babyfoot');
      expect(res.statusCode).toBe(200);
      const body: StatsBody = res.json();
      expect(body.user.username).toBe('bob');
      expect(body.tournament.name).toBe('babyfoot');
      expect(body.score).toBeCloseTo(1016, 9);
      expect(body.bestRivalry?.rival.username).toBe('alice');
    });

    it('returns 404 when the user has no stats there, or user/tournament is unknown', async () => {
      expect((await get('/stats?userName=idle&tournamentName=babyfoot')).json().error.code).toBe(
        'STATS_NOT_FOUND',
      );
      expect((await get('/stats?userName=nobody&tournamentName=babyfoot')).statusCode).toBe(404);
      expect((await get('/stats?userName=bob&tournamentName=nope')).statusCode).toBe(404);
    });

    it('requires both query parameters', async () => {
      expect((await get('/stats?userName=bob')).statusCode).toBe(400);
    });
  });

  describe('GET /rivalries and GET /rivalry', () => {
    it('lists a user rivalries in a tournament', async () => {
      const body: RivalryBody[] = (
        await get('/rivalries?userName=alice&tournamentName=babyfoot')
      ).json();
      expect(pairs(body).sort()).toEqual(['babyfoot:alice->bob', 'babyfoot:alice->carol']);
    });

    it('returns one directional rivalry', async () => {
      const res = await get('/rivalry?userName=bob&rivalName=alice&tournamentName=babyfoot');
      expect(res.statusCode).toBe(200);
      const body: RivalryBody = res.json();
      expect(pairs([body])).toEqual(['babyfoot:bob->alice']);
      expect(body.score).toBeCloseTo(16, 9);
      expect(body.gameCount).toBe(1);
    });

    it('returns 404 for a rivalry that does not exist', async () => {
      const res = await get('/rivalry?userName=bob&rivalName=carol&tournamentName=babyfoot');
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('RIVALRY_NOT_FOUND');
    });

    it('returns 404 for unknown names and 400 for missing parameters', async () => {
      expect((await get('/rivalries?userName=nobody&tournamentName=babyfoot')).statusCode).toBe(
        404,
      );
      expect(
        (await get('/rivalry?userName=bob&rivalName=nobody&tournamentName=babyfoot')).statusCode,
      ).toBe(404);
      expect((await get('/rivalry?userName=bob&tournamentName=babyfoot')).statusCode).toBe(400);
    });

    it('requires authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/stats?userName=bob&tournamentName=babyfoot',
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
