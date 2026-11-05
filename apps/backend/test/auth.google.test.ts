import type { FastifyInstance } from 'fastify';
import { count, eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { refreshTokens, users } from '../src/db/schema.js';
import { deriveUsernameBase, pickAvailableUsername } from '../src/services/user.service.js';
import { startTestGoogleJwks, type TestGoogleJwks } from './google-jwks.js';
import { buildTestApp, createUser, truncateAll } from './helpers.js';

describe('POST /auth/token (google)', () => {
  let app: FastifyInstance;
  let jwks: TestGoogleJwks;

  beforeAll(async () => {
    jwks = await startTestGoogleJwks();
    app = await buildTestApp({ env: { GOOGLE_JWKS_URL: jwks.url } });
  });

  afterAll(async () => {
    await app.close();
    await jwks.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
  });

  const exchange = (idToken: string) =>
    app.inject({ method: 'POST', url: '/auth/token', payload: { provider: 'google', idToken } });

  const userCount = async () => (await app.db.select({ n: count() }).from(users))[0]?.n;

  it('VAL-AUTH-001: provisions a new user with a derived username and returns a session', async () => {
    const idToken = await jwks.mint({
      claims: {
        sub: 'google-123',
        name: 'Zoé  Dupré Martin',
        given_name: 'Zoé',
        family_name: 'Dupré Martin',
        email: 'zoe@example.com',
        picture: 'https://lh3.googleusercontent.com/a/zoe',
        locale: 'fr',
      },
    });

    const res = await exchange(idToken);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['accessToken', 'refreshToken', 'user']);
    expect(body.user).toEqual({
      id: expect.any(String),
      username: 'zoe-dupre-martin',
      accountType: 'REGISTERED',
      firstName: 'Zoé',
      lastName: 'Dupré Martin',
      pictureUrl: 'https://lh3.googleusercontent.com/a/zoe',
      locale: 'fr',
    });

    const rows = await app.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: body.user.id,
      googleSub: 'google-123',
      email: 'zoe@example.com',
      emailVerified: true,
      username: 'zoe-dupre-martin',
      pictureUrl: 'https://lh3.googleusercontent.com/a/zoe',
      locale: 'fr',
    });

    const access = decodeJwt(body.accessToken);
    expect(access).toMatchObject({ sub: body.user.id, typ: 'access' });
    const refresh = decodeJwt(body.refreshToken);
    expect(refresh).toMatchObject({ sub: body.user.id, typ: 'refresh' });
    const stored = await app.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.jti, String(refresh.jti)));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ userId: body.user.id, familyId: refresh.familyId });
  });

  it('accepts the bare accounts.google.com issuer', async () => {
    const res = await exchange(await jwks.mint({ issuer: 'accounts.google.com' }));
    expect(res.statusCode).toBe(200);
  });

  it('splits the display name at the final space when given/family names are absent', async () => {
    const res = await exchange(await jwks.mint({ claims: { name: 'Jean Luc Picard' } }));
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({
      username: 'jean-luc-picard',
      firstName: 'Jean Luc',
      lastName: 'Picard',
    });
  });

  it('VAL-AUTH-002: repeat login reuses the user, refreshes profile, keeps the username', async () => {
    const first = await exchange(
      await jwks.mint({
        claims: {
          sub: 'google-repeat',
          name: 'Ada Lovelace',
          picture: 'https://pic/old',
          locale: 'en',
        },
      }),
    );
    expect(first.statusCode).toBe(200);

    const second = await exchange(
      await jwks.mint({
        claims: {
          sub: 'google-repeat',
          name: 'Ada King',
          given_name: 'Ada',
          family_name: 'King',
          email: 'ada.king@example.com',
          picture: 'https://pic/new',
          locale: 'en-GB',
        },
      }),
    );
    expect(second.statusCode).toBe(200);

    const rows = await app.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(second.json().user.id).toBe(first.json().user.id);
    expect(rows[0]).toMatchObject({
      username: 'ada-lovelace',
      googleSub: 'google-repeat',
      firstName: 'Ada',
      lastName: 'King',
      email: 'ada.king@example.com',
      pictureUrl: 'https://pic/new',
      locale: 'en-GB',
    });
    expect(second.json().user.username).toBe('ada-lovelace');
  });

  describe('VAL-AUTH-003: invalid tokens are rejected without provisioning', () => {
    const cases: [string, () => Promise<string>][] = [
      ['bad signature', () => jwks.mint({ signingKey: jwks.foreignKey })],
      ['wrong audience', () => jwks.mint({ audience: 'someone-else.apps.googleusercontent.com' })],
      ['wrong issuer', () => jwks.mint({ issuer: 'https://evil.example.com' })],
      ['expired', () => jwks.mint({ expiresIn: -120 })],
      ['malformed', async () => 'not-a-jwt'],
    ];

    it.each(cases)('%s → 401', async (_label, makeToken) => {
      const res = await exchange(await makeToken());
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: { code: 'INVALID_ID_TOKEN', message: expect.any(String) },
      });
      expect(await userCount()).toBe(0);
      expect(await app.db.select().from(refreshTokens)).toHaveLength(0);
    });
  });

  it('VAL-AUTH-004: email_verified=false → 401 and no user row', async () => {
    const res = await exchange(await jwks.mint({ claims: { email_verified: false } }));
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(await userCount()).toBe(0);
  });

  it('rejects tokens without an email_verified claim', async () => {
    const res = await exchange(await jwks.mint({ claims: { email_verified: undefined } }));
    expect(res.statusCode).toBe(401);
    expect(await userCount()).toBe(0);
  });

  it('VAL-AUTH-010: same display name yields base, base-1, base-2', async () => {
    const usernames: string[] = [];
    for (const sub of ['sub-a', 'sub-b', 'sub-c']) {
      const res = await exchange(await jwks.mint({ claims: { sub, name: 'Émile Zola' } }));
      expect(res.statusCode).toBe(200);
      usernames.push(res.json().user.username);
    }
    expect(usernames).toEqual(['emile-zola', 'emile-zola-1', 'emile-zola-2']);
    expect(await userCount()).toBe(3);
  });

  it('fills the first gap and ignores unrelated usernames sharing the prefix', async () => {
    await createUser(app.db, { username: 'emile-zola' });
    await createUser(app.db, { username: 'emile-zolaesque' });
    await createUser(app.db, { username: 'emile-zola-2' });
    const res = await exchange(await jwks.mint({ claims: { sub: 'sub-gap', name: 'Emile Zola' } }));
    expect(res.json().user.username).toBe('emile-zola-1');
  });

  it('rejects requests with an unsupported provider or missing idToken (400)', async () => {
    const facebook = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { provider: 'facebook', idToken: 'x' },
    });
    expect(facebook.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { provider: 'google' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('username derivation', () => {
  it('strips accents, lowercases, and dashes whitespace', () => {
    expect(deriveUsernameBase('  Zoé  Dupré\tMartin ')).toBe('zoe-dupre-martin');
    expect(deriveUsernameBase('ÅNGSTRÖM')).toBe('angstrom');
    expect(deriveUsernameBase('   ')).toBe('player');
  });

  it('collision suffix terminates with the first free slot', () => {
    expect(pickAvailableUsername('sam', new Set())).toBe('sam');
    expect(pickAvailableUsername('sam', new Set(['sam']))).toBe('sam-1');
    expect(pickAvailableUsername('sam', new Set(['sam', 'sam-1', 'sam-2']))).toBe('sam-3');
  });
});
