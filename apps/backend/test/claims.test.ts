import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { count, eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { issueSession } from '../src/auth/jwt.js';
import {
  outcomes,
  playerClaims,
  refreshTokens,
  rivalryStats,
  stats,
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
  createLogCapture,
  createTournament,
  createUser,
  truncateAll,
} from './helpers.js';

const CODE = '4/0AVG-claim-test-authorization-code';
const VERIFIER = 'pkce-verifier-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEF';
const REDIRECT_URI = 'http://localhost:8081';
const DAY_MS = 24 * 60 * 60 * 1000;

type UserRow = Awaited<ReturnType<typeof createUser>>;
type SignIn = (sub: string, claimToken?: string, name?: string) => Promise<SignInResponse>;
type SignInResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

describe('claiming a placeholder through Google sign-in', () => {
  let app: FastifyInstance;
  let jwks: TestGoogleJwks;
  let google: TestGoogleTokenEndpoint;
  let now: Date;
  let nextIdToken: () => Promise<string>;
  const capture = createLogCapture();

  let creator: UserRow;
  let placeholder: { id: string; username: string };
  let claimToken: string;

  beforeAll(async () => {
    jwks = await startTestGoogleJwks();
    google = await startTestGoogleTokenEndpoint(async () => ({
      status: 200,
      body: { access_token: 'ya29.unused', id_token: await nextIdToken() },
    }));
    app = await buildTestApp({
      logger: capture,
      clock: () => now,
      env: {
        GOOGLE_JWKS_URL: jwks.url,
        GOOGLE_TOKEN_URL: google.url,
        GOOGLE_CLIENT_SECRET: 'fake-client-secret-for-claim-tests',
        GOOGLE_REDIRECT_ALLOWLIST: REDIRECT_URI,
      },
    });
    app
      .withTypeProvider<ZodTypeProvider>()
      .post(
        '/__test/careless-claim-log',
        { schema: { body: z.object({ claimToken: z.string() }) } },
        async (req) => {
          req.log.info({ body: req.body, claimToken: req.body.claimToken }, 'careless claim log');
          return { ok: true };
        },
      );
  });

  afterAll(async () => {
    await app.close();
    await google.close();
    await jwks.close();
  });

  const mint = (sub: string, name = 'Brand New') =>
    jwks.mint({ claims: { sub, name, email: `${sub}@example.com` } });

  const viaIdToken: SignIn = async (sub, token, name) =>
    app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: {
        provider: 'google',
        idToken: await mint(sub, name),
        ...(token === undefined ? {} : { claimToken: token }),
      },
    });

  const viaCode: SignIn = async (sub, token, name) => {
    nextIdToken = () => mint(sub, name);
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
    now = new Date();
    await truncateAll(app.db);
    google.reset();
    nextIdToken = () => mint('unset-sub');
    creator = await createUser(app.db, { username: 'alex', googleSub: 'creator-sub' });
    await createUser(app.db, { username: 'sam', googleSub: 'rival-sub' });

    const created = await app.inject({
      method: 'POST',
      url: '/players/placeholders',
      headers: await authHeadersFor(app, creator.id),
      payload: { displayName: 'Riley Guest' },
    });
    expect(created.statusCode).toBe(201);
    placeholder = created.json().user;
    claimToken = created.json<{ claimUrl: string }>().claimUrl.split('/invite/claim/')[1] ?? '';

    const teammate = await createUser(app.db, { username: 'jo', googleSub: 'jo-sub' });
    const tournament = await createTournament(app.db, { name: 'babyfoot' });
    const games: [string[], string[], UserRow][] = [
      [[placeholder.username], ['alex'], creator],
      [['sam', 'alex'], [placeholder.username, 'jo'], teammate],
    ];
    for (const [winners, losers, caller] of games) {
      const res = await app.inject({
        method: 'POST',
        url: `/tournaments/${tournament.name}/games`,
        headers: await authHeadersFor(app, caller.id),
        payload: {
          outcomes: [
            ...winners.map((username) => ({ username, result: 'WIN' })),
            ...losers.map((username) => ({ username, result: 'LOSS' })),
          ],
        },
      });
      expect(res.statusCode).toBe(201);
    }
  });

  /** Everything owned by the placeholder id, to prove nothing moves on claim. */
  async function history(userId: string) {
    return {
      outcomes: await app.db
        .select()
        .from(outcomes)
        .where(eq(outcomes.userId, userId))
        .orderBy(outcomes.id),
      stats: await app.db.select().from(stats).where(eq(stats.userId, userId)).orderBy(stats.id),
      rivalries: await app.db
        .select()
        .from(rivalryStats)
        .where(eq(rivalryStats.userId, userId))
        .orderBy(rivalryStats.id),
      reverseRivalries: await app.db
        .select()
        .from(rivalryStats)
        .where(eq(rivalryStats.rivalId, userId))
        .orderBy(rivalryStats.id),
    };
  }

  const userCount = async () => (await app.db.select({ n: count() }).from(users))[0]?.n;
  const sessionCount = async () => (await app.db.select({ n: count() }).from(refreshTokens))[0]?.n;
  const claimRow = async () =>
    (
      await app.db
        .select()
        .from(playerClaims)
        .where(eq(playerClaims.placeholderUserId, placeholder.id))
    )[0];
  const placeholderRow = async () =>
    (await app.db.select().from(users).where(eq(users.id, placeholder.id)))[0];

  describe.each<[string, () => SignIn]>([
    ['POST /auth/token', () => viaIdToken],
    ['POST /auth/google/code', () => viaCode],
  ])('%s', (_route, route) => {
    it('VAL-CLAIM-013: a new subject inherits the placeholder id, username and history', async () => {
      const signIn = route();
      const before = await history(placeholder.id);
      expect(before.outcomes).toHaveLength(2);
      expect(before.rivalries).toHaveLength(2);
      const usersBefore = await userCount();

      const res = await signIn('brand-new-sub', claimToken, 'Riley Real');

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user).toMatchObject({
        id: placeholder.id,
        username: placeholder.username,
        accountType: 'REGISTERED',
      });
      expect(decodeJwt(body.accessToken)).toMatchObject({ sub: placeholder.id, typ: 'access' });
      expect(await userCount()).toBe(usersBefore);
      expect(await placeholderRow()).toMatchObject({
        googleSub: 'brand-new-sub',
        accountType: 'REGISTERED',
        email: 'brand-new-sub@example.com',
        emailVerified: true,
        claimedAt: now,
        createdByUserId: creator.id,
      });
      expect((await claimRow())?.consumedAt).toEqual(now);
      expect(await history(placeholder.id)).toEqual(before);

      const relogin = await signIn('brand-new-sub');
      expect(relogin.statusCode).toBe(200);
      expect(relogin.json().user.id).toBe(placeholder.id);

      const profile = await app.inject({
        method: 'GET',
        url: '/users/me',
        headers: { authorization: `Bearer ${relogin.json().accessToken}` },
      });
      expect(profile.json()).toMatchObject({ id: placeholder.id, accountType: 'REGISTERED' });
    });

    it('VAL-CLAIM-015: a consumed link fails for the next new subject and cannot be managed', async () => {
      const signIn = route();
      expect((await signIn('first-new-sub', claimToken)).statusCode).toBe(200);
      const after = await history(placeholder.id);
      const sessions = await sessionCount();
      const usersBefore = await userCount();

      const second = await signIn('second-new-sub', claimToken);
      expect(second.statusCode).toBe(400);
      expect(second.json()).toEqual({
        error: { code: 'CLAIM_INVALID', message: expect.any(String) },
      });
      expect(await userCount()).toBe(usersBefore);
      expect(await sessionCount()).toBe(sessions);
      expect((await placeholderRow())?.googleSub).toBe('first-new-sub');
      expect(await history(placeholder.id)).toEqual(after);

      const headers = await authHeadersFor(app, creator.id);
      for (const method of ['POST', 'DELETE'] as const) {
        const res = await app.inject({
          method,
          url: `/players/${placeholder.id}/claim-link`,
          headers,
          ...(method === 'POST' ? { payload: {} } : {}),
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('CLAIM_ALREADY_USED');
      }
    });

    it('VAL-CLAIM-012: an existing Google account is refused without consuming or merging', async () => {
      const signIn = route();
      const before = await history(placeholder.id);
      const creatorBefore = (await app.db.select().from(users).where(eq(users.id, creator.id)))[0];
      const sessions = await sessionCount();

      const res = await signIn('creator-sub', claimToken);

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: { code: 'CLAIM_REQUIRES_NEW_ACCOUNT', message: expect.any(String) },
      });
      expect(res.body).not.toMatch(/accessToken|refreshToken/);
      expect(await sessionCount()).toBe(sessions);
      expect((await app.db.select().from(users).where(eq(users.id, creator.id)))[0]).toEqual(
        creatorBefore,
      );
      expect(await placeholderRow()).toMatchObject({ accountType: 'PLACEHOLDER', googleSub: null });
      expect((await claimRow())?.consumedAt).toBeNull();
      expect(await history(placeholder.id)).toEqual(before);

      const later = await signIn('eligible-new-sub', claimToken);
      expect(later.statusCode).toBe(200);
      expect(later.json().user.id).toBe(placeholder.id);
    });

    it('VAL-CLAIM-015: unknown, revoked, expired and rotated tokens are 400 CLAIM_INVALID', async () => {
      const signIn = route();
      const usersBefore = await userCount();
      const expectInvalid = async (token: string) => {
        const res = await signIn('hopeful-new-sub', token);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('CLAIM_INVALID');
        expect(await userCount()).toBe(usersBefore);
        expect(await sessionCount()).toBe(0);
        expect((await placeholderRow())?.accountType).toBe('PLACEHOLDER');
      };

      await expectInvalid('unknown-claim-token');

      now = new Date(now.getTime() + 31 * DAY_MS);
      await expectInvalid(claimToken);
      now = new Date();

      const headers = await authHeadersFor(app, creator.id);
      const rotated = await app.inject({
        method: 'POST',
        url: `/players/${placeholder.id}/claim-link`,
        headers,
        payload: {},
      });
      await expectInvalid(claimToken);
      const freshToken = rotated.json<{ claimUrl: string }>().claimUrl.split('/invite/claim/')[1];

      await app.inject({ method: 'DELETE', url: `/players/${placeholder.id}/claim-link`, headers });
      await expectInvalid(freshToken ?? '');
      expect((await claimRow())?.consumedAt).toBeNull();
    });

    it('VAL-CLAIM-005: ordinary login never binds to a placeholder with the same name', async () => {
      const signIn = route();
      const res = await signIn('lookalike-sub', undefined, 'Riley Guest');

      expect(res.statusCode).toBe(200);
      expect(res.json().user.id).not.toBe(placeholder.id);
      expect(res.json().user.username).toBe(`${placeholder.username}-1`);
      expect(res.json().user.accountType).toBe('REGISTERED');
      expect(await placeholderRow()).toMatchObject({ accountType: 'PLACEHOLDER', googleSub: null });
      expect((await claimRow())?.consumedAt).toBeNull();
    });
  });

  it('VAL-CLAIM-005: failed Google verification with a claim token neither claims nor signs in', async () => {
    const forged = await jwks.mint({
      claims: { sub: 'forged-sub' },
      signingKey: jwks.foreignKey,
    });
    const viaToken = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { provider: 'google', idToken: forged, claimToken },
    });
    expect(viaToken.statusCode).toBe(401);

    nextIdToken = async () => forged;
    const viaExchange = await app.inject({
      method: 'POST',
      url: '/auth/google/code',
      payload: { code: CODE, codeVerifier: VERIFIER, redirectUri: REDIRECT_URI, claimToken },
    });
    expect(viaExchange.statusCode).toBe(401);

    expect(await sessionCount()).toBe(0);
    expect(await placeholderRow()).toMatchObject({ accountType: 'PLACEHOLDER', googleSub: null });
    expect((await claimRow())?.consumedAt).toBeNull();
  });

  it('refresh never issues a session for a placeholder subject', async () => {
    const { refreshToken } = await issueSession(app, app.db, placeholder.id);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_REFRESH_TOKEN');
    const rows = await app.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, placeholder.id));
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('VAL-CLAIM-018: both auth routes and careless logs never write the claim token', async () => {
    capture.lines.length = 0;
    await viaIdToken('creator-sub', claimToken);
    await viaCode('creator-sub', claimToken);
    await viaCode('log-new-sub', claimToken);
    await app.inject({
      method: 'POST',
      url: '/__test/careless-claim-log',
      payload: { claimToken },
    });

    const output = capture.text();
    expect(output).toContain('careless claim log');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain(claimToken);
  });
});
