import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { refreshTokens } from '../src/db/schema.js';
import { authHeadersFor, buildTestApp, createUser, testEnv, truncateAll } from './helpers.js';

const PROTECTED_URL = '/__test/protected';
const DEV_AUTH_SECRET = testEnv.DEV_AUTH_SECRET ?? '';

describe('session lifecycle', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    app.get(PROTECTED_URL, { onRequest: [app.authenticate] }, async (request) => ({
      userId: request.user.id,
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
  });

  const devToken = (username: string, secret: string | null = DEV_AUTH_SECRET) =>
    app.inject({
      method: 'POST',
      url: '/auth/dev-token',
      headers: secret === null ? {} : { 'x-dev-auth': secret },
      payload: { username },
    });

  const refresh = (refreshToken: string) =>
    app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });

  const logout = (refreshToken: string) =>
    app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken } });

  async function startSession() {
    const user = await createUser(app.db, { username: 'dev-alex' });
    const res = await devToken('dev-alex');
    expect(res.statusCode).toBe(200);
    const body = res.json<{ accessToken: string; refreshToken: string }>();
    return { user, ...body };
  }

  describe('VAL-AUTH-005: protected route semantics', () => {
    it('rejects a request without a Bearer token (401)', async () => {
      const res = await app.inject({ method: 'GET', url: PROTECTED_URL });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    });

    it('accepts a valid access token and attaches the user id (200)', async () => {
      const { user, accessToken } = await startSession();
      const res = await app.inject({
        method: 'GET',
        url: PROTECTED_URL,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ userId: user.id });
    });

    it('authHeadersFor produces a working access header', async () => {
      const user = await createUser(app.db);
      const res = await app.inject({
        method: 'GET',
        url: PROTECTED_URL,
        headers: await authHeadersFor(app, user.id),
      });
      expect(res.json()).toEqual({ userId: user.id });
    });

    it('rejects a refresh token used as Bearer (401)', async () => {
      const { refreshToken } = await startSession();
      const res = await app.inject({
        method: 'GET',
        url: PROTECTED_URL,
        headers: { authorization: `Bearer ${refreshToken}` },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('rejects an access-secret token whose typ is not access (401)', async () => {
      const user = await createUser(app.db);
      const forged = await app.jwt.access.sign({
        sub: user.id,
        typ: 'refresh',
        jti: 'x',
        familyId: 'y',
      });
      const res = await app.inject({
        method: 'GET',
        url: PROTECTED_URL,
        headers: { authorization: `Bearer ${forged}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects malformed and non-Bearer authorization headers (401)', async () => {
      for (const authorization of ['Bearer not-a-jwt', 'Basic Zm9vOmJhcg==', 'Bearer']) {
        const res = await app.inject({
          method: 'GET',
          url: PROTECTED_URL,
          headers: { authorization },
        });
        expect(res.statusCode).toBe(401);
      }
    });
  });

  describe('VAL-AUTH-006: refresh rotation + reuse detection', () => {
    it('rotates into a new pair, then reuse of the old token revokes the whole family', async () => {
      const first = await startSession();

      const rotated = await refresh(first.refreshToken);
      expect(rotated.statusCode).toBe(200);
      const second = rotated.json<{ accessToken: string; refreshToken: string }>();
      expect(Object.keys(second).sort()).toEqual(['accessToken', 'refreshToken']);
      expect(second.refreshToken).not.toBe(first.refreshToken);

      const oldClaims = decodeJwt(first.refreshToken);
      const newClaims = decodeJwt(second.refreshToken);
      expect(newClaims.familyId).toBe(oldClaims.familyId);
      expect(newClaims.jti).not.toBe(oldClaims.jti);
      expect(newClaims.sub).toBe(first.user.id);

      const me = await app.inject({
        method: 'GET',
        url: PROTECTED_URL,
        headers: { authorization: `Bearer ${second.accessToken}` },
      });
      expect(me.statusCode).toBe(200);

      const [oldRow] = await app.db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.jti, String(oldClaims.jti)));
      expect(oldRow?.revokedAt).toBeInstanceOf(Date);

      const reuse = await refresh(first.refreshToken);
      expect(reuse.statusCode).toBe(401);
      expect(reuse.json().error.code).toBe('INVALID_REFRESH_TOKEN');

      const afterReuse = await refresh(second.refreshToken);
      expect(afterReuse.statusCode).toBe(401);

      const family = await app.db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.familyId, String(oldClaims.familyId)));
      expect(family).toHaveLength(2);
      expect(family.every((row) => row.revokedAt !== null)).toBe(true);
    });

    it('a chain of rotations keeps working while each token is used once', async () => {
      let { refreshToken } = await startSession();
      for (let i = 0; i < 3; i++) {
        const res = await refresh(refreshToken);
        expect(res.statusCode).toBe(200);
        refreshToken = res.json().refreshToken;
      }
      expect(await app.db.select().from(refreshTokens)).toHaveLength(4);
    });

    it('reuse detection does not touch other families of the same user', async () => {
      const a = await startSession();
      const b = await devToken('dev-alex');
      const otherRefresh = b.json().refreshToken as string;

      await refresh(a.refreshToken);
      expect((await refresh(a.refreshToken)).statusCode).toBe(401);

      expect((await refresh(otherRefresh)).statusCode).toBe(200);
    });

    it('a validly signed token with an unknown jti → 401 and its family is revoked', async () => {
      const { refreshToken } = await startSession();
      const { sub, familyId } = decodeJwt(refreshToken);
      const unknown = await app.jwt.refresh.sign({
        sub: String(sub),
        typ: 'refresh',
        jti: '00000000-0000-4000-8000-000000000000',
        familyId: String(familyId),
      });
      expect((await refresh(unknown)).statusCode).toBe(401);
      expect((await refresh(refreshToken)).statusCode).toBe(401);
    });

    it('rejects access tokens, garbage and missing bodies', async () => {
      const { accessToken } = await startSession();
      expect((await refresh(accessToken)).statusCode).toBe(401);
      expect((await refresh('not-a-jwt')).statusCode).toBe(401);
      const missing = await app.inject({ method: 'POST', url: '/auth/refresh', payload: {} });
      expect(missing.statusCode).toBe(400);
    });

    it('rejects an expired refresh token', async () => {
      const { refreshToken } = await startSession();
      const { sub, jti, familyId } = decodeJwt(refreshToken);
      const expired = await app.jwt.refresh.sign(
        { sub: String(sub), typ: 'refresh', jti: String(jti), familyId: String(familyId) },
        { expiresIn: -10 },
      );
      expect((await refresh(expired)).statusCode).toBe(401);
    });
  });

  describe('VAL-AUTH-007: logout revokes the family', () => {
    it('logout → 204, then the token and its rotated descendant → 401', async () => {
      const first = await startSession();
      const rotated = await refresh(first.refreshToken);
      const second = rotated.json().refreshToken as string;

      const res = await logout(first.refreshToken);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');

      expect((await refresh(first.refreshToken)).statusCode).toBe(401);
      expect((await refresh(second)).statusCode).toBe(401);
    });

    it('logout with the current token blocks further refreshes', async () => {
      const { refreshToken } = await startSession();
      expect((await logout(refreshToken)).statusCode).toBe(204);
      expect((await refresh(refreshToken)).statusCode).toBe(401);
    });

    it('logout with an invalid token → 401', async () => {
      expect((await logout('not-a-jwt')).statusCode).toBe(401);
    });
  });

  it('VAL-AUTH-008: token lifetimes and typ claims', async () => {
    const { user, accessToken, refreshToken } = await startSession();

    const access = decodeJwt(accessToken);
    expect(access.typ).toBe('access');
    expect(access.sub).toBe(user.id);
    const accessTtl = Number(access.exp) - Number(access.iat);
    expect(accessTtl).toBeGreaterThanOrEqual(890);
    expect(accessTtl).toBeLessThanOrEqual(910);

    const refreshClaims = decodeJwt(refreshToken);
    expect(refreshClaims.typ).toBe('refresh');
    expect(refreshClaims.sub).toBe(user.id);
    expect(refreshClaims.jti).toEqual(expect.any(String));
    expect(refreshClaims.familyId).toEqual(expect.any(String));
    const refreshTtl = Number(refreshClaims.exp) - Number(refreshClaims.iat);
    expect(refreshTtl).toBeGreaterThanOrEqual(30 * 86400 - 10);
    expect(refreshTtl).toBeLessThanOrEqual(30 * 86400 + 10);

    const [row] = await app.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.jti, String(refreshClaims.jti)));
    expect(row).toMatchObject({
      userId: user.id,
      familyId: refreshClaims.familyId,
      revokedAt: null,
    });
    if (!row) throw new Error('refresh token row missing');
    const rowTtl = (row.expiresAt.getTime() - row.createdAt.getTime()) / 1000;
    expect(Math.abs(rowTtl - 30 * 86400)).toBeLessThan(60);
  });

  describe('VAL-AUTH-009: dev-token (development mode)', () => {
    it('issues a real session for an existing user with the correct header', async () => {
      const user = await createUser(app.db, { username: 'dev-sam', firstName: 'Sam' });
      const res = await devToken('dev-sam');
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Object.keys(body).sort()).toEqual(['accessToken', 'refreshToken', 'user']);
      expect(body.user).toMatchObject({ id: user.id, username: 'dev-sam', firstName: 'Sam' });
      expect(decodeJwt(body.accessToken)).toMatchObject({ sub: user.id, typ: 'access' });
      expect(await app.db.select().from(refreshTokens)).toHaveLength(1);
      expect((await refresh(body.refreshToken)).statusCode).toBe(200);
    });

    it('wrong or missing x-dev-auth header → 404', async () => {
      await createUser(app.db, { username: 'dev-sam' });
      expect((await devToken('dev-sam', 'wrong-secret')).statusCode).toBe(404);
      const missing = await devToken('dev-sam', null);
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe('NOT_FOUND');
      expect(await app.db.select().from(refreshTokens)).toHaveLength(0);
    });

    it('unknown username → 404', async () => {
      const res = await devToken('nobody');
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('USER_NOT_FOUND');
    });
  });
});

describe('VAL-AUTH-009: dev-token in production mode', () => {
  let prodApp: FastifyInstance;

  beforeAll(async () => {
    prodApp = await buildTestApp({ env: { APP_ENV: 'production' } });
  });

  afterAll(async () => {
    await prodApp.close();
  });

  beforeEach(async () => {
    await truncateAll(prodApp.db);
  });

  it('returns 404 even with the correct header and an existing user', async () => {
    await createUser(prodApp.db, { username: 'dev-alex' });
    const res = await prodApp.inject({
      method: 'POST',
      url: '/auth/dev-token',
      headers: { 'x-dev-auth': DEV_AUTH_SECRET },
      payload: { username: 'dev-alex' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(await prodApp.db.select().from(refreshTokens)).toHaveLength(0);
  });

  it('refresh and logout remain available in production', async () => {
    const res = await prodApp.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });
});
