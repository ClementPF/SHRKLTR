import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { and, count, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  games,
  groupMembers,
  groupPlayers,
  notifications,
  outcomes,
  rivalryStats,
  stats,
  userAchievements,
  users,
} from '../src/db/schema.js';
import { startTestGoogleJwks, type TestGoogleJwks } from './google-jwks.js';
import {
  achievementCodesOf,
  authHeadersFor,
  buildTestApp,
  createGroup,
  createSport,
  createTournament,
  createUser,
  groupRolesOf,
  truncateAll,
} from './helpers.js';
import { TEST_DATABASE_URL } from './test-env.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;
type GroupRow = Awaited<ReturnType<typeof createGroup>>;

/**
 * Interleavings are forced deterministically: an external transaction holds the row lock the
 * requests need, the requests are started one by one and observed waiting in pg_stat_activity,
 * then the holder is released. Postgres grants queued row locks in arrival order.
 */
describe('group concurrency', () => {
  let app: FastifyInstance;
  let jwks: TestGoogleJwks;
  let control: postgres.Sql;
  let holder: postgres.ReservedSql | null = null;
  let pending: Promise<unknown>[] = [];

  let alex: UserRow; // OWNER
  let sam: UserRow; // ADMIN
  let jordan: UserRow; // MEMBER
  let pat: UserRow; // outsider
  let group: GroupRow;

  beforeAll(async () => {
    jwks = await startTestGoogleJwks();
    app = await buildTestApp({ env: { GOOGLE_JWKS_URL: jwks.url } });
    await app.ready();
    control = postgres(TEST_DATABASE_URL, { max: 2, onnotice: () => {} });
  });

  afterAll(async () => {
    await control.end({ timeout: 5 });
    await app.close();
    await jwks.close();
  });

  beforeEach(async () => {
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
    await releaseHolder();
    await Promise.allSettled(pending);
    pending = [];
    await app.push.drain();
  });

  const call = (user: UserRow, method: string, url: string, payload?: object) => {
    const promise = (async () =>
      app.inject({
        method: method as 'GET',
        url,
        headers: await authHeadersFor(app, user.id),
        ...(payload === undefined ? {} : { payload }),
      }))();
    pending.push(promise);
    return promise;
  };

  async function hold(statement: (conn: postgres.ReservedSql) => Promise<unknown>) {
    const conn = await control.reserve();
    holder = conn;
    await conn`begin`;
    await statement(conn);
    const [row] = await conn<{ pid: number }[]>`select pg_backend_pid() as pid`;
    if (!row) throw new Error('no backend pid');
    return row.pid;
  }

  async function releaseHolder(): Promise<void> {
    if (!holder) return;
    const conn = holder;
    holder = null;
    await conn`rollback`;
    conn.release();
  }

  async function waitForLockWaiters(holderPid: number, n: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const [row] = await control<{ waiting: number }[]>`
        select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and pid <> ${holderPid}`;
      if ((row?.waiting ?? 0) >= n) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} lock waiters`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Starts each request in order, each parked behind the held lock, then releases it. */
  async function race(
    holderPid: number,
    requests: (() => Promise<LightMyRequestResponse>)[],
  ): Promise<LightMyRequestResponse[]> {
    const started: Promise<LightMyRequestResponse>[] = [];
    for (const [i, start] of requests.entries()) {
      started.push(start());
      await waitForLockWaiters(holderPid, i + 1);
    }
    await releaseHolder();
    return Promise.all(started);
  }

  const holdRow = (table: 'groups' | 'users', id: string) =>
    hold((conn) => conn`select id from ${conn(table)} where id = ${id} for update`);
  const holdGroup = (groupId = group.id) => holdRow('groups', groupId);

  const owners = async (groupId = group.id) =>
    app.db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, 'OWNER')));

  const transfer = (caller: UserRow, target: UserRow) => () =>
    call(caller, 'POST', `/groups/${group.id}/transfer-owner`, { userId: target.id });
  const leave = (caller: UserRow) => () => call(caller, 'POST', `/groups/${group.id}/leave`);
  const remove = (caller: UserRow, target: UserRow) => () =>
    call(caller, 'DELETE', `/groups/${group.id}/members/${target.id}`);
  const setRole = (caller: UserRow, target: UserRow, role: 'ADMIN' | 'MEMBER') => () =>
    call(caller, 'PUT', `/groups/${group.id}/members/${target.id}`, { role });

  const statuses = (results: LightMyRequestResponse[]) => results.map((r) => r.statusCode);

  describe('ownership (VAL-GROUP-018)', () => {
    it('two transfers: the second is re-checked and refused', async () => {
      const results = await race(await holdGroup(), [transfer(alex, jordan), transfer(alex, sam)]);
      expect(statuses(results)).toEqual([200, 403]);
      expect(results[1]?.json().error.code).toBe('GROUP_ROLE_REQUIRED');
      expect(await groupRolesOf(app.db, group.id)).toEqual({
        [alex.id]: 'ADMIN',
        [sam.id]: 'ADMIN',
        [jordan.id]: 'OWNER',
      });
    });

    it('transfer then leave: the former owner leaves, one owner remains', async () => {
      const results = await race(await holdGroup(), [transfer(alex, jordan), leave(alex)]);
      expect(statuses(results)).toEqual([200, 204]);
      expect(await groupRolesOf(app.db, group.id)).toEqual({
        [sam.id]: 'ADMIN',
        [jordan.id]: 'OWNER',
      });
    });

    it('leave then transfer: the owner cannot leave, the transfer succeeds', async () => {
      const results = await race(await holdGroup(), [leave(alex), transfer(alex, jordan)]);
      expect(statuses(results)).toEqual([400, 200]);
      expect(results[0]?.json().error.code).toBe('OWNER_TRANSFER_REQUIRED');
      expect((await owners()).map((o) => o.userId)).toEqual([jordan.id]);
    });

    it('removal of the recipient then transfer: the transfer fails and roles stay intact', async () => {
      const results = await race(await holdGroup(), [remove(sam, jordan), transfer(alex, jordan)]);
      expect(statuses(results)).toEqual([204, 404]);
      expect(results[1]?.json().error.code).toBe('MEMBER_NOT_FOUND');
      expect(await groupRolesOf(app.db, group.id)).toEqual({
        [alex.id]: 'OWNER',
        [sam.id]: 'ADMIN',
      });
    });

    it('transfer then demotion of the new owner by the old one: the demotion is refused', async () => {
      const results = await race(await holdGroup(), [
        transfer(alex, sam),
        setRole(alex, sam, 'MEMBER'),
        remove(alex, sam),
      ]);
      expect(statuses(results)).toEqual([200, 403, 403]);
      expect(await groupRolesOf(app.db, group.id)).toEqual({
        [alex.id]: 'ADMIN',
        [sam.id]: 'OWNER',
        [jordan.id]: 'MEMBER',
      });
    });

    it('transfer then the new owner removes the old one', async () => {
      const results = await race(await holdGroup(), [transfer(alex, sam), remove(sam, alex)]);
      expect(statuses(results)).toEqual([200, 204]);
      expect(await groupRolesOf(app.db, group.id)).toEqual({
        [sam.id]: 'OWNER',
        [jordan.id]: 'MEMBER',
      });
    });

    it('unforced mixes of ownership operations always leave exactly one owner', async () => {
      for (let round = 0; round < 5; round++) {
        await app.db.delete(groupMembers).where(eq(groupMembers.groupId, group.id));
        await app.db.insert(groupMembers).values([
          { groupId: group.id, userId: alex.id, role: 'OWNER' },
          { groupId: group.id, userId: sam.id, role: 'ADMIN' },
          { groupId: group.id, userId: jordan.id, role: 'MEMBER' },
        ]);
        const results = await Promise.all([
          transfer(alex, jordan)(),
          transfer(alex, sam)(),
          leave(alex)(),
          remove(alex, sam)(),
          setRole(alex, jordan, 'MEMBER')(),
          leave(sam)(),
          transfer(sam, jordan)(),
        ]);
        for (const res of results) expect(res.statusCode).toBeLessThan(500);
        expect(await owners()).toHaveLength(1);
      }
    });

    it('the database refuses a second owner', async () => {
      await expect(
        app.db.update(groupMembers).set({ role: 'OWNER' }).where(eq(groupMembers.userId, sam.id)),
      ).rejects.toThrow();
      expect((await owners()).map((o) => o.userId)).toEqual([alex.id]);
    });
  });

  describe('joins (VAL-GROUP-012)', () => {
    it('queued token and code redemptions add one membership, badge and event each', async () => {
      const issued = await call(alex, 'POST', `/groups/${group.id}/invites`, {});
      const { url, code } = issued.json<{ url: string; code: string }>();
      const token = url.split('/join/')[1] ?? '';

      const results = await race(await holdGroup(), [
        () => call(pat, 'POST', '/groups/join', { token }),
        () => call(pat, 'POST', '/groups/join', { code: code.toLowerCase() }),
        () => call(pat, 'POST', '/groups/join', { token }),
      ]);
      expect(statuses(results)).toEqual([200, 200, 200]);
      expect(results.map((r) => r.json().joined)).toEqual([true, false, false]);
      const [row] = await app.db
        .select({ n: count() })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, pat.id)));
      expect(row?.n).toBe(1);
      expect(await achievementCodesOf(app.db, pat.id)).toEqual(['first_group_joined']);
      const events = await app.db
        .select({ recipient: notifications.recipientUserId })
        .from(notifications)
        .where(eq(notifications.type, 'group_member_joined'));
      expect(events.map((e) => e.recipient).sort()).toEqual([alex.id, sam.id].sort());
    });
  });

  describe('grouped games vs membership loss (VAL-GROUP-023)', () => {
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

    const submit = (caller: UserRow, winner: UserRow) => () =>
      call(caller, 'POST', `/tournaments/${tournamentName}/games`, {
        outcomes: [
          { username: winner.username, result: 'WIN' },
          { username: caller.username, result: 'LOSS' },
        ],
      });

    const writes = async () => ({
      games: (await app.db.select().from(games)).length,
      outcomes: (await app.db.select().from(outcomes)).length,
      stats: (await app.db.select().from(stats)).length,
      rivalries: (await app.db.select().from(rivalryStats)).length,
      badges: (await app.db.select().from(userAchievements)).length,
      inbox: (await app.db.select().from(notifications)).length,
    });
    const nothingWritten = { games: 0, outcomes: 0, stats: 0, rivalries: 0, badges: 0, inbox: 0 };

    it('a game queued before the removal commits while both were members', async () => {
      const results = await race(await holdGroup(), [submit(jordan, sam), remove(alex, jordan)]);
      expect(statuses(results)).toEqual([201, 204]);
      const recorded = await app.db.select().from(outcomes);
      expect(recorded.map((o) => o.userId).sort()).toEqual([sam.id, jordan.id].sort());
      expect(await groupRolesOf(app.db, group.id)).not.toHaveProperty(jordan.id);
    });

    it('a removal queued before the submitter’s game makes the game fail without writes', async () => {
      const results = await race(await holdGroup(), [remove(alex, jordan), submit(jordan, sam)]);
      expect(statuses(results)).toEqual([204, 404]);
      expect(results[1]?.json().error.code).toBe('TOURNAMENT_NOT_FOUND');
      expect(await writes()).toEqual(nothingWritten);
    });

    it('a participant leaving before the game makes it fail without writes', async () => {
      const results = await race(await holdGroup(), [leave(sam), submit(jordan, sam)]);
      expect(statuses(results)).toEqual([204, 400]);
      expect(results[1]?.json().error.code).toBe('PLAYER_NOT_GROUP_MEMBER');
      expect(await writes()).toEqual(nothingWritten);
    });

    it('concurrent games by members do not block each other on the group lock', async () => {
      const results = await race(await holdGroup(), [submit(jordan, sam), submit(alex, sam)]);
      expect(statuses(results)).toEqual([201, 201]);
      expect(await app.db.select().from(games)).toHaveLength(2);
    });
  });

  describe('claim vs roster addition (VAL-GROUP-025)', () => {
    let placeholderId: string;
    let claimToken: string;
    let other: GroupRow;

    beforeEach(async () => {
      const res = await call(alex, 'POST', '/players/placeholders', {
        displayName: 'Riley Guest',
        groupId: group.id,
      });
      expect(res.statusCode).toBe(201);
      placeholderId = res.json().user.id;
      claimToken = res.json<{ claimUrl: string }>().claimUrl.split('/invite/claim/')[1] ?? '';
      other = await createGroup(app.db, { ownerId: pat.id, name: 'Other' });
    });

    const claim = () => async () => {
      const promise = app.inject({
        method: 'POST',
        url: '/auth/token',
        payload: {
          provider: 'google',
          idToken: await jwks.mint({ claims: { sub: 'riley-sub', name: 'Riley Real' } }),
          claimToken,
        },
      });
      pending.push(promise);
      return promise;
    };
    const rosterInOther = () => () =>
      call(pat, 'POST', `/groups/${other.id}/players`, { placeholderUserId: placeholderId });

    const groupsOf = async (userId: string) =>
      (
        await app.db
          .select({ groupId: groupMembers.groupId, role: groupMembers.role })
          .from(groupMembers)
          .where(eq(groupMembers.userId, userId))
      )
        .map((r) => `${r.groupId}:${r.role}`)
        .sort();

    it('a roster addition queued first is included in the claim', async () => {
      const results = await race(await holdRow('users', placeholderId), [rosterInOther(), claim()]);
      expect(statuses(results)).toEqual([201, 200]);
      expect(results[1]?.json().user.id).toBe(placeholderId);
      expect(await groupsOf(placeholderId)).toEqual(
        [`${group.id}:MEMBER`, `${other.id}:MEMBER`].sort(),
      );
    });

    it('a claim queued first makes the later roster addition fail', async () => {
      const results = await race(await holdRow('users', placeholderId), [claim(), rosterInOther()]);
      expect(statuses(results)).toEqual([200, 400]);
      expect(results[1]?.json().error.code).toBe('NOT_PLACEHOLDER');
      expect(await groupsOf(placeholderId)).toEqual([`${group.id}:MEMBER`]);
      const rostered = await app.db
        .select()
        .from(groupPlayers)
        .where(eq(groupPlayers.groupId, other.id));
      expect(rostered).toHaveLength(0);
      const [claimed] = await app.db.select().from(users).where(eq(users.id, placeholderId));
      expect(claimed?.accountType).toBe('REGISTERED');
    });
  });
});
