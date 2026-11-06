import type { FastifyInstance } from 'fastify';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  games,
  groupInvites,
  groupMembers,
  groupPlayers,
  notifications,
  outcomes,
  stats,
  tournaments,
  userAchievements,
} from '../src/db/schema.js';
import { generateCapabilityToken, hashCapabilityToken } from '../src/lib/capability-token.js';
import {
  createGroupInvite,
  INVITE_CODE_ALPHABET,
  normalizeInviteCode,
} from '../src/services/group-invite.service.js';
import {
  achievementCodesOf,
  addGroupMember,
  authHeadersFor,
  buildTestApp,
  createGroup,
  createLogCapture,
  createPlaceholderUser,
  createSport,
  createTournament,
  createUser,
  groupRolesOf,
  rosterPlayer,
  truncateAll,
} from './helpers.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;
type GroupRow = Awaited<ReturnType<typeof createGroup>>;
type Payload = Record<string, unknown> | null | undefined;

const DAY_MS = 24 * 60 * 60 * 1000;
const PUBLIC_WEB_URL = 'http://localhost:8083';
const CODE_PATTERN = new RegExp(`^[${INVITE_CODE_ALPHABET}]{10}$`);

describe('groups', () => {
  let app: FastifyInstance;
  let now: Date;
  const capture = createLogCapture();

  let alex: UserRow; // OWNER
  let sam: UserRow; // ADMIN
  let jordan: UserRow; // MEMBER
  let pat: UserRow; // never a member
  let group: GroupRow;

  beforeAll(async () => {
    app = await buildTestApp({ clock: () => now, logger: capture });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    now = new Date('2026-11-05T12:00:00.000Z');
    capture.lines.length = 0;
    await truncateAll(app.db);
    alex = await createUser(app.db, { username: 'alex' });
    sam = await createUser(app.db, { username: 'sam' });
    jordan = await createUser(app.db, { username: 'jordan' });
    pat = await createUser(app.db, { username: 'pat' });
    group = await createGroup(app.db, {
      ownerId: alex.id,
      name: 'Shark Tank',
      members: { [sam.id]: 'ADMIN', [jordan.id]: 'MEMBER' },
    });
  });

  afterEach(async () => {
    await app.push.drain();
  });

  const call = async (user: UserRow | null, method: string, url: string, payload?: Payload) =>
    app.inject({
      method: method as 'GET',
      url,
      headers: user ? await authHeadersFor(app, user.id) : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  const issueInvite = async (user: UserRow, payload: Payload = {}) => {
    const res = await call(user, 'POST', `/groups/${group.id}/invites`, payload);
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json<{ id: string; url: string; code: string; expiresAt: string | null }>();
    return { ...body, token: body.url.split('/join/')[1] ?? '' };
  };

  const join = (user: UserRow, credential: { token: string } | { code: string }) =>
    call(user, 'POST', '/groups/join', credential);

  const membership = async (groupId: string, userId: string) =>
    (
      await app.db
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    )[0];

  const joinEventsFor = async (userId: string) =>
    app.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, userId),
          eq(notifications.type, 'group_member_joined'),
        ),
      );

  const groupBadgeRows = async (userId: string) =>
    app.db
      .select()
      .from(userAchievements)
      .where(
        and(
          eq(userAchievements.userId, userId),
          eq(userAchievements.achievementCode, 'first_group_joined'),
        ),
      );

  describe('creation and reading (VAL-GROUP-001..004)', () => {
    it('creates a trimmed group with the creator as sole OWNER', async () => {
      const res = await call(pat, 'POST', '/groups', { name: '  Lunch League  ' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({
        id: expect.any(String),
        name: 'Lunch League',
        role: 'OWNER',
        memberCount: 1,
        createdAt: now.toISOString(),
      });
      expect(await groupRolesOf(app.db, res.json().id)).toEqual({ [pat.id]: 'OWNER' });
    });

    it('validates names: blank and 101 characters fail, 100 and duplicates succeed', async () => {
      for (const name of ['', '   ', 'x'.repeat(101)]) {
        const res = await call(pat, 'POST', '/groups', { name });
        expect(res.statusCode, JSON.stringify(name)).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_ERROR');
      }
      expect((await call(pat, 'POST', '/groups', { name: 'y'.repeat(100) })).statusCode).toBe(201);
      expect((await call(pat, 'POST', '/groups', { name: 'Shark Tank' })).statusCode).toBe(201);
      const mine = await call(pat, 'GET', '/groups');
      expect(mine.json().map((g: { name: string }) => g.name)).toEqual([
        'Shark Tank',
        'y'.repeat(100),
      ]);
    });

    it('awards first_group_joined once, sourced to the group for members only', async () => {
      const first = await call(pat, 'POST', '/groups', { name: 'One' });
      await call(pat, 'POST', '/groups', { name: 'Two' });
      expect(await groupBadgeRows(pat.id)).toHaveLength(1);
      expect((await groupBadgeRows(pat.id))[0]?.sourceGroupId).toBe(first.json().id);
      const unlockEvents = await app.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, pat.id),
            eq(notifications.type, 'achievement_unlocked'),
          ),
        );
      expect(unlockEvents).toHaveLength(1);

      const badge = async (viewer: UserRow) =>
        (await call(viewer, 'GET', '/users/pat/achievements'))
          .json<{ code: string; unlocked: boolean; source: unknown }[]>()
          .find((a) => a.code === 'first_group_joined');
      expect(await badge(pat)).toMatchObject({
        unlocked: true,
        source: { type: 'GROUP', gameId: null, groupId: first.json().id },
      });
      expect(await badge(alex)).toMatchObject({
        unlocked: true,
        source: { type: 'GROUP', gameId: null, groupId: null },
      });
    });

    it('lists only my groups with my role and member counts', async () => {
      await createGroup(app.db, { ownerId: pat.id, name: 'Elsewhere' });
      const res = await call(jordan, 'GET', '/groups');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        {
          id: group.id,
          name: 'Shark Tank',
          role: 'MEMBER',
          memberCount: 3,
          createdAt: group.createdAt.toISOString(),
        },
      ]);
      expect((await call(alex, 'GET', '/groups')).json()[0].role).toBe('OWNER');
    });

    it('hides group details from nonmembers (404) and unknown ids', async () => {
      for (const url of [
        `/groups/${group.id}`,
        `/groups/${group.id}/members`,
        `/groups/${group.id}/tournaments`,
        `/groups/${group.id}/players`,
        '/groups/00000000-0000-4000-8000-000000000000',
      ]) {
        const res = await call(pat, 'GET', url);
        expect(res.statusCode, url).toBe(404);
        expect(res.json().error.code).toBe('GROUP_NOT_FOUND');
      }
      expect((await call(null, 'GET', `/groups/${group.id}`)).statusCode).toBe(401);
    });

    it('lists members owner first, then admins, then members', async () => {
      const res = await call(jordan, 'GET', `/groups/${group.id}/members`);
      expect(res.statusCode).toBe(200);
      expect(
        res
          .json()
          .map((m: { user: { username: string }; role: string }) => [m.user.username, m.role]),
      ).toEqual([
        ['alex', 'OWNER'],
        ['sam', 'ADMIN'],
        ['jordan', 'MEMBER'],
      ]);
      const paged = await call(jordan, 'GET', `/groups/${group.id}/members?pageSize=1&page=1`);
      expect(paged.json().map((m: { role: string }) => m.role)).toEqual(['ADMIN']);
    });

    it('renames for owner/admin only', async () => {
      const renamed = await call(sam, 'PUT', `/groups/${group.id}`, { name: ' Tank ' });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json()).toMatchObject({ name: 'Tank', role: 'ADMIN' });
      const denied = await call(jordan, 'PUT', `/groups/${group.id}`, { name: 'Mine' });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('GROUP_ROLE_REQUIRED');
      expect((await call(pat, 'PUT', `/groups/${group.id}`, { name: 'Mine' })).statusCode).toBe(
        404,
      );
      expect((await call(alex, 'GET', `/groups/${group.id}`)).json().name).toBe('Tank');
    });
  });

  describe('invites (VAL-GROUP-005..008, 027)', () => {
    it('owner and admin issue credentials shown once; metadata never leaks them', async () => {
      const first = await issueInvite(alex);
      const second = await issueInvite(sam);
      for (const issued of [first, second]) {
        expect(issued.url).toMatch(new RegExp(`^${PUBLIC_WEB_URL}/join/[A-Za-z0-9_-]{43}$`));
        expect(Buffer.from(issued.token, 'base64url')).toHaveLength(32);
        expect(issued.code).toMatch(CODE_PATTERN);
        expect(issued.expiresAt).toBe(new Date(now.getTime() + 30 * DAY_MS).toISOString());
      }
      expect(second.token).not.toBe(first.token);
      expect(second.code).not.toBe(first.code);

      const rows = await app.db.select().from(groupInvites);
      expect(rows.map((r) => r.tokenHash).sort()).toEqual(
        [hashCapabilityToken(first.token), hashCapabilityToken(second.token)].sort(),
      );
      expect(rows.map((r) => r.codeHash).sort()).toEqual(
        [hashCapabilityToken(first.code), hashCapabilityToken(second.code)].sort(),
      );
      const stored = JSON.stringify(rows);
      for (const secret of [first.token, first.code, second.token, second.code]) {
        expect(stored).not.toContain(secret);
      }

      const list = await call(sam, 'GET', `/groups/${group.id}/invites`);
      expect(list.statusCode).toBe(200);
      expect(list.json()).toHaveLength(2);
      expect(Object.keys(list.json()[0]).sort()).toEqual(
        ['createdAt', 'createdBy', 'expiresAt', 'id', 'revokedAt', 'status'].sort(),
      );
      expect(list.json()[0]).toMatchObject({ status: 'ACTIVE', revokedAt: null });
      for (const secret of [
        first.token,
        first.code,
        ...rows.flatMap((r) => [r.tokenHash, r.codeHash]),
      ]) {
        expect(list.body).not.toContain(secret);
      }
    });

    it('members get 403 and nonmembers 404 on invite management, with no writes', async () => {
      const issued = await issueInvite(alex);
      const urls: [string, string, Payload][] = [
        ['GET', `/groups/${group.id}/invites`, undefined],
        ['POST', `/groups/${group.id}/invites`, {}],
        ['DELETE', `/groups/${group.id}/invites/${issued.id}`, undefined],
      ];
      for (const [method, url, payload] of urls) {
        const member = await call(jordan, method, url, payload);
        expect(member.statusCode, `${method} ${url}`).toBe(403);
        expect(member.json().error.code).toBe('GROUP_ROLE_REQUIRED');
        const outsider = await call(pat, method, url, payload);
        expect(outsider.statusCode, `${method} ${url}`).toBe(404);
      }
      const rows = await app.db.select().from(groupInvites);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.revokedAt).toBeNull();
    });

    it('a revoked invite fails preview and both redemption paths', async () => {
      const issued = await issueInvite(alex);
      const revoked = await call(sam, 'DELETE', `/groups/${group.id}/invites/${issued.id}`);
      expect(revoked.statusCode).toBe(204);
      expect(
        (await call(sam, 'DELETE', `/groups/${group.id}/invites/${issued.id}`)).statusCode,
      ).toBe(204);
      const missing = await call(
        sam,
        'DELETE',
        `/groups/${group.id}/invites/00000000-0000-4000-8000-000000000000`,
      );
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe('INVITE_NOT_FOUND');

      const preview = await call(null, 'GET', `/invites/group/${issued.token}`);
      expect(preview.statusCode).toBe(404);
      expect(preview.json().error.code).toBe('INVITE_NOT_FOUND');
      for (const credential of [{ token: issued.token }, { code: issued.code }]) {
        const res = await join(pat, credential);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('INVITE_INVALID');
      }
      expect(await membership(group.id, pat.id)).toBeUndefined();
      const list = await call(alex, 'GET', `/groups/${group.id}/invites`);
      expect(list.json()[0]).toMatchObject({ status: 'REVOKED', revokedAt: now.toISOString() });
    });

    it('public preview shows only the group name and expiry', async () => {
      const issued = await issueInvite(alex);
      const res = await call(null, 'GET', `/invites/group/${issued.token}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ groupName: 'Shark Tank', expiresAt: issued.expiresAt });
      expect((await call(null, 'GET', '/invites/group/not-a-token')).statusCode).toBe(404);
      expect(await membership(group.id, pat.id)).toBeUndefined();
    });

    describe('expiry semantics (VAL-GROUP-008)', () => {
      it('defaults to 30 days, null never expires, invalid or past values are rejected', async () => {
        const defaulted = await issueInvite(alex, null);
        expect(defaulted.expiresAt).toBe(new Date(now.getTime() + 30 * DAY_MS).toISOString());
        const forever = await issueInvite(alex, { expiresAt: null });
        expect(forever.expiresAt).toBeNull();
        const explicit = new Date(now.getTime() + DAY_MS).toISOString();
        expect((await issueInvite(alex, { expiresAt: explicit })).expiresAt).toBe(explicit);

        for (const expiresAt of [
          now.toISOString(),
          new Date(now.getTime() - 1).toISOString(),
          'tomorrow',
          '2026-13-45T00:00:00Z',
        ]) {
          const res = await call(alex, 'POST', `/groups/${group.id}/invites`, { expiresAt });
          expect(res.statusCode, expiresAt).toBe(400);
          expect(res.json().error.code).toBe('INVALID_INVITE_EXPIRY');
        }
        expect(await app.db.select().from(groupInvites)).toHaveLength(3);
      });

      it('rejects at the boundary with no membership, badge or join-event writes', async () => {
        const expiresAt = new Date(now.getTime() + DAY_MS);
        const issued = await issueInvite(alex, { expiresAt: expiresAt.toISOString() });

        now = new Date(expiresAt.getTime() - 1);
        expect((await call(null, 'GET', `/invites/group/${issued.token}`)).statusCode).toBe(200);

        now = expiresAt;
        const preview = await call(null, 'GET', `/invites/group/${issued.token}`);
        expect(preview.statusCode).toBe(404);
        expect(preview.json().error.code).toBe('INVITE_NOT_FOUND');
        for (const credential of [{ token: issued.token }, { code: issued.code }]) {
          const res = await join(pat, credential);
          expect(res.statusCode).toBe(400);
          expect(res.json().error.code).toBe('INVITE_INVALID');
        }
        expect(await membership(group.id, pat.id)).toBeUndefined();
        expect(await achievementCodesOf(app.db, pat.id)).toEqual([]);
        expect(await app.db.select().from(notifications)).toHaveLength(0);
        const list = await call(alex, 'GET', `/groups/${group.id}/invites`);
        expect(list.json()[0].status).toBe('EXPIRED');
      });

      it('a nonexpiring invite stays redeemable as the clock advances', async () => {
        const issued = await issueInvite(alex, { expiresAt: null });
        now = new Date(now.getTime() + 3650 * DAY_MS);
        expect((await call(null, 'GET', `/invites/group/${issued.token}`)).statusCode).toBe(200);
        const res = await join(pat, { code: issued.code });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ role: 'MEMBER', joined: true });
      });
    });

    it('retries a forced token/code collision without exposing the other invite', async () => {
      const existing = await issueInvite(alex);
      const fresh = { token: generateCapabilityToken(), code: 'ABCDEFGH23' };
      const draws = [{ token: existing.token, code: existing.code }, fresh];
      const issued = await createGroupInvite(
        app.db,
        { groupId: group.id, callerId: alex.id, expiresAt: undefined },
        { publicWebUrl: PUBLIC_WEB_URL, ttlDays: 30, now },
        () => draws.shift() ?? fresh,
      );
      expect(draws).toHaveLength(0);
      expect(issued.code).toBe(fresh.code);
      expect(issued.url).toBe(`${PUBLIC_WEB_URL}/join/${fresh.token}`);
      expect(issued.invite.id).not.toBe(existing.id);
      expect(issued.invite.tokenHash).toBe(hashCapabilityToken(fresh.token));

      const collidingCodeOnly = [
        { token: generateCapabilityToken(), code: existing.code },
        { token: generateCapabilityToken(), code: 'HJKMNPQRST' },
      ];
      const second = await createGroupInvite(
        app.db,
        { groupId: group.id, callerId: alex.id, expiresAt: undefined },
        { publicWebUrl: PUBLIC_WEB_URL, ttlDays: 30, now },
        () => collidingCodeOnly.shift() ?? fresh,
      );
      expect(second.code).toBe('HJKMNPQRST');
      expect(await app.db.select().from(groupInvites)).toHaveLength(3);

      expect((await join(pat, { code: existing.code })).json().group.id).toBe(group.id);
    });

    it('normalized codes resolve the same invite as the URL token', async () => {
      const issued = await issueInvite(alex);
      const messy = ` ${issued.code.slice(0, 5).toLowerCase()}-${issued.code.slice(5)} `;
      expect(normalizeInviteCode(messy)).toBe(issued.code);
      const byCode = await join(pat, { code: messy });
      expect(byCode.statusCode).toBe(200);
      const byToken = await join(pat, { token: issued.token });
      expect(byToken.json()).toMatchObject({ joined: false, group: { id: group.id } });
      expect((await join(pat, { code: 'ZZZZZZZZZZ' })).json().error.code).toBe('INVITE_INVALID');
    });

    it('requires exactly one of token or code', async () => {
      for (const payload of [{}, { token: 'a', code: 'b' }]) {
        const res = await call(pat, 'POST', '/groups/join', payload);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('never logs raw credentials or their hashes on issuance, preview and redemption', async () => {
      const issued = await issueInvite(alex);
      await call(null, 'GET', `/invites/group/${issued.token}`);
      await join(pat, { token: issued.token });
      await join(jordan, { code: issued.code.toLowerCase() });
      await join(pat, { code: 'WRONGCODE2' });
      await call(null, 'GET', '/invites/group/unknown-token-value');

      const logs = capture.text();
      expect(logs).toContain('/invites/group/[REDACTED]');
      for (const secret of [
        issued.token,
        issued.code,
        issued.code.toLowerCase(),
        'WRONGCODE2',
        'unknown-token-value',
        hashCapabilityToken(issued.token),
        hashCapabilityToken(issued.code),
      ]) {
        expect(logs).not.toContain(secret);
      }
    });
  });

  describe('joining (VAL-GROUP-010, 012, 013)', () => {
    it('grants MEMBER, notifies owner and admins only, and awards the joiner', async () => {
      const issued = await issueInvite(sam);
      const res = await join(pat, { code: issued.code.toLowerCase() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        group: expect.objectContaining({ id: group.id, role: 'MEMBER', memberCount: 4 }),
        role: 'MEMBER',
        joined: true,
      });
      expect((await membership(group.id, pat.id))?.role).toBe('MEMBER');
      expect(await achievementCodesOf(app.db, pat.id)).toEqual(['first_group_joined']);

      expect(await joinEventsFor(alex.id)).toHaveLength(1);
      expect(await joinEventsFor(sam.id)).toHaveLength(1);
      expect(await joinEventsFor(jordan.id)).toHaveLength(0);
      expect(await joinEventsFor(pat.id)).toHaveLength(0);

      const inbox = await call(sam, 'GET', '/notifications');
      expect(inbox.json()[0]).toMatchObject({
        type: 'group_member_joined',
        category: 'groups',
        title: 'New group member',
        target: { type: 'group', groupId: group.id },
      });
      expect(inbox.json()[0].body).toContain('Shark Tank');
    });

    it('existing members keep their role and nothing is written again', async () => {
      const issued = await issueInvite(alex);
      for (const [user, role] of [
        [alex, 'OWNER'],
        [sam, 'ADMIN'],
        [jordan, 'MEMBER'],
      ] as const) {
        const res = await join(user, { token: issued.token });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ role, joined: false, group: { role } });
      }
      await join(pat, { token: issued.token });
      const again = await join(pat, { code: issued.code });
      expect(again.json()).toMatchObject({ role: 'MEMBER', joined: false });
      expect(await groupBadgeRows(pat.id)).toHaveLength(1);
      expect(await joinEventsFor(alex.id)).toHaveLength(1);
      expect(await joinEventsFor(sam.id)).toHaveLength(1);
      expect(await groupRolesOf(app.db, group.id)).toEqual({
        [alex.id]: 'OWNER',
        [sam.id]: 'ADMIN',
        [jordan.id]: 'MEMBER',
        [pat.id]: 'MEMBER',
      });
    });

    it('concurrent token and code redemptions create one membership, badge and event each', async () => {
      const issued = await issueInvite(alex);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          join(pat, i % 2 === 0 ? { token: issued.token } : { code: issued.code.toLowerCase() }),
        ),
      );
      expect(results.map((r) => r.statusCode)).toEqual(Array(8).fill(200));
      expect(results.filter((r) => r.json().joined)).toHaveLength(1);
      const [members] = await app.db
        .select({ n: count() })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, pat.id)));
      expect(members?.n).toBe(1);
      expect(await groupBadgeRows(pat.id)).toHaveLength(1);
      expect(await joinEventsFor(alex.id)).toHaveLength(1);
      expect(await joinEventsFor(sam.id)).toHaveLength(1);
      expect(await joinEventsFor(jordan.id)).toHaveLength(0);
    });

    it('placeholders cannot join', async () => {
      const issued = await issueInvite(alex);
      const guest = await createPlaceholderUser(app.db);
      const res = await join(guest, { token: issued.token });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('USER_NOT_FOUND');
      expect(await membership(group.id, guest.id)).toBeUndefined();
    });
  });

  describe('roles (VAL-GROUP-014..017, 019)', () => {
    const setRole = (caller: UserRow, target: UserRow, role: string) =>
      call(caller, 'PUT', `/groups/${group.id}/members/${target.id}`, { role });
    const remove = (caller: UserRow, target: UserRow) =>
      call(caller, 'DELETE', `/groups/${group.id}/members/${target.id}`);

    it('only the owner promotes and demotes; the owner cannot be demoted', async () => {
      const promoted = await setRole(alex, jordan, 'ADMIN');
      expect(promoted.statusCode).toBe(200);
      expect(promoted.json()).toMatchObject({ role: 'ADMIN', user: { username: 'jordan' } });
      expect((await setRole(alex, jordan, 'MEMBER')).json().role).toBe('MEMBER');

      const byAdmin = await setRole(sam, jordan, 'ADMIN');
      expect(byAdmin.statusCode).toBe(403);
      expect(byAdmin.json().error.code).toBe('GROUP_ROLE_REQUIRED');
      expect((await setRole(jordan, sam, 'MEMBER')).statusCode).toBe(403);
      expect((await setRole(pat, jordan, 'ADMIN')).statusCode).toBe(404);

      const demoteOwner = await setRole(alex, alex, 'ADMIN');
      expect(demoteOwner.statusCode).toBe(400);
      expect(demoteOwner.json().error.code).toBe('OWNER_TRANSFER_REQUIRED');
      expect((await setRole(alex, pat, 'ADMIN')).json().error.code).toBe('MEMBER_NOT_FOUND');
      const ownerRole = await setRole(alex, jordan, 'OWNER');
      expect(ownerRole.statusCode).toBe(400);

      expect(await groupRolesOf(app.db, group.id)).toEqual({
        [alex.id]: 'OWNER',
        [sam.id]: 'ADMIN',
        [jordan.id]: 'MEMBER',
      });
    });

    it('removal follows the role hierarchy', async () => {
      const otherAdmin = await createUser(app.db, { username: 'casey' });
      const otherMember = await createUser(app.db, { username: 'drew' });
      await app.db.insert(groupMembers).values([
        { groupId: group.id, userId: otherAdmin.id, role: 'ADMIN' },
        { groupId: group.id, userId: otherMember.id, role: 'MEMBER' },
      ]);

      const denied: [UserRow, UserRow, number, string][] = [
        [sam, otherAdmin, 403, 'GROUP_ROLE_REQUIRED'],
        [sam, alex, 403, 'GROUP_ROLE_REQUIRED'],
        [jordan, otherMember, 403, 'GROUP_ROLE_REQUIRED'],
        [alex, alex, 400, 'OWNER_TRANSFER_REQUIRED'],
        [alex, pat, 404, 'MEMBER_NOT_FOUND'],
        [pat, jordan, 404, 'GROUP_NOT_FOUND'],
      ];
      for (const [caller, target, status, code] of denied) {
        const res = await remove(caller, target);
        expect(res.statusCode, `${caller.username} removes ${target.username}`).toBe(status);
        expect(res.json().error.code).toBe(code);
      }
      expect(Object.keys(await groupRolesOf(app.db, group.id))).toHaveLength(5);

      expect((await remove(sam, otherMember)).statusCode).toBe(204);
      expect((await remove(alex, otherAdmin)).statusCode).toBe(204);
      expect((await remove(alex, jordan)).statusCode).toBe(204);
      const members = await call(alex, 'GET', `/groups/${group.id}/members`);
      expect(members.json().map((m: { user: { username: string } }) => m.user.username)).toEqual([
        'alex',
        'sam',
      ]);
      expect((await call(jordan, 'GET', '/groups')).json()).toEqual([]);
      expect((await call(jordan, 'GET', `/groups/${group.id}`)).statusCode).toBe(404);
    });

    it('members cannot rename, change roles, remove or transfer', async () => {
      const attempts: [string, string, Payload][] = [
        ['PUT', `/groups/${group.id}`, { name: 'Hijacked' }],
        ['PUT', `/groups/${group.id}/members/${sam.id}`, { role: 'MEMBER' }],
        ['DELETE', `/groups/${group.id}/members/${sam.id}`, undefined],
        ['POST', `/groups/${group.id}/transfer-owner`, { userId: jordan.id }],
      ];
      for (const [method, url, payload] of attempts) {
        const res = await call(jordan, method, url, payload);
        expect(res.statusCode, `${method} ${url}`).toBe(403);
      }
      expect((await call(alex, 'GET', `/groups/${group.id}`)).json().name).toBe('Shark Tank');
      expect(await groupRolesOf(app.db, group.id)).toEqual({
        [alex.id]: 'OWNER',
        [sam.id]: 'ADMIN',
        [jordan.id]: 'MEMBER',
      });
    });

    it('transfers ownership to a member; the old owner becomes ADMIN', async () => {
      const toOutsider = await call(alex, 'POST', `/groups/${group.id}/transfer-owner`, {
        userId: pat.id,
      });
      expect(toOutsider.statusCode).toBe(404);
      expect(toOutsider.json().error.code).toBe('MEMBER_NOT_FOUND');
      const byAdmin = await call(sam, 'POST', `/groups/${group.id}/transfer-owner`, {
        userId: sam.id,
      });
      expect(byAdmin.statusCode).toBe(403);

      const res = await call(alex, 'POST', `/groups/${group.id}/transfer-owner`, {
        userId: jordan.id,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: group.id, role: 'ADMIN' });
      expect(await groupRolesOf(app.db, group.id)).toEqual({
        [alex.id]: 'ADMIN',
        [sam.id]: 'ADMIN',
        [jordan.id]: 'OWNER',
      });
      expect((await setRole(alex, sam, 'MEMBER')).statusCode).toBe(403);
      expect((await setRole(jordan, alex, 'MEMBER')).statusCode).toBe(200);
    });

    it('members and admins leave; the owner must transfer first', async () => {
      expect((await call(jordan, 'POST', `/groups/${group.id}/leave`)).statusCode).toBe(204);
      expect((await call(sam, 'POST', `/groups/${group.id}/leave`, {})).statusCode).toBe(204);
      const owner = await call(alex, 'POST', `/groups/${group.id}/leave`);
      expect(owner.statusCode).toBe(400);
      expect(owner.json().error.code).toBe('OWNER_TRANSFER_REQUIRED');
      expect((await call(pat, 'POST', `/groups/${group.id}/leave`)).statusCode).toBe(404);
      expect(await groupRolesOf(app.db, group.id)).toEqual({ [alex.id]: 'OWNER' });

      await addGroupMember(app.db, group.id, pat.id);
      await call(alex, 'POST', `/groups/${group.id}/transfer-owner`, { userId: pat.id });
      expect((await call(alex, 'POST', `/groups/${group.id}/leave`)).statusCode).toBe(204);
      expect(await groupRolesOf(app.db, group.id)).toEqual({ [pat.id]: 'OWNER' });
      expect((await call(alex, 'GET', '/groups')).json()).toEqual([]);
    });

    it('a former member no longer sees group events or the badge source', async () => {
      const issued = await issueInvite(alex);
      await join(pat, { token: issued.token });
      await call(alex, 'DELETE', `/groups/${group.id}/members/${sam.id}`);
      const inbox = await call(sam, 'GET', '/notifications');
      expect(inbox.json()).toEqual([]);
      expect((await call(alex, 'GET', '/notifications')).json()).toHaveLength(1);

      await call(alex, 'DELETE', `/groups/${group.id}/members/${pat.id}`);
      const badge = (await call(pat, 'GET', '/users/pat/achievements'))
        .json<{ code: string; source: unknown }[]>()
        .find((a) => a.code === 'first_group_joined');
      expect(badge?.source).toEqual({
        type: 'GROUP',
        gameId: null,
        groupId: null,
        challengeId: null,
      });
    });
  });

  describe('grouped tournaments (VAL-GROUP-020, 021)', () => {
    const createIn = (user: UserRow, displayName: string) =>
      call(user, 'POST', '/tournaments', {
        displayName,
        sportName: 'babyfoot',
        groupId: group.id,
      });

    it('owner and admin create; member 403; nonmember 404; the group never changes', async () => {
      const byOwner = await createIn(alex, 'Tank Cup');
      expect(byOwner.statusCode).toBe(201);
      expect(byOwner.json()).toMatchObject({
        name: 'tankcup',
        group: { id: group.id, name: 'Shark Tank' },
      });
      expect((await createIn(sam, 'Tank Open')).statusCode).toBe(201);

      const byMember = await createIn(jordan, 'Jordan Cup');
      expect(byMember.statusCode).toBe(403);
      expect(byMember.json().error.code).toBe('GROUP_ROLE_REQUIRED');
      const byOutsider = await createIn(pat, 'Pat Cup');
      expect(byOutsider.statusCode).toBe(404);
      expect(byOutsider.json().error.code).toBe('GROUP_NOT_FOUND');

      const other = await createGroup(app.db, { ownerId: pat.id });
      const moved = await call(alex, 'PUT', '/tournaments/tankcup', {
        displayName: 'Moved',
        groupId: other.id,
      });
      expect(moved.statusCode).toBe(400);
      const [row] = await app.db.select().from(tournaments).where(eq(tournaments.name, 'tankcup'));
      expect(row).toMatchObject({ groupId: group.id, displayName: 'Tank Cup' });

      const listed = await call(jordan, 'GET', `/groups/${group.id}/tournaments`);
      expect(listed.json().map((t: { name: string }) => t.name)).toEqual(['tankopen', 'tankcup']);
      expect(await app.db.select().from(tournaments)).toHaveLength(2);
    });

    it('management follows the current group role, not the original creator', async () => {
      expect((await createIn(sam, 'Sam Cup')).statusCode).toBe(201);
      expect((await createIn(sam, 'Sam Two')).statusCode).toBe(201);

      const byOwner = await call(alex, 'PUT', '/tournaments/samcup', { isOver: true });
      expect(byOwner.statusCode).toBe(200);

      await call(alex, 'PUT', `/groups/${group.id}/members/${sam.id}`, { role: 'MEMBER' });
      const demoted = await call(sam, 'PUT', '/tournaments/samcup', { displayName: 'Mine' });
      expect(demoted.statusCode).toBe(403);
      expect(demoted.json().error.code).toBe('GROUP_ROLE_REQUIRED');
      expect((await call(sam, 'DELETE', '/tournaments/samtwo')).statusCode).toBe(403);

      await call(alex, 'DELETE', `/groups/${group.id}/members/${sam.id}`);
      expect((await call(sam, 'PUT', '/tournaments/samcup', { isOver: false })).statusCode).toBe(
        404,
      );
      expect((await call(sam, 'DELETE', '/tournaments/samtwo')).statusCode).toBe(404);

      const rows = await app.db.select().from(tournaments);
      expect(rows.map((t) => [t.name, t.displayName, t.isOver]).sort()).toEqual([
        ['samcup', 'Sam Cup', true],
        ['samtwo', 'Sam Two', false],
      ]);
      expect((await call(alex, 'DELETE', '/tournaments/samtwo')).statusCode).toBe(204);
    });
  });

  describe('grouped games and roster (VAL-GROUP-022, 024)', () => {
    let tournamentName: string;

    beforeEach(async () => {
      const sport = await createSport(app.db, { name: 'babyfoot' });
      const t = await createTournament(app.db, {
        name: 'tankcup',
        sportId: sport.id,
        ownerUserId: alex.id,
        groupId: group.id,
      });
      tournamentName = t.name;
    });

    const submit = (caller: UserRow, winners: string[], losers: string[]) =>
      call(caller, 'POST', `/tournaments/${tournamentName}/games`, {
        outcomes: [
          ...winners.map((username) => ({ username, result: 'WIN' })),
          ...losers.map((username) => ({ username, result: 'LOSS' })),
        ],
      });

    const writes = async () => ({
      games: (await app.db.select().from(games)).length,
      outcomes: (await app.db.select().from(outcomes)).length,
      stats: (await app.db.select().from(stats)).length,
      badges: (await app.db.select().from(userAchievements)).length,
      inbox: (await app.db.select().from(notifications)).length,
    });

    it('a member records with members and a rostered placeholder', async () => {
      const created = await call(jordan, 'POST', '/players/placeholders', {
        displayName: 'Riley Guest',
        groupId: group.id,
      });
      expect(created.statusCode).toBe(201);
      const riley = created.json().user;

      const res = await submit(jordan, [riley.username, 'sam'], ['jordan', 'alex']);
      expect(res.statusCode, res.body).toBe(201);
      const board = await call(jordan, 'GET', `/tournaments/${tournamentName}/stats`);
      expect(board.statusCode).toBe(200);
      expect(board.json()).toHaveLength(4);
    });

    it('rejects nonmember callers, nonmember participants and nonrostered placeholders', async () => {
      await createPlaceholderUser(app.db, { username: 'stray' });
      const before = await writes();

      const outsider = await submit(pat, ['jordan'], ['pat']);
      expect(outsider.statusCode).toBe(404);
      expect(outsider.json().error.code).toBe('TOURNAMENT_NOT_FOUND');

      const withOutsider = await submit(jordan, ['pat'], ['jordan']);
      expect(withOutsider.statusCode).toBe(400);
      expect(withOutsider.json().error.code).toBe('PLAYER_NOT_GROUP_MEMBER');
      expect(withOutsider.json().error.message).toContain('pat');

      const withStray = await submit(jordan, ['stray'], ['jordan']);
      expect(withStray.statusCode).toBe(400);
      expect(withStray.json().error.code).toBe('PLAYER_NOT_GROUP_MEMBER');

      expect(await writes()).toEqual(before);
    });

    it('lists rostered placeholders as unclaimed players, not members', async () => {
      const created = await call(jordan, 'POST', '/players/placeholders', {
        displayName: 'Riley Guest',
        groupId: group.id,
      });
      const riley = created.json().user;
      const players = await call(alex, 'GET', `/groups/${group.id}/players`);
      expect(players.statusCode).toBe(200);
      expect(players.json()).toEqual([
        {
          user: expect.objectContaining({ id: riley.id, accountType: 'PLACEHOLDER' }),
          addedBy: expect.objectContaining({ username: 'jordan' }),
          addedAt: expect.any(String),
        },
      ]);
      const members = await call(alex, 'GET', `/groups/${group.id}/members`);
      expect(members.json().map((m: { user: { id: string } }) => m.user.id)).not.toContain(
        riley.id,
      );

      const notMine = await call(pat, 'POST', '/players/placeholders', {
        displayName: 'Nope',
        groupId: group.id,
      });
      expect(notMine.statusCode).toBe(404);
      expect(notMine.json().error.code).toBe('GROUP_NOT_FOUND');
    });

    it('rosters existing placeholders by creator or owner/admin only', async () => {
      const byJordan = await createPlaceholderUser(app.db, { createdByUserId: jordan.id });
      const byPat = await createPlaceholderUser(app.db, { createdByUserId: pat.id });
      const roster = (caller: UserRow, placeholderUserId: string) =>
        call(caller, 'POST', `/groups/${group.id}/players`, { placeholderUserId });

      expect((await roster(jordan, byJordan.id)).statusCode).toBe(201);
      expect((await roster(jordan, byJordan.id)).statusCode).toBe(201);

      const denied = await roster(jordan, byPat.id);
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('NOT_PLACEHOLDER_CREATOR');
      const registered = await roster(sam, pat.id);
      expect(registered.statusCode).toBe(400);
      expect(registered.json().error.code).toBe('NOT_PLACEHOLDER');
      expect((await roster(pat, byPat.id)).statusCode).toBe(404);
      const missing = await roster(sam, '00000000-0000-4000-8000-000000000000');
      expect(missing.json().error.code).toBe('PLAYER_NOT_FOUND');

      const byAdmin = await roster(sam, byPat.id);
      expect(byAdmin.statusCode).toBe(201);
      expect(byAdmin.json().addedBy.username).toBe('sam');
      const rows = await app.db.select().from(groupPlayers);
      expect(rows.map((r) => r.placeholderUserId).sort()).toEqual([byJordan.id, byPat.id].sort());
    });

    it('a rostered placeholder can then play', async () => {
      const guest = await createPlaceholderUser(app.db, { username: 'guest' });
      await rosterPlayer(app.db, group.id, guest.id);
      expect((await submit(jordan, ['guest'], ['jordan'])).statusCode).toBe(201);
    });
  });
});
