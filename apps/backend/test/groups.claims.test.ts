import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  groupMembers,
  notifications,
  outcomes,
  playerClaims,
  refreshTokens,
  userAchievements,
  users,
} from '../src/db/schema.js';
import { startTestGoogleJwks, type TestGoogleJwks } from './google-jwks.js';
import {
  startTestGoogleTokenEndpoint,
  type TestGoogleTokenEndpoint,
} from './google-token-endpoint.js';
import {
  authHeadersFor,
  buildTestApp,
  createGroup,
  createSport,
  createTournament,
  createUser,
  groupRolesOf,
  rosterPlayer,
  truncateAll,
} from './helpers.js';

const CODE = '4/0AVG-group-claim-test-authorization-code';
const VERIFIER = 'pkce-verifier-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEF';
const REDIRECT_URI = 'http://localhost:8083';

type UserRow = Awaited<ReturnType<typeof createUser>>;
type GroupRow = Awaited<ReturnType<typeof createGroup>>;
type SignInResponse = Awaited<ReturnType<FastifyInstance['inject']>>;
type SignIn = (sub: string, claimToken?: string) => Promise<SignInResponse>;

describe('claiming a rostered placeholder joins its groups (VAL-GROUP-025)', () => {
  let app: FastifyInstance;
  let jwks: TestGoogleJwks;
  let google: TestGoogleTokenEndpoint;
  let nextIdToken: () => Promise<string>;

  let alex: UserRow;
  let sam: UserRow;
  let jordan: UserRow;
  let pat: UserRow;
  let tank: GroupRow;
  let other: GroupRow;
  let placeholderId: string;
  let claimToken: string;

  beforeAll(async () => {
    jwks = await startTestGoogleJwks();
    google = await startTestGoogleTokenEndpoint(async () => ({
      status: 200,
      body: { access_token: 'ya29.unused', id_token: await nextIdToken() },
    }));
    app = await buildTestApp({
      env: {
        GOOGLE_JWKS_URL: jwks.url,
        GOOGLE_TOKEN_URL: google.url,
        GOOGLE_CLIENT_SECRET: 'fake-client-secret-for-group-claim-tests',
        GOOGLE_REDIRECT_ALLOWLIST: REDIRECT_URI,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await google.close();
    await jwks.close();
  });

  const mint = (sub: string) =>
    jwks.mint({ claims: { sub, name: 'Riley Real', email: `${sub}@example.com` } });

  const viaIdToken: SignIn = async (sub, token) =>
    app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: {
        provider: 'google',
        idToken: await mint(sub),
        ...(token === undefined ? {} : { claimToken: token }),
      },
    });

  const viaCode: SignIn = async (sub, token) => {
    nextIdToken = () => mint(sub);
    return app.inject({
      method: 'POST',
      url: '/auth/google/code',
      payload: {
        code: CODE,
        codeVerifier: VERIFIER,
        redirectUri: REDIRECT_URI,
        ...(token === undefined ? {} : { claimToken: token }),
      },
    });
  };

  beforeEach(async () => {
    await truncateAll(app.db);
    google.reset();
    nextIdToken = () => mint('unset-sub');
    alex = await createUser(app.db, { username: 'alex' });
    sam = await createUser(app.db, { username: 'sam' });
    jordan = await createUser(app.db, { username: 'jordan' });
    pat = await createUser(app.db, { username: 'pat' });
    tank = await createGroup(app.db, {
      ownerId: alex.id,
      name: 'Shark Tank',
      members: { [sam.id]: 'ADMIN', [jordan.id]: 'MEMBER' },
    });
    other = await createGroup(app.db, {
      ownerId: pat.id,
      name: 'Other',
      members: { [alex.id]: 'MEMBER' },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/players/placeholders',
      headers: await authHeadersFor(app, alex.id),
      payload: { displayName: 'Riley Guest', groupId: tank.id },
    });
    expect(created.statusCode).toBe(201);
    placeholderId = created.json().user.id;
    claimToken = created.json<{ claimUrl: string }>().claimUrl.split('/invite/claim/')[1] ?? '';
    await rosterPlayer(app.db, other.id, placeholderId);

    const sport = await createSport(app.db, { name: 'babyfoot' });
    await createTournament(app.db, {
      name: 'tankcup',
      sportId: sport.id,
      ownerUserId: alex.id,
      groupId: tank.id,
    });
    const game = await app.inject({
      method: 'POST',
      url: '/tournaments/tankcup/games',
      headers: await authHeadersFor(app, jordan.id),
      payload: {
        outcomes: [
          { username: created.json().user.username, result: 'WIN' },
          { username: 'jordan', result: 'LOSS' },
        ],
      },
    });
    expect(game.statusCode).toBe(201);
  });

  afterEach(async () => {
    await app.push.drain();
  });

  const joinEvents = async () =>
    (
      await app.db
        .select({ recipient: notifications.recipientUserId, groupId: notifications.groupId })
        .from(notifications)
        .where(eq(notifications.type, 'group_member_joined'))
    )
      .map((e) => `${e.recipient}:${e.groupId}`)
      .sort();

  const placeholderMemberships = async () =>
    app.db.select().from(groupMembers).where(eq(groupMembers.userId, placeholderId));

  const groupBadges = async () =>
    app.db
      .select()
      .from(userAchievements)
      .where(
        and(
          eq(userAchievements.userId, placeholderId),
          eq(userAchievements.achievementCode, 'first_group_joined'),
        ),
      );

  describe.each([
    ['POST /auth/token', () => viaIdToken],
    ['POST /auth/google/code', () => viaCode],
  ])('through %s', (_, signInWith) => {
    it('keeps the identity and history and joins every rostered group as MEMBER', async () => {
      const historyBefore = await app.db
        .select()
        .from(outcomes)
        .where(eq(outcomes.userId, placeholderId));

      const res = await signInWith()('riley-sub', claimToken);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().user).toMatchObject({ id: placeholderId, accountType: 'REGISTERED' });

      expect(await groupRolesOf(app.db, tank.id)).toEqual({
        [alex.id]: 'OWNER',
        [sam.id]: 'ADMIN',
        [jordan.id]: 'MEMBER',
        [placeholderId]: 'MEMBER',
      });
      expect(await groupRolesOf(app.db, other.id)).toEqual({
        [pat.id]: 'OWNER',
        [alex.id]: 'MEMBER',
        [placeholderId]: 'MEMBER',
      });
      expect(
        await app.db.select().from(outcomes).where(eq(outcomes.userId, placeholderId)),
      ).toEqual(historyBefore);
      expect(await groupBadges()).toHaveLength(1);
      expect(await joinEvents()).toEqual(
        [`${alex.id}:${tank.id}`, `${sam.id}:${tank.id}`, `${pat.id}:${other.id}`].sort(),
      );

      const headers = { authorization: `Bearer ${res.json().accessToken}` };
      const mine = await app.inject({ method: 'GET', url: '/groups', headers });
      expect(mine.json().map((g: { name: string; role: string }) => [g.name, g.role])).toEqual([
        ['Other', 'MEMBER'],
        ['Shark Tank', 'MEMBER'],
      ]);
      const unclaimed = await app.inject({
        method: 'GET',
        url: `/groups/${tank.id}/players`,
        headers: await authHeadersFor(app, alex.id),
      });
      expect(unclaimed.json()).toEqual([]);
    });
  });

  it('an invalid claim token creates no memberships', async () => {
    const res = await viaIdToken('riley-sub', 'not-a-real-claim-token');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CLAIM_INVALID');
    expect(await placeholderMemberships()).toHaveLength(0);
    expect(await joinEvents()).toEqual([]);
  });

  it('an existing account cannot claim and nobody joins', async () => {
    await createUser(app.db, { username: 'existing', googleSub: 'existing-sub' });
    const res = await viaCode('existing-sub', claimToken);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CLAIM_REQUIRES_NEW_ACCOUNT');
    expect(await placeholderMemberships()).toHaveLength(0);
    expect(await joinEvents()).toEqual([]);
  });

  describe('transaction', () => {
    afterEach(async () => {
      await app.db.execute(sql`drop trigger if exists test_fail_at_commit on group_members`);
      await app.db.execute(sql`drop function if exists test_fail_at_commit()`);
    });

    it('a failure at commit rolls back the claim and every membership together', async () => {
      await app.db.execute(
        sql.raw(`create function test_fail_at_commit() returns trigger language plpgsql as $$
          begin raise exception 'injected failure at commit'; end $$`),
      );
      await app.db.execute(
        sql.raw(`create constraint trigger test_fail_at_commit after insert on group_members
          deferrable initially deferred for each row execute function test_fail_at_commit()`),
      );
      const inboxBefore = (await app.db.select().from(notifications)).length;

      const res = await viaIdToken('riley-sub', claimToken);
      expect(res.statusCode).toBe(500);
      const [row] = await app.db.select().from(users).where(eq(users.id, placeholderId));
      expect(row).toMatchObject({ accountType: 'PLACEHOLDER', googleSub: null });
      const [claim] = await app.db
        .select()
        .from(playerClaims)
        .where(eq(playerClaims.placeholderUserId, placeholderId));
      expect(claim?.consumedAt).toBeNull();
      expect(await placeholderMemberships()).toHaveLength(0);
      expect(await groupBadges()).toHaveLength(0);
      expect(await app.db.select().from(notifications)).toHaveLength(inboxBefore);
      expect(await app.db.select().from(refreshTokens)).toHaveLength(0);

      await app.db.execute(sql`drop trigger test_fail_at_commit on group_members`);
      const retried = await viaIdToken('riley-sub', claimToken);
      expect(retried.statusCode).toBe(200);
      expect(await placeholderMemberships()).toHaveLength(2);
    });
  });
});
