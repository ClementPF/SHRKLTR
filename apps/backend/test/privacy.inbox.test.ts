import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  groupInvites,
  groupMembers,
  groupPlayers,
  groups,
  notifications,
  userAchievements,
} from '../src/db/schema.js';
import {
  buildTestApp,
  createNotification,
  createPushDevice,
  expoTokenOf,
  groupRolesOf,
  truncateAll,
} from './helpers.js';
import { buildPrivacyFixture, call, type GameDto, type PrivacyFixture } from './privacy-fixture.js';
import { startPushCollector, type PushCollector } from './push-collector.js';

const OUTSIDERS = [
  ['never-member', 'pat'],
  ['former member', 'fran'],
] as const;
const MEMBERS = [
  ['owner', 'alex'],
  ['member', 'jordan'],
] as const;

type ViewerName = 'alex' | 'jordan' | 'pat' | 'fran';

interface NotificationBody {
  id: string;
  type: string;
  title: string;
  body: string;
  target: { type: string; gameId?: string; groupId?: string } | null;
}

interface UserAchievementBody {
  code: string;
  unlocked: boolean;
  source: { type: string; gameId: string | null; groupId: string | null } | null;
}

describe('grouped data in groups, pagination, inbox and badges', () => {
  let collector: PushCollector;
  let app: FastifyInstance;
  let f: PrivacyFixture;

  beforeAll(async () => {
    collector = await startPushCollector();
    app = await buildTestApp({ env: { PUSH_URL: collector.url } });
    await truncateAll(app.db);
    f = await buildPrivacyFixture(app);
  });

  afterAll(async () => {
    await app.close();
    await collector.close();
  });

  const as = (viewer: ViewerName, method: string, url: string, payload?: unknown) =>
    call(app, f[viewer], method, url, payload);
  const ok = async <T>(viewer: ViewerName, url: string): Promise<T> => {
    const res = await as(viewer, 'GET', url);
    expect(res.statusCode, `${viewer} GET ${url}: ${res.body}`).toBe(200);
    return res.json<T>();
  };
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  const privateGameIds = () => f.games.filter((g) => g.tournament === 'privcup').map((g) => g.id);
  const openGameIds = () => f.games.filter((g) => g.tournament === 'opencup').map((g) => g.id);

  /** Fetches every page of a paginated route with the given page size. */
  const allPages = async <T>(viewer: ViewerName, url: string, pageSize: number) => {
    const pages: T[][] = [];
    for (let page = 0; ; page++) {
      const sep = url.includes('?') ? '&' : '?';
      const rows = await ok<T[]>(viewer, `${url}${sep}page=${page}&pageSize=${pageSize}`);
      pages.push(rows);
      if (rows.length < pageSize) return pages;
    }
  };

  describe('VAL-PRIV-007: group resources hide the group from outsiders', () => {
    it.each(OUTSIDERS)('%s (%s) cannot read or change the group', async (_, viewer) => {
      const issued = await as('alex', 'POST', `/groups/${f.group.id}/invites`, {});
      expect(issued.statusCode).toBe(201);
      const invite = issued.json<{ id: string; url: string }>();
      const rolesBefore = await groupRolesOf(app.db, f.group.id);

      expect(await ok(viewer, '/groups')).toEqual([]);
      const gid = f.group.id;
      const attempts: [string, string, unknown?][] = [
        ['GET', `/groups/${gid}`],
        ['GET', `/groups/${gid}/members`],
        ['GET', `/groups/${gid}/tournaments`],
        ['GET', `/groups/${gid}/players`],
        ['GET', `/groups/${gid}/invites`],
        ['PUT', `/groups/${gid}`, { name: 'Hacked' }],
        ['PUT', `/groups/${gid}/members/${f.jordan.id}`, { role: 'ADMIN' }],
        ['DELETE', `/groups/${gid}/members/${f.jordan.id}`],
        ['POST', `/groups/${gid}/transfer-owner`, { userId: f.jordan.id }],
        ['POST', `/groups/${gid}/leave`, {}],
        ['POST', `/groups/${gid}/invites`, {}],
        ['DELETE', `/groups/${gid}/invites/${invite.id}`],
        ['POST', `/groups/${gid}/players`, { placeholderUserId: f.loose.id }],
      ];
      for (const [method, url, payload] of attempts) {
        const res = await as(viewer, method, url, payload);
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(res.json()).toEqual({
          error: { code: 'GROUP_NOT_FOUND', message: expect.any(String) },
        });
        expect(res.body).not.toContain('Secret Society');
      }

      const [group] = await app.db.select().from(groups).where(eq(groups.id, gid));
      expect(group?.name).toBe('Secret Society');
      expect(await groupRolesOf(app.db, gid)).toEqual(rolesBefore);
      const [stored] = await app.db
        .select()
        .from(groupInvites)
        .where(eq(groupInvites.id, invite.id));
      expect(stored?.revokedAt).toBeNull();
      const invites = await app.db.select().from(groupInvites).where(eq(groupInvites.groupId, gid));
      expect(invites.filter((i) => i.revokedAt === null)).toHaveLength(1);
      const roster = await app.db.select().from(groupPlayers).where(eq(groupPlayers.groupId, gid));
      expect(roster.map((r) => r.placeholderUserId).sort()).toEqual(
        [f.guest.id, f.hidden.id].sort(),
      );

      const preview = await app.inject({
        method: 'GET',
        url: `/invites/group/${invite.url.split('/join/')[1]}`,
      });
      expect(preview.statusCode).toBe(200);
      expect(Object.keys(preview.json<object>()).sort()).toEqual(['expiresAt', 'groupName']);

      await as('alex', 'DELETE', `/groups/${gid}/invites/${invite.id}`);
    });

    it.each(MEMBERS)('%s (%s) still reads the group', async (_, viewer) => {
      expect(ids(await ok<{ id: string }[]>(viewer, '/groups'))).toEqual([f.group.id]);
      const tournaments = await ok<{ name: string }[]>(viewer, `/groups/${f.group.id}/tournaments`);
      expect(tournaments.map((t) => t.name)).toEqual(['privcup']);
    });
  });

  describe('VAL-PRIV-009: filtering precedes pagination, ordering and counts', () => {
    const franGames = (onlyOpen: boolean) =>
      f.games
        .slice(0, 7)
        .filter((g) => !onlyOpen || g.tournament === 'opencup')
        .map((g) => g.id)
        .reverse();

    it.each(OUTSIDERS)('%s (%s) pages /users/:username/games without holes', async (_, v) => {
      const pages = await allPages<GameDto>(v, '/users/fran/games', 2);
      expect(pages.map((p) => p.length)).toEqual([2, 1]);
      expect(pages.flat().map((g) => g.id)).toEqual(franGames(true));
    });

    it('a member pages the full history', async () => {
      const pages = await allPages<GameDto>('jordan', '/users/fran/games', 2);
      expect(pages.map((p) => p.length)).toEqual([2, 2, 2, 1]);
      expect(pages.flat().map((g) => g.id)).toEqual(franGames(false));
    });

    it('a member pages the private tournament games; outsiders get 404 on every page', async () => {
      const pages = await allPages<GameDto>('alex', '/tournaments/privcup/games', 4);
      expect(pages.map((p) => p.length)).toEqual([4, 2]);
      expect(pages.flat().map((g) => g.id)).toEqual([...privateGameIds()].reverse());
      for (const [, v] of OUTSIDERS) {
        for (const page of [0, 1]) {
          const res = await as(v, 'GET', `/tournaments/privcup/games?page=${page}&pageSize=4`);
          expect(res.statusCode).toBe(404);
        }
      }
    });

    it('open tournament games pages are identical for everyone', async () => {
      const member = await allPages<GameDto>('alex', '/tournaments/opencup/games', 2);
      expect(member.flat().map((g) => g.id)).toEqual([...openGameIds()].reverse());
      for (const [, v] of OUTSIDERS) {
        expect(await allPages<GameDto>(v, '/tournaments/opencup/games', 2)).toEqual(member);
      }
    });

    it('group member pages are for members only', async () => {
      const pages = await allPages<{ user: { username: string } }>(
        'jordan',
        `/groups/${f.group.id}/members`,
        1,
      );
      expect(pages.flat().map((m) => m.user.username)).toEqual(['alex', 'jordan']);
      for (const [, v] of OUTSIDERS) {
        const res = await as(v, 'GET', `/groups/${f.group.id}/members?page=0&pageSize=1`);
        expect(res.statusCode).toBe(404);
      }
    });

    it.each(OUTSIDERS)('%s (%s) gets ordered visible-only lists', async (_, v) => {
      const memberRivalries = await ok<{ id: string; tournament: { name: string } }[]>(
        'alex',
        '/users/fran/rivalries',
      );
      const rivalries = await ok<{ id: string }[]>(v, '/users/fran/rivalries');
      expect(ids(rivalries)).toEqual(
        ids(memberRivalries.filter((r) => r.tournament.name === 'opencup')),
      );
      const memberTournaments = await ok<{ name: string; group: unknown }[]>(
        'alex',
        '/tournaments',
      );
      const tournaments = await ok<{ name: string }[]>(v, '/tournaments');
      expect(tournaments.map((t) => t.name)).toEqual(
        memberTournaments.filter((t) => t.group === null).map((t) => t.name),
      );
      expect(
        (await ok<{ username: string }[]>(v, '/tournaments/opencup/users')).map((u) => u.username),
      ).toEqual(['alex', 'fran', 'guest', 'pat']);
    });

    it('the former member pages the inbox and counts unread without private rows', async () => {
      const expected = await app.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, f.fran.id),
            isNull(notifications.groupId),
            or(isNull(notifications.gameId), inArray(notifications.gameId, openGameIds())),
          ),
        )
        .orderBy(desc(notifications.createdAt), desc(notifications.id));
      const total = await app.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.recipientUserId, f.fran.id));
      expect(total.length).toBeGreaterThan(expected.length);

      const pages = await allPages<NotificationBody>('fran', '/notifications', 3);
      expect(pages.slice(0, -1).every((p) => p.length === 3)).toBe(true);
      expect(ids(pages.flat())).toEqual(ids(expected));
      expect(await ok('fran', '/notifications/unread-count')).toEqual({ count: expected.length });
    });
  });

  describe('VAL-PRIV-010: the inbox loses inaccessible private context', () => {
    const privateGameNotification = async (userId: string) => {
      const [row] = await app.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, userId),
            eq(notifications.type, 'game_recorded'),
            eq(notifications.gameId, f.franFirstWinGameId),
          ),
        );
      if (!row) throw new Error('fixture notification missing');
      return row;
    };

    it('removes private game and group notifications for the former member only', async () => {
      const franJoinEvent = await createNotification(app.db, {
        recipientUserId: f.fran.id,
        type: 'group_member_joined',
        category: 'groups',
        groupId: f.group.id,
        subjectUserId: f.pat.id,
      });
      const alexJoinEvent = await createNotification(app.db, {
        recipientUserId: f.alex.id,
        type: 'group_member_joined',
        category: 'groups',
        groupId: f.group.id,
        subjectUserId: f.pat.id,
      });

      const franInbox = await ok<NotificationBody[]>('fran', '/notifications?pageSize=100');
      expect(ids(franInbox)).not.toContain(franJoinEvent.id);
      const franGames = franInbox.flatMap((n) => (n.target?.gameId ? [n.target.gameId] : []));
      expect(franGames.sort()).toEqual(openGameIds().slice(0, 3).sort());
      expect(JSON.stringify(franInbox)).not.toMatch(/Priv Cup|Secret Society/);

      const alexInbox = await ok<NotificationBody[]>('alex', '/notifications?pageSize=100');
      const alexJoin = alexInbox.find((n) => n.id === alexJoinEvent.id);
      expect(alexJoin?.target).toEqual({ type: 'group', groupId: f.group.id });
      expect(alexJoin?.body).toContain('Secret Society');

      const jordanInbox = await ok<NotificationBody[]>('jordan', '/notifications?pageSize=100');
      const jordanPrivate = jordanInbox.find((n) => n.target?.gameId === f.franFirstWinGameId);
      expect(jordanPrivate?.title).toContain('Priv Cup');
    });

    it('reading a hidden notification answers 404 without marking or describing it', async () => {
      const hidden = await privateGameNotification(f.fran.id);
      const res = await as('fran', 'PUT', `/notifications/${hidden.id}/read`);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        error: { code: 'NOTIFICATION_NOT_FOUND', message: expect.any(String) },
      });
      const [stored] = await app.db
        .select()
        .from(notifications)
        .where(eq(notifications.id, hidden.id));
      expect(stored?.readAt).toBeNull();

      const visible = await privateGameNotification(f.jordan.id);
      const read = await as('jordan', 'PUT', `/notifications/${visible.id}/read`);
      expect(read.statusCode).toBe(200);
      expect(read.json<NotificationBody>().title).toContain('Priv Cup');
    });

    it('push after membership loss suppresses the private context', async () => {
      await createPushDevice(app.db, { userId: f.fran.id, expoToken: expoTokenOf('fran-phone') });
      await createPushDevice(app.db, {
        userId: f.jordan.id,
        expoToken: expoTokenOf('jordan-phone'),
      });
      const franGroupEvent = await createNotification(app.db, {
        recipientUserId: f.fran.id,
        type: 'group_member_joined',
        category: 'groups',
        groupId: f.group.id,
        subjectUserId: f.pat.id,
      });
      collector.reset();
      app.push.dispatch([
        (await privateGameNotification(f.fran.id)).id,
        franGroupEvent.id,
        (await privateGameNotification(f.jordan.id)).id,
      ]);
      await app.push.drain();
      const messages = collector.messages();
      expect(messages.map((m) => m.to)).toEqual([expoTokenOf('jordan-phone')]);
      expect(messages[0]?.title).toContain('Priv Cup');
      expect(JSON.stringify(collector.received)).not.toContain('fran-phone');
    });
  });

  describe('VAL-PRIV-011: badges stay visible without private source links', () => {
    beforeAll(async () => {
      await app.db
        .insert(userAchievements)
        .values({
          userId: f.fran.id,
          achievementCode: 'first_group_joined',
          sourceType: 'GROUP',
          sourceGroupId: f.group.id,
        })
        .onConflictDoNothing();
    });

    const badge = (rows: UserAchievementBody[], code: string) => rows.find((r) => r.code === code);

    it.each(OUTSIDERS)('%s (%s) sees the badges with sources redacted', async (_, viewer) => {
      const res = await as(viewer, 'GET', '/users/fran/achievements');
      expect(res.statusCode).toBe(200);
      const rows = res.json<UserAchievementBody[]>();
      expect(badge(rows, 'first_win')).toMatchObject({
        unlocked: true,
        source: { type: 'GAME', gameId: null, groupId: null },
      });
      expect(badge(rows, 'first_group_joined')).toMatchObject({
        unlocked: true,
        source: { type: 'GROUP', gameId: null, groupId: null },
      });
      for (const id of [...privateGameIds(), f.group.id]) expect(res.body).not.toContain(id);
    });

    it('the former member feed keeps the unlock without its source', async () => {
      const res = await as('fran', 'GET', '/achievements/recent?pageSize=100');
      const rows =
        res.json<{ achievement: { code: string }; source: UserAchievementBody['source'] }[]>();
      const firstWin = rows.find((r) => r.achievement.code === 'first_win');
      expect(firstWin?.source).toEqual({
        type: 'GAME',
        gameId: null,
        groupId: null,
        challengeId: null,
      });
      for (const id of [...privateGameIds(), f.group.id]) expect(res.body).not.toContain(id);
    });

    it.each(MEMBERS)('%s (%s) keeps the source navigation', async (_, viewer) => {
      const rows = await ok<UserAchievementBody[]>(viewer, '/users/fran/achievements');
      expect(badge(rows, 'first_win')?.source).toEqual({
        type: 'GAME',
        gameId: f.franFirstWinGameId,
        groupId: null,
        challengeId: null,
      });
      expect(badge(rows, 'first_group_joined')?.source).toEqual({
        type: 'GROUP',
        gameId: null,
        groupId: f.group.id,
        challengeId: null,
      });
    });
  });

  it('fixture sanity: fran is no longer a member', async () => {
    const rows = await app.db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, f.group.id))
      .orderBy(asc(groupMembers.userId));
    expect(rows.map((r) => r.userId)).not.toContain(f.fran.id);
  });
});
