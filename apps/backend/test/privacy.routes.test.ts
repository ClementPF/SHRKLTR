import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authHeadersFor, buildTestApp, createClaim, truncateAll } from './helpers.js';
import { buildPrivacyFixture, call, type GameDto, type PrivacyFixture } from './privacy-fixture.js';

interface TournamentBody {
  name: string;
  group: { id: string; name: string } | null;
}
interface RivalryBody {
  user: { username: string };
  rival: { username: string };
  tournament: TournamentBody;
}
interface StatsBody {
  user: { username: string };
  tournament: TournamentBody;
  bestRivalry: RivalryBody | null;
  worstRivalry: RivalryBody | null;
}

const OUTSIDERS = [
  ['never-member', 'pat'],
  ['former member', 'fran'],
] as const;
const MEMBERS = [
  ['owner', 'alex'],
  ['member', 'jordan'],
] as const;
const EVERYONE = [...MEMBERS, ...OUTSIDERS];

type ViewerName = 'alex' | 'jordan' | 'pat' | 'fran';

describe('grouped tournament visibility on read routes', () => {
  let app: FastifyInstance;
  let f: PrivacyFixture;

  beforeAll(async () => {
    app = await buildTestApp();
    await truncateAll(app.db);
    f = await buildPrivacyFixture(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (viewer: ViewerName, url: string) => call(app, f[viewer], 'GET', url);
  const ok = async <T>(viewer: ViewerName, url: string): Promise<T> => {
    const res = await get(viewer, url);
    expect(res.statusCode, `${viewer} GET ${url}: ${res.body}`).toBe(200);
    return res.json<T>();
  };
  const expectNotFound = async (viewer: ViewerName, url: string, code: string) => {
    const res = await get(viewer, url);
    expect(res.statusCode, `${viewer} GET ${url}: ${res.body}`).toBe(404);
    expect(res.json()).toEqual({ error: { code, message: expect.any(String) } });
  };
  const gameIds = (t?: 'privcup' | 'opencup') =>
    f.games.filter((g) => t === undefined || g.tournament === t).map((g) => g.id);
  const newestFirst = <T>(items: T[]) => [...items].reverse();
  /** Ids of fran's games (games 1 to 7) in a tournament, newest first. */
  const franGames = (t?: 'privcup' | 'opencup') =>
    newestFirst(f.games.slice(0, 7).filter((g) => t === undefined || g.tournament === t)).map(
      (g) => g.id,
    );
  const rivalryTournaments = (r: RivalryBody | null) => (r ? [r.tournament.name] : []);
  const statsTournaments = (rows: StatsBody[]) =>
    rows.flatMap((s) => [
      s.tournament.name,
      ...rivalryTournaments(s.bestRivalry),
      ...rivalryTournaments(s.worstRivalry),
    ]);

  describe('VAL-PRIV-001: tournament detail and standings', () => {
    const urls = [
      '/tournaments/privcup',
      '/tournaments/privcup/users',
      '/tournaments/privcup/stats',
    ];

    it.each(OUTSIDERS)('%s (%s) gets 404 on detail, users and stats', async (_, viewer) => {
      for (const url of urls) await expectNotFound(viewer, url, 'TOURNAMENT_NOT_FOUND');
    });

    it('the former member is also the creator and keeps stats, which grants nothing', async () => {
      expect(f.privcup.ownerUserId).toBe(f.fran.id);
      const leaderboard = await ok<StatsBody[]>('alex', '/tournaments/privcup/stats');
      expect(leaderboard.map((s) => s.user.username)).toContain('fran');
      await expectNotFound('fran', '/tournaments/privcup/stats', 'TOURNAMENT_NOT_FOUND');
    });

    it.each(MEMBERS)('%s (%s) reads the scoped tournament and standings', async (_, viewer) => {
      const detail = await ok<TournamentBody>(viewer, '/tournaments/privcup');
      expect(detail.group).toEqual({ id: f.group.id, name: 'Secret Society' });
      const users = await ok<{ username: string }[]>(viewer, '/tournaments/privcup/users');
      expect(users.map((u) => u.username)).toEqual([
        'alex',
        'fran',
        'guest',
        'hidden-guest',
        'jordan',
      ]);
      const stats = await ok<StatsBody[]>(viewer, '/tournaments/privcup/stats');
      expect(stats).toHaveLength(5);
      expect(new Set(statsTournaments(stats))).toEqual(new Set(['privcup']));
      expect(stats.some((s) => s.bestRivalry !== null)).toBe(true);
    });
  });

  describe('VAL-PRIV-002: tournament games and durable game detail', () => {
    it.each(OUTSIDERS)('%s (%s) gets 404 for the games list and every game', async (_, viewer) => {
      await expectNotFound(viewer, '/tournaments/privcup/games', 'TOURNAMENT_NOT_FOUND');
      for (const id of gameIds('privcup')) {
        await expectNotFound(viewer, `/games/${id}`, 'GAME_NOT_FOUND');
      }
    });

    it('having played the game does not help a former member', async () => {
      await expectNotFound('fran', `/games/${f.franFirstWinGameId}`, 'GAME_NOT_FOUND');
    });

    it.each(MEMBERS)('%s (%s) lists and opens every private game', async (_, viewer) => {
      const list = await ok<GameDto[]>(viewer, '/tournaments/privcup/games?pageSize=100');
      expect(list.map((g) => g.id)).toEqual(newestFirst(gameIds('privcup')));
      for (const id of gameIds('privcup')) {
        const game = await ok<GameDto>(viewer, `/games/${id}`);
        expect(game.tournament.group?.id).toBe(f.group.id);
      }
    });
  });

  describe('VAL-PRIV-003: rivalry route variants', () => {
    const filtered = [
      '/tournaments/privcup/rivalries',
      '/tournaments/privcup/rivalries?userName=fran',
      '/rivalries?userName=fran&tournamentName=privcup',
      '/rivalry?userName=fran&rivalName=alex&tournamentName=privcup',
      '/users/fran/rivalries?tournamentName=privcup',
    ];

    it.each(OUTSIDERS)('%s (%s) gets 404 on every filtered variant', async (_, viewer) => {
      for (const url of filtered) await expectNotFound(viewer, url, 'TOURNAMENT_NOT_FOUND');
    });

    it.each(OUTSIDERS)('%s (%s) sees only open rows unfiltered', async (_, viewer) => {
      for (const username of ['fran', 'alex', 'jordan', 'guest']) {
        const rows = await ok<RivalryBody[]>(viewer, `/users/${username}/rivalries`);
        expect(new Set(rows.map((r) => r.tournament.name)), username).toEqual(
          new Set(username === 'jordan' ? [] : ['opencup']),
        );
      }
    });

    it.each(MEMBERS)('%s (%s) keeps private rivalries', async (_, viewer) => {
      const rows = await ok<RivalryBody[]>(viewer, '/users/fran/rivalries');
      expect(new Set(rows.map((r) => r.tournament.name))).toEqual(new Set(['opencup', 'privcup']));
      for (const url of filtered) await ok(viewer, url);
    });
  });

  describe('VAL-PRIV-004: profile tournament and stats collections', () => {
    it.each(OUTSIDERS)('%s (%s) sees open tournaments and stats only', async (_, viewer) => {
      const tournaments = await ok<TournamentBody[]>(viewer, '/users/fran/tournaments');
      expect(tournaments.map((t) => t.name)).toEqual(['opencup']);
      const stats = await ok<StatsBody[]>(viewer, '/users/fran/stats');
      expect(stats.map((s) => s.tournament.name)).toEqual(['opencup']);
      expect(new Set(statsTournaments(stats))).toEqual(new Set(['opencup']));
      expect(await ok(viewer, '/users/jordan/tournaments')).toEqual([]);
      expect(await ok(viewer, '/users/jordan/stats')).toEqual([]);
      await expectNotFound(
        viewer,
        '/stats?userName=fran&tournamentName=privcup',
        'TOURNAMENT_NOT_FOUND',
      );
    });

    it.each(MEMBERS)('%s (%s) sees the private tournament and stats', async (_, viewer) => {
      const tournaments = await ok<TournamentBody[]>(viewer, '/users/fran/tournaments');
      expect(tournaments.map((t) => t.name)).toEqual(['opencup', 'privcup']);
      const stats = await ok<StatsBody[]>(viewer, '/users/fran/stats');
      expect(stats.map((s) => s.tournament.name)).toEqual(['opencup', 'privcup']);
      const direct = await ok<StatsBody>(viewer, '/stats?userName=fran&tournamentName=privcup');
      expect(statsTournaments([direct]).every((name) => name === 'privcup')).toBe(true);
    });
  });

  describe('VAL-PRIV-005: personal feed and history', () => {
    it.each(OUTSIDERS)('%s (%s) gets open games only, 404 when filtered', async (_, viewer) => {
      const games = await ok<GameDto[]>(viewer, '/users/fran/games?pageSize=100');
      expect(games.map((g) => g.id)).toEqual(franGames('opencup'));
      await expectNotFound(
        viewer,
        '/users/fran/games?tournamentName=privcup',
        'TOURNAMENT_NOT_FOUND',
      );
    });

    it.each(MEMBERS)('%s (%s) gets the whole history', async (_, viewer) => {
      const games = await ok<GameDto[]>(viewer, '/users/fran/games?pageSize=100');
      expect(games.map((g) => g.id)).toEqual(franGames());
      const filtered = await ok<GameDto[]>(viewer, '/users/fran/games?tournamentName=privcup');
      expect(filtered.map((g) => g.id)).toEqual(franGames('privcup'));
    });
  });

  describe('VAL-PRIV-006: tournament discovery', () => {
    it('members see the private tournament first (most played)', async () => {
      const list = await ok<TournamentBody[]>('jordan', '/tournaments');
      expect(list.map((t) => t.name)).toEqual(['privcup', 'opencup', 'quietcup']);
      expect(list[0]?.group).toEqual({ id: f.group.id, name: 'Secret Society' });
    });

    it.each(OUTSIDERS)('%s (%s) sees open tournaments in unchanged order', async (_, viewer) => {
      const member = await ok<TournamentBody[]>('alex', '/tournaments');
      const list = await ok<TournamentBody[]>(viewer, '/tournaments');
      expect(list).toEqual(member.filter((t) => t.group === null));
      expect(list.map((t) => t.name)).toEqual(['opencup', 'quietcup']);
      expect(await ok(viewer, '/tournaments?sport=privsport')).toEqual([]);
      expect(
        (await ok<TournamentBody[]>(viewer, '/tournaments?sport=opensport')).map((t) => t.name),
      ).toEqual(['opencup', 'quietcup']);
    });
  });

  describe('VAL-PRIV-008: identity and sport catalog', () => {
    const USER_KEYS = [
      'accountType',
      'firstName',
      'id',
      'lastName',
      'locale',
      'pictureUrl',
      'username',
    ];

    it.each(OUTSIDERS)('%s (%s) cannot discover the private-only placeholder', async (_, v) => {
      const users = await ok<{ username: string }[]>(v, '/users');
      const names = users.map((u) => u.username);
      expect(names).not.toContain('hidden-guest');
      expect(names).toEqual(
        expect.arrayContaining(['alex', 'fran', 'guest', 'jordan', 'loose-guest', 'pat']),
      );
      for (const url of [
        '/users/hidden-guest',
        '/users/hidden-guest/games',
        '/users/hidden-guest/stats',
        '/users/hidden-guest/achievements',
      ]) {
        await expectNotFound(v, url, 'USER_NOT_FOUND');
      }
    });

    it('the creator and current members of its group can discover it', async () => {
      for (const viewer of ['jordan', 'alex'] as const) {
        const users = await ok<{ username: string }[]>(viewer, '/users');
        expect(users.map((u) => u.username)).toContain('hidden-guest');
        await ok(viewer, '/users/hidden-guest');
      }
    });

    it('a placeholder created outside groups stays discoverable', async () => {
      await ok('pat', '/users/loose-guest');
      await ok('pat', '/users/guest');
    });

    it.each(EVERYONE)('%s (%s) only receives safe identity fields', async (_, viewer) => {
      for (const user of await ok<Record<string, unknown>[]>(viewer, '/users')) {
        expect(Object.keys(user).sort()).toEqual(USER_KEYS);
      }
      expect(Object.keys(await ok<object>(viewer, '/users/me')).sort()).toEqual(USER_KEYS);
      expect(Object.keys(await ok<object>(viewer, '/users/fran')).sort()).toEqual(USER_KEYS);
      const updated = await call(app, f[viewer], 'PUT', '/users/me', { locale: 'en' });
      expect(updated.statusCode).toBe(200);
      expect(Object.keys(updated.json<object>()).sort()).toEqual(USER_KEYS);
      const sports = await ok<Record<string, unknown>[]>(viewer, '/sports');
      expect(sports.map((s) => s.name)).toEqual(['opensport', 'privsport']);
      for (const sport of sports) expect(Object.keys(sport).sort()).toEqual(['id', 'name']);
    });
  });

  describe('VAL-PRIV-012: claim preview and roster grant no private access', () => {
    it('the public claim preview shows open history only', async () => {
      const { token } = await createClaim(app.db, {
        placeholderUserId: f.guest.id,
        creatorUserId: f.alex.id,
      });
      const res = await app.inject({ method: 'GET', url: `/invites/claim/${token}` });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        gamesCount: number;
        recentGames: GameDto[];
        stats: StatsBody[];
      }>();
      const guestOpenGame = f.games[7]!;
      expect(guestOpenGame.tournament).toBe('opencup');
      expect(body.gamesCount).toBe(1);
      expect(body.recentGames.map((g) => g.id)).toEqual([guestOpenGame.id]);
      expect(new Set(statsTournaments(body.stats))).toEqual(new Set(['opencup']));
      for (const secret of ['privcup', 'Priv Cup', 'Secret Society', f.group.id]) {
        expect(res.body).not.toContain(secret);
      }
    });

    it('a rostered placeholder identity cannot read the group or its tournament', async () => {
      const headers = await authHeadersFor(app, f.guest.id);
      for (const url of [
        '/tournaments/privcup',
        '/tournaments/privcup/stats',
        `/groups/${f.group.id}`,
        `/games/${f.games[6]!.id}`,
      ]) {
        const res = await app.inject({ method: 'GET', url, headers });
        expect(res.statusCode, url).toBe(404);
      }
      const list = await app.inject({ method: 'GET', url: '/tournaments', headers });
      expect(list.json<TournamentBody[]>().map((t) => t.name)).not.toContain('privcup');
    });
  });

  describe('VAL-PRIV-014: ungrouped data stays visible to everyone', () => {
    it.each(EVERYONE)('%s (%s) reads every open route', async (_, viewer) => {
      expect((await ok<TournamentBody[]>(viewer, '/tournaments')).map((t) => t.name)).toContain(
        'opencup',
      );
      expect((await ok<TournamentBody>(viewer, '/tournaments/opencup')).group).toBeNull();
      expect(await ok<unknown[]>(viewer, '/tournaments/opencup/users')).toHaveLength(4);
      expect(await ok<unknown[]>(viewer, '/tournaments/opencup/stats')).toHaveLength(4);
      expect(
        (await ok<unknown[]>(viewer, '/tournaments/opencup/rivalries')).length,
      ).toBeGreaterThan(0);
      const games = await ok<GameDto[]>(viewer, '/tournaments/opencup/games?pageSize=100');
      expect(games.map((g) => g.id)).toEqual(newestFirst(gameIds('opencup')));
      for (const id of gameIds('opencup')) await ok(viewer, `/games/${id}`);
      expect(
        (await ok<TournamentBody[]>(viewer, '/users/fran/tournaments')).map((t) => t.name),
      ).toContain('opencup');
      expect(
        (await ok<StatsBody[]>(viewer, '/users/fran/stats')).map((s) => s.tournament.name),
      ).toContain('opencup');
      expect(
        (await ok<RivalryBody[]>(viewer, '/users/fran/rivalries')).map((r) => r.tournament.name),
      ).toContain('opencup');
      const history = await ok<GameDto[]>(viewer, '/users/fran/games?pageSize=100');
      expect(history.map((g) => g.id)).toEqual(expect.arrayContaining(franGames('opencup')));
      await ok(viewer, '/users/fran/games?tournamentName=opencup');
      await ok(viewer, '/users/fran/rivalries?tournamentName=opencup');
      await ok(viewer, '/stats?userName=fran&tournamentName=opencup');
      expect(
        await ok<unknown[]>(viewer, '/rivalries?userName=fran&tournamentName=opencup'),
      ).toHaveLength(1);
      await ok(viewer, '/rivalry?userName=fran&rivalName=pat&tournamentName=opencup');
    });

    it('open responses are identical for members and outsiders', async () => {
      for (const url of [
        '/tournaments/opencup/stats',
        '/tournaments/opencup/games',
        '/rivalries?userName=pat&tournamentName=opencup',
      ]) {
        const member = await ok('alex', url);
        expect(await ok('pat', url), url).toEqual(member);
        expect(await ok('fran', url), url).toEqual(member);
      }
    });

    it('outsiders, the former-member creator included, cannot manage the private tournament', async () => {
      for (const viewer of ['pat', 'fran'] as const) {
        const update = await call(app, f[viewer], 'PUT', '/tournaments/privcup', { isOver: true });
        expect(update.statusCode).toBe(404);
        expect(update.json().error.code).toBe('TOURNAMENT_NOT_FOUND');
        const removal = await call(app, f[viewer], 'DELETE', '/tournaments/privcup');
        expect(removal.statusCode).toBe(404);
        const game = await call(app, f[viewer], 'POST', '/tournaments/privcup/games', {
          outcomes: [
            { username: 'alex', result: 'WIN' },
            { username: viewer, result: 'LOSS' },
          ],
        });
        expect(game.statusCode).toBe(404);
      }
      const detail = await ok<TournamentBody & { isOver: boolean }>('alex', '/tournaments/privcup');
      expect(detail.isOver).toBe(false);
    });

    it('protected routes still require authentication', async () => {
      for (const url of ['/tournaments', '/tournaments/opencup', '/users/fran/games']) {
        expect((await call(app, null, 'GET', url)).statusCode).toBe(401);
      }
    });
  });
});
