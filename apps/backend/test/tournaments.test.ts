import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { games, outcomes, rivalryStats, sports, stats, tournaments } from '../src/db/schema.js';
import {
  authHeadersFor,
  buildTestApp,
  createGameRow,
  createSport,
  createStatsRow,
  createTournament,
  createUser,
  truncateAll,
} from './helpers.js';

type Headers = { authorization: string };

// U+0130 lowercases to "i" + U+0307, so the longest valid displayName (100 chars) derives a
// 200 UTF-16 code unit slug.
const MAX_DISPLAY_NAME = 'İ'.repeat(100);
const MAX_SLUG = MAX_DISPLAY_NAME.toLowerCase();
const MAX_SLUG_PATH = `/tournaments/${encodeURIComponent(MAX_SLUG)}`;
type UserRow = Awaited<ReturnType<typeof createUser>>;

describe('tournament routes', () => {
  let app: FastifyInstance;
  let owner: UserRow;
  let headers: Headers;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    owner = await createUser(app.db, { username: 'owner', firstName: 'Olive' });
    headers = await authHeadersFor(app, owner.id);
  });

  const post = (payload: unknown, h: Headers = headers) =>
    app.inject({ method: 'POST', url: '/tournaments', headers: h, payload: payload as object });

  describe('authentication', () => {
    it.each([
      ['GET', '/tournaments'],
      ['POST', '/tournaments'],
      ['GET', '/tournaments/x'],
      ['PUT', '/tournaments/x'],
      ['DELETE', '/tournaments/x'],
      ['GET', '/tournaments/x/users'],
      ['GET', '/users/owner/tournaments'],
    ] as const)('%s %s without a token → 401', async (method, url) => {
      const res = await app.inject({
        method,
        url,
        payload: method === 'POST' || method === 'PUT' ? {} : undefined,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('VAL-TOURN-002: POST /tournaments', () => {
    it('creates a tournament → 201 with derived slug, caller as owner and isOver=false', async () => {
      const sport = await createSport(app.db, { name: 'babyfoot' });
      const res = await post({ displayName: 'Baby Foot  Office\tCup', sportName: 'babyfoot' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({
        id: expect.any(String),
        name: 'babyfootofficecup',
        displayName: 'Baby Foot  Office\tCup',
        isOver: false,
        sport: { id: sport.id, name: 'babyfoot' },
        owner: expect.objectContaining({ id: owner.id, username: 'owner' }),
      });
      const rows = await app.db.select().from(tournaments);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: 'babyfootofficecup',
        ownerUserId: owner.id,
        sportId: sport.id,
        isOver: false,
      });
    });

    it('ignores a client-supplied isOver/name/owner (server decides)', async () => {
      const other = await createUser(app.db);
      const res = await post({
        displayName: 'Ping Pong',
        sportName: 'pingpong',
        isOver: true,
        name: 'hijack',
        owner: { id: other.id },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ name: 'pingpong', isOver: false });
      expect(res.json().owner.id).toBe(owner.id);
    });

    it('creates an unknown sport implicitly and associates it', async () => {
      expect(await app.db.select().from(sports)).toHaveLength(0);
      const res = await post({ displayName: 'Curling League', sportName: 'curling' });
      expect(res.statusCode).toBe(201);
      const sportRows = await app.db.select().from(sports);
      expect(sportRows).toEqual([{ id: expect.any(String), name: 'curling' }]);
      expect(res.json().sport).toEqual(sportRows[0]);
    });

    it('reuses an existing sport instead of duplicating it', async () => {
      await createSport(app.db, { name: 'babyfoot' });
      expect((await post({ displayName: 'A', sportName: 'babyfoot' })).statusCode).toBe(201);
      expect((await post({ displayName: 'B', sportName: 'babyfoot' })).statusCode).toBe(201);
      expect(await app.db.select().from(sports)).toHaveLength(1);
    });

    it('rejects a duplicate derived name with 400 (createTournament_already_exists)', async () => {
      expect((await post({ displayName: 'Baby Foot', sportName: 'babyfoot' })).statusCode).toBe(
        201,
      );
      const res = await post({ displayName: 'BABYFOOT', sportName: 'other' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('TOURNAMENT_ALREADY_EXISTS');
      expect(await app.db.select().from(tournaments)).toHaveLength(1);
      // The implicitly created sport is rolled back together with the failed tournament.
      expect((await app.db.select().from(sports)).map((s) => s.name)).toEqual(['babyfoot']);
    });

    it.each([
      ['missing sportName (createTournament_no_sport)', { displayName: 'No Sport' }],
      ['blank sportName', { displayName: 'No Sport', sportName: '  ' }],
      ['missing displayName', { sportName: 'babyfoot' }],
      ['whitespace-only displayName', { displayName: ' \t ', sportName: 'babyfoot' }],
    ])('rejects %s with 400 and persists nothing', async (_label, payload) => {
      const res = await post(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      expect(await app.db.select().from(tournaments)).toHaveLength(0);
      expect(await app.db.select().from(sports)).toHaveLength(0);
    });

    it('rejects a displayName over 100 characters with 400', async () => {
      const res = await post({ displayName: `${MAX_DISPLAY_NAME}I`, sportName: 'babyfoot' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('creates a maximal Unicode name whose 200-unit slug is routable', async () => {
      expect(MAX_SLUG).toHaveLength(200);
      const res = await post({ displayName: MAX_DISPLAY_NAME, sportName: 'babyfoot' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ name: MAX_SLUG, displayName: MAX_DISPLAY_NAME });
      const detail = await app.inject({ method: 'GET', url: MAX_SLUG_PATH, headers });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toEqual(res.json());
    });

    it('save/findByName: the created tournament reads back identically', async () => {
      const created = (await post({ displayName: 'Office Cup', sportName: 'babyfoot' })).json();
      const res = await app.inject({ method: 'GET', url: '/tournaments/officecup', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(created);
    });
  });

  describe('VAL-TOURN-003: GET /tournaments/:name', () => {
    it('returns the tournament with nested owner and sport', async () => {
      const sport = await createSport(app.db, { name: 'pingpong' });
      const t = await createTournament(app.db, {
        name: 'pingcup',
        displayName: 'Ping Cup',
        sportId: sport.id,
        ownerUserId: owner.id,
        isOver: true,
      });
      const res = await app.inject({ method: 'GET', url: '/tournaments/pingcup', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id: t.id,
        name: 'pingcup',
        displayName: 'Ping Cup',
        isOver: true,
        sport: { id: sport.id, name: 'pingpong' },
        owner: {
          id: owner.id,
          username: 'owner',
          accountType: 'REGISTERED',
          firstName: 'Olive',
          lastName: owner.lastName,
          pictureUrl: null,
          locale: null,
        },
      });
    });

    it('returns owner null when the owner account is gone', async () => {
      await createTournament(app.db, { name: 'orphan', ownerUserId: null });
      const res = await app.inject({ method: 'GET', url: '/tournaments/orphan', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json().owner).toBeNull();
    });

    it('returns 404 for an unknown name', async () => {
      const res = await app.inject({ method: 'GET', url: '/tournaments/nope', headers });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('TOURNAMENT_NOT_FOUND');
    });

    it('routes an unknown 200-character name to the handler (404)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/tournaments/${'a'.repeat(200)}`,
        headers,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('TOURNAMENT_NOT_FOUND');
    });

    it('rejects a name longer than 200 characters with 414', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/tournaments/${'a'.repeat(201)}`,
        headers,
      });
      expect(res.statusCode).toBe(414);
    });
  });

  describe('VAL-TOURN-004: GET /tournaments', () => {
    async function seedWithGames(name: string, sportId: string, gameCount: number) {
      const t = await createTournament(app.db, { name, sportId, ownerUserId: owner.id });
      for (let i = 0; i < gameCount; i++) {
        await createGameRow(app.db, { tournamentId: t.id, outcomes: [] });
      }
      return t;
    }

    it('returns an empty array when there are no tournaments', async () => {
      const res = await app.inject({ method: 'GET', url: '/tournaments', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns all tournaments sorted by game count desc', async () => {
      const foot = await createSport(app.db, { name: 'babyfoot' });
      const ping = await createSport(app.db, { name: 'pingpong' });
      await seedWithGames('one', foot.id, 1);
      await seedWithGames('three', ping.id, 3);
      await seedWithGames('zero', foot.id, 0);
      await seedWithGames('two', ping.id, 2);

      const res = await app.inject({ method: 'GET', url: '/tournaments', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json().map((t: { name: string }) => t.name)).toEqual([
        'three',
        'two',
        'one',
        'zero',
      ]);
      expect(res.json()[0]).toMatchObject({
        sport: { id: ping.id, name: 'pingpong' },
        owner: { id: owner.id },
      });
    });

    it('findBySport: ?sport=<name> filters to that sport, still sorted by games', async () => {
      const foot = await createSport(app.db, { name: 'babyfoot' });
      const ping = await createSport(app.db, { name: 'pingpong' });
      await seedWithGames('f1', foot.id, 1);
      await seedWithGames('f5', foot.id, 5);
      await seedWithGames('p9', ping.id, 9);

      const res = await app.inject({ method: 'GET', url: '/tournaments?sport=babyfoot', headers });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.map((t: { name: string }) => t.name)).toEqual(['f5', 'f1']);
      for (const t of body) expect(t.sport).toEqual({ id: foot.id, name: 'babyfoot' });
    });

    it('?sport= (empty) returns all tournaments', async () => {
      const foot = await createSport(app.db, { name: 'babyfoot' });
      const ping = await createSport(app.db, { name: 'pingpong' });
      await seedWithGames('f1', foot.id, 1);
      await seedWithGames('p2', ping.id, 2);
      const res = await app.inject({ method: 'GET', url: '/tournaments?sport=', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json().map((t: { name: string }) => t.name)).toEqual(['p2', 'f1']);
    });

    it('findBySportId_notFound: unknown sport → 404', async () => {
      const res = await app.inject({ method: 'GET', url: '/tournaments?sport=nosuch', headers });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('SPORT_NOT_FOUND');
    });

    it('known sport without tournaments → empty array', async () => {
      await createSport(app.db, { name: 'chess' });
      const res = await app.inject({ method: 'GET', url: '/tournaments?sport=chess', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe('VAL-TOURN-005: PUT /tournaments/:name', () => {
    it('updates in place: same id, regenerated slug, changed fields', async () => {
      const created = (await post({ displayName: 'Office Cup', sportName: 'babyfoot' })).json();
      const res = await app.inject({
        method: 'PUT',
        url: '/tournaments/officecup',
        headers,
        payload: { displayName: 'Office Cup 2027', isOver: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        ...created,
        name: 'officecup2027',
        displayName: 'Office Cup 2027',
        isOver: true,
      });
      const rows = await app.db.select().from(tournaments);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: created.id, name: 'officecup2027', isOver: true });

      const oldName = await app.inject({ method: 'GET', url: '/tournaments/officecup', headers });
      expect(oldName.statusCode).toBe(404);
      const newName = await app.inject({
        method: 'GET',
        url: '/tournaments/officecup2027',
        headers,
      });
      expect(newName.json().id).toBe(created.id);
    });

    it('renames into the maximal Unicode slug and back out of it', async () => {
      const created = (await post({ displayName: 'Cup', sportName: 'babyfoot' })).json();
      const intoLong = await app.inject({
        method: 'PUT',
        url: '/tournaments/cup',
        headers,
        payload: { displayName: MAX_DISPLAY_NAME },
      });
      expect(intoLong.statusCode).toBe(200);
      expect(intoLong.json()).toMatchObject({ id: created.id, name: MAX_SLUG });

      const detail = await app.inject({ method: 'GET', url: MAX_SLUG_PATH, headers });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().id).toBe(created.id);

      const toggled = await app.inject({
        method: 'PUT',
        url: MAX_SLUG_PATH,
        headers,
        payload: { isOver: true },
      });
      expect(toggled.statusCode).toBe(200);
      expect(toggled.json()).toMatchObject({ id: created.id, name: MAX_SLUG, isOver: true });

      const outOfLong = await app.inject({
        method: 'PUT',
        url: MAX_SLUG_PATH,
        headers,
        payload: { displayName: 'Short Cup' },
      });
      expect(outOfLong.statusCode).toBe(200);
      expect(outOfLong.json()).toMatchObject({ id: created.id, name: 'shortcup', isOver: true });
      expect((await app.inject({ method: 'GET', url: MAX_SLUG_PATH, headers })).statusCode).toBe(
        404,
      );
    });

    it('keeps games and stats attached after a rename', async () => {
      const t = await createTournament(app.db, { name: 'cup', ownerUserId: owner.id });
      await createGameRow(app.db, { tournamentId: t.id, outcomes: [] });
      await createStatsRow(app.db, { userId: owner.id, tournamentId: t.id });
      const res = await app.inject({
        method: 'PUT',
        url: '/tournaments/cup',
        headers,
        payload: { displayName: 'Renamed Cup' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: t.id, name: 'renamedcup', isOver: false });
      expect(await app.db.select().from(games).where(eq(games.tournamentId, t.id))).toHaveLength(1);
      expect(await app.db.select().from(stats).where(eq(stats.tournamentId, t.id))).toHaveLength(1);
    });

    it('can toggle isOver alone without touching the name', async () => {
      const t = await createTournament(app.db, {
        name: 'cup',
        displayName: 'Cup',
        ownerUserId: owner.id,
      });
      const res = await app.inject({
        method: 'PUT',
        url: '/tournaments/cup',
        headers,
        payload: { isOver: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: t.id, name: 'cup', displayName: 'Cup', isOver: true });
    });

    it('rejects a non-owner with 403 and leaves the row unchanged', async () => {
      const t = await createTournament(app.db, { name: 'cup', ownerUserId: owner.id });
      const intruder = await createUser(app.db);
      const res = await app.inject({
        method: 'PUT',
        url: '/tournaments/cup',
        headers: await authHeadersFor(app, intruder.id),
        payload: { displayName: 'Hijacked', isOver: true },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('NOT_TOURNAMENT_OWNER');
      const [row] = await app.db.select().from(tournaments);
      expect(row).toMatchObject({ id: t.id, name: 'cup', isOver: false });
    });

    it('returns 404 for an unknown tournament', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/tournaments/nope',
        headers,
        payload: { isOver: true },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('TOURNAMENT_NOT_FOUND');
    });

    it('rejects a rename onto an existing slug with 400', async () => {
      await createTournament(app.db, { name: 'cup', ownerUserId: owner.id });
      await createTournament(app.db, { name: 'othercup', ownerUserId: owner.id });
      const res = await app.inject({
        method: 'PUT',
        url: '/tournaments/cup',
        headers,
        payload: { displayName: 'Other Cup' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('TOURNAMENT_ALREADY_EXISTS');
    });

    it.each([
      ['empty body', {}],
      ['whitespace-only displayName', { displayName: '  ' }],
      ['non-boolean isOver', { isOver: 'yes' }],
    ])('rejects %s with 400', async (_label, payload) => {
      await createTournament(app.db, { name: 'cup', ownerUserId: owner.id });
      const res = await app.inject({ method: 'PUT', url: '/tournaments/cup', headers, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('VAL-TOURN-006: DELETE /tournaments/:name', () => {
    async function seedFullTournament(name: string) {
      const rival = await createUser(app.db);
      const t = await createTournament(app.db, { name, ownerUserId: owner.id });
      for (let i = 0; i < 2; i++) {
        await createGameRow(app.db, {
          tournamentId: t.id,
          outcomes: [
            { userId: owner.id, result: 'WIN', scoreValue: 16 },
            { userId: rival.id, result: 'LOSS', scoreValue: -16 },
          ],
        });
      }
      await createStatsRow(app.db, { userId: owner.id, tournamentId: t.id });
      await createStatsRow(app.db, { userId: rival.id, tournamentId: t.id });
      await app.db.insert(rivalryStats).values([
        {
          userId: owner.id,
          rivalId: rival.id,
          tournamentId: t.id,
          score: 32,
          bestScore: 32,
          worstScore: 0,
        },
        {
          userId: rival.id,
          rivalId: owner.id,
          tournamentId: t.id,
          score: -32,
          bestScore: 0,
          worstScore: -32,
        },
      ]);
      return t;
    }

    it('deletes as owner → 204 and cascades games, outcomes, stats and rivalries', async () => {
      const doomed = await seedFullTournament('doomed');
      const kept = await seedFullTournament('kept');

      const res = await app.inject({ method: 'DELETE', url: '/tournaments/doomed', headers });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');

      expect(await app.db.select().from(tournaments).where(eq(tournaments.id, doomed.id))).toEqual(
        [],
      );
      expect(await app.db.select().from(games).where(eq(games.tournamentId, doomed.id))).toEqual(
        [],
      );
      expect(await app.db.select().from(stats).where(eq(stats.tournamentId, doomed.id))).toEqual(
        [],
      );
      expect(
        await app.db.select().from(rivalryStats).where(eq(rivalryStats.tournamentId, doomed.id)),
      ).toEqual([]);

      // Only the other tournament's rows survive: 2 games × 2 outcomes, 2 stats, 2 rivalries.
      expect(await app.db.select().from(tournaments)).toHaveLength(1);
      expect(await app.db.select().from(games)).toHaveLength(2);
      expect(await app.db.select().from(outcomes)).toHaveLength(4);
      expect(await app.db.select().from(stats)).toHaveLength(2);
      expect(await app.db.select().from(rivalryStats)).toHaveLength(2);
      for (const g of await app.db.select().from(games)) expect(g.tournamentId).toBe(kept.id);

      const after = await app.inject({ method: 'GET', url: '/tournaments/doomed', headers });
      expect(after.statusCode).toBe(404);
    });

    it('deletes a maximal Unicode slug → 204 with the same cascade', async () => {
      const doomed = await seedFullTournament(MAX_SLUG);
      await seedFullTournament('kept');

      const res = await app.inject({ method: 'DELETE', url: MAX_SLUG_PATH, headers });
      expect(res.statusCode).toBe(204);

      expect(await app.db.select().from(tournaments).where(eq(tournaments.id, doomed.id))).toEqual(
        [],
      );
      expect(await app.db.select().from(tournaments)).toHaveLength(1);
      expect(await app.db.select().from(games)).toHaveLength(2);
      expect(await app.db.select().from(outcomes)).toHaveLength(4);
      expect(await app.db.select().from(stats)).toHaveLength(2);
      expect(await app.db.select().from(rivalryStats)).toHaveLength(2);
      expect((await app.inject({ method: 'GET', url: MAX_SLUG_PATH, headers })).statusCode).toBe(
        404,
      );
    });

    it('rejects a non-owner with 403 and deletes nothing', async () => {
      await seedFullTournament('cup');
      const intruder = await createUser(app.db);
      const res = await app.inject({
        method: 'DELETE',
        url: '/tournaments/cup',
        headers: await authHeadersFor(app, intruder.id),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('NOT_TOURNAMENT_OWNER');
      expect(await app.db.select().from(tournaments)).toHaveLength(1);
      expect(await app.db.select().from(games)).toHaveLength(2);
      expect(await app.db.select().from(outcomes)).toHaveLength(4);
      expect(await app.db.select().from(stats)).toHaveLength(2);
      expect(await app.db.select().from(rivalryStats)).toHaveLength(2);
    });

    it('returns 404 for an unknown tournament', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/tournaments/nope', headers });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('TOURNAMENT_NOT_FOUND');
    });
  });

  describe('VAL-TOURN-007: GET /tournaments/:name/users', () => {
    it('returns exactly the users with stats rows in that tournament', async () => {
      const t = await createTournament(app.db, { name: 'cup', ownerUserId: owner.id });
      const other = await createTournament(app.db, { name: 'other', ownerUserId: owner.id });
      const alice = await createUser(app.db, { username: 'alice' });
      const bob = await createUser(app.db, { username: 'bob' });
      const carol = await createUser(app.db, { username: 'carol' });
      await createStatsRow(app.db, { userId: bob.id, tournamentId: t.id });
      await createStatsRow(app.db, { userId: alice.id, tournamentId: t.id });
      await createStatsRow(app.db, { userId: carol.id, tournamentId: other.id });

      const res = await app.inject({ method: 'GET', url: '/tournaments/cup/users', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        expect.objectContaining({ id: alice.id, username: 'alice' }),
        expect.objectContaining({ id: bob.id, username: 'bob' }),
      ]);
    });

    it('lists members of a tournament with the maximal Unicode slug', async () => {
      const created = (await post({ displayName: MAX_DISPLAY_NAME, sportName: 'babyfoot' })).json();
      const alice = await createUser(app.db, { username: 'alice' });
      await createStatsRow(app.db, { userId: alice.id, tournamentId: created.id });

      const res = await app.inject({ method: 'GET', url: `${MAX_SLUG_PATH}/users`, headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([expect.objectContaining({ id: alice.id, username: 'alice' })]);
    });

    it('returns an empty array when nobody has played yet (owner is not a member)', async () => {
      await createTournament(app.db, { name: 'cup', ownerUserId: owner.id });
      const res = await app.inject({ method: 'GET', url: '/tournaments/cup/users', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns 404 for an unknown tournament', async () => {
      const res = await app.inject({ method: 'GET', url: '/tournaments/nope/users', headers });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('TOURNAMENT_NOT_FOUND');
    });
  });

  describe('VAL-USERS-006: GET /users/:username/tournaments', () => {
    it('findByUserName_found: returns exactly the tournaments where the user has stats', async () => {
      const player = await createUser(app.db, { username: 'player' });
      const sport = await createSport(app.db, { name: 'babyfoot' });
      const [t1, t2, t3] = await Promise.all(
        ['t1', 't2', 't3'].map((name) =>
          createTournament(app.db, { name, sportId: sport.id, ownerUserId: player.id }),
        ),
      );
      // Owned but never played: not part of the list.
      await createTournament(app.db, { name: 'owned', sportId: sport.id, ownerUserId: player.id });
      for (const t of [t1, t2, t3]) {
        await createStatsRow(app.db, { userId: player.id, tournamentId: t!.id });
      }

      const res = await app.inject({ method: 'GET', url: '/users/player/tournaments', headers });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(3);
      expect(body.map((t: { id: string }) => t.id).sort()).toEqual([t1!.id, t2!.id, t3!.id].sort());
      for (const t of body) {
        expect(t.sport).toEqual({ id: sport.id, name: 'babyfoot' });
        expect(t.owner.id).toBe(player.id);
      }
    });

    it('returns an empty array for a user without stats', async () => {
      await createUser(app.db, { username: 'newbie' });
      const res = await app.inject({ method: 'GET', url: '/users/newbie/tournaments', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('findByUserName_notFound: unknown username → 404', async () => {
      const res = await app.inject({ method: 'GET', url: '/users/ghost/tournaments', headers });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('USER_NOT_FOUND');
    });
  });
});
