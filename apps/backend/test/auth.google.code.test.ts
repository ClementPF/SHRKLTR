import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { count } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { refreshTokens, users } from '../src/db/schema.js';
import { startTestGoogleJwks, TEST_GOOGLE_CLIENT_ID, type TestGoogleJwks } from './google-jwks.js';
import {
  startTestGoogleTokenEndpoint,
  type TestGoogleTokenEndpoint,
  type TokenHandler,
} from './google-token-endpoint.js';
import { buildTestApp, createLogCapture, truncateAll } from './helpers.js';

// Fake values only: tests never see the real client secret.
const FAKE_SECRET = 'fake-client-secret-for-tests-7f3a9c';
const VALID_CODE = '4/0AVG-valid-authorization-code-e1b2c3';
const VERIFIER = 'pkce-verifier-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEF';
const REDIRECT_URI = 'http://localhost:8081';
const UPSTREAM_ACCESS = 'ya29.google-access-token-value';
const UPSTREAM_REFRESH = '1//google-refresh-token-value';

const userCount = async (app: FastifyInstance) =>
  (await app.db.select({ n: count() }).from(users))[0]?.n;

const exchange = (
  app: FastifyInstance,
  payload: Record<string, unknown> = {
    code: VALID_CODE,
    codeVerifier: VERIFIER,
    redirectUri: REDIRECT_URI,
  },
) => app.inject({ method: 'POST', url: '/auth/google/code', payload });

describe('POST /auth/google/code', () => {
  let app: FastifyInstance;
  let jwks: TestGoogleJwks;
  let google: TestGoogleTokenEndpoint;
  const capture = createLogCapture();
  let nextIdToken: () => Promise<string>;

  const acceptValidCode: TokenHandler = async (params) => {
    if (params.code !== VALID_CODE) {
      return { status: 400, body: { error: 'invalid_grant', error_description: 'Bad Request' } };
    }
    return {
      status: 200,
      body: {
        access_token: UPSTREAM_ACCESS,
        refresh_token: UPSTREAM_REFRESH,
        expires_in: 3599,
        scope: 'openid email profile',
        token_type: 'Bearer',
        id_token: await nextIdToken(),
      },
    };
  };

  beforeAll(async () => {
    jwks = await startTestGoogleJwks();
    google = await startTestGoogleTokenEndpoint(acceptValidCode);
    app = await buildTestApp({
      logger: capture,
      env: {
        GOOGLE_JWKS_URL: jwks.url,
        GOOGLE_TOKEN_URL: google.url,
        GOOGLE_CLIENT_SECRET: FAKE_SECRET,
        GOOGLE_REDIRECT_ALLOWLIST: `${REDIRECT_URI}, com.elo.sharkulator:/oauthredirect`,
      },
    });
    app
      .withTypeProvider<ZodTypeProvider>()
      .post(
        '/__test/careless-code-log',
        { schema: { body: z.record(z.string(), z.string()) } },
        async (req) => {
          // Simulates a careless log statement carrying exchange parameters.
          req.log.info(
            {
              body: req.body,
              code: req.body.code,
              codeVerifier: req.body.codeVerifier,
              params: {
                code: req.body.code,
                code_verifier: req.body.codeVerifier,
                client_secret: FAKE_SECRET,
              },
              upstream: {
                id_token: 'upstream-id-token-value',
                access_token: UPSTREAM_ACCESS,
                refresh_token: UPSTREAM_REFRESH,
              },
              clientSecret: FAKE_SECRET,
            },
            'careless exchange log',
          );
          return { ok: true };
        },
      );
  });

  afterAll(async () => {
    await app.close();
    await google.close();
    await jwks.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    google.reset();
    nextIdToken = () =>
      jwks.mint({
        claims: {
          sub: 'google-code-sub',
          name: 'Grace Hopper',
          given_name: 'Grace',
          family_name: 'Hopper',
          email: 'grace@example.com',
        },
      });
  });

  it('VAL-AUTH-011: exchanges a valid code and provisions through the ID-token path', async () => {
    const res = await exchange(app);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['accessToken', 'refreshToken', 'user']);
    expect(body.user).toMatchObject({
      id: expect.any(String),
      username: 'grace-hopper',
      firstName: 'Grace',
      lastName: 'Hopper',
    });
    expect(decodeJwt(body.accessToken)).toMatchObject({ sub: body.user.id, typ: 'access' });
    expect(decodeJwt(body.refreshToken)).toMatchObject({ sub: body.user.id, typ: 'refresh' });
    expect(JSON.stringify(body)).not.toContain(UPSTREAM_ACCESS);

    const rows = await app.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      googleSub: 'google-code-sub',
      email: 'grace@example.com',
      emailVerified: true,
    });
    expect(await app.db.select().from(refreshTokens)).toHaveLength(1);

    expect(google.received).toHaveLength(1);
    expect(google.received[0]).toEqual({
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      params: {
        grant_type: 'authorization_code',
        code: VALID_CODE,
        code_verifier: VERIFIER,
        client_id: TEST_GOOGLE_CLIENT_ID,
        client_secret: FAKE_SECRET,
        redirect_uri: REDIRECT_URI,
      },
    });
  });

  it('links a repeat sign-in to the same user (shared provisioning with /auth/token)', async () => {
    const viaToken = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { provider: 'google', idToken: await nextIdToken() },
    });
    expect(viaToken.statusCode).toBe(200);

    const viaCode = await exchange(app);
    expect(viaCode.statusCode).toBe(200);
    expect(viaCode.json().user.id).toBe(viaToken.json().user.id);
    expect(viaCode.json().user.username).toBe('grace-hopper');
    expect(await userCount(app)).toBe(1);
  });

  it('accepts any exact allowlist entry, including the native scheme', async () => {
    const res = await exchange(app, {
      code: VALID_CODE,
      codeVerifier: VERIFIER,
      redirectUri: 'com.elo.sharkulator:/oauthredirect',
    });
    expect(res.statusCode).toBe(200);
    expect(google.received[0]?.params.redirect_uri).toBe('com.elo.sharkulator:/oauthredirect');
  });

  describe('ID-token checks still apply to the exchanged token', () => {
    const cases: [string, () => Promise<string>, string][] = [
      [
        'wrong audience',
        () => jwks.mint({ audience: 'other.apps.googleusercontent.com' }),
        'INVALID_ID_TOKEN',
      ],
      ['wrong issuer', () => jwks.mint({ issuer: 'https://evil.example.com' }), 'INVALID_ID_TOKEN'],
      ['expired', () => jwks.mint({ expiresIn: -120 }), 'INVALID_ID_TOKEN'],
      ['bad signature', () => jwks.mint({ signingKey: jwks.foreignKey }), 'INVALID_ID_TOKEN'],
      [
        'email not verified',
        () => jwks.mint({ claims: { email_verified: false } }),
        'EMAIL_NOT_VERIFIED',
      ],
    ];

    it.each(cases)('%s → 401 and no user row', async (_label, mint, code) => {
      nextIdToken = mint;
      const res = await exchange(app);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe(code);
      expect(await userCount(app)).toBe(0);
    });
  });

  it('rejects a redirectUri outside the allowlist with 400 without calling Google', async () => {
    for (const redirectUri of [
      'http://localhost:8081/',
      'https://evil.example.com',
      'http://localhost:8082',
    ]) {
      const res = await exchange(app, { code: VALID_CODE, codeVerifier: VERIFIER, redirectUri });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: { code: 'REDIRECT_URI_NOT_ALLOWED', message: expect.any(String) },
      });
    }
    expect(google.received).toHaveLength(0);
    expect(await userCount(app)).toBe(0);
  });

  it('rejects malformed bodies with 400', async () => {
    for (const payload of [
      {},
      { code: VALID_CODE, redirectUri: REDIRECT_URI },
      { code: '', codeVerifier: VERIFIER, redirectUri: REDIRECT_URI },
      { code: VALID_CODE, codeVerifier: 'short', redirectUri: REDIRECT_URI },
    ]) {
      const res = await exchange(app, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect(google.received).toHaveLength(0);
  });

  it('maps a Google invalid_grant rejection to 401 with no user row', async () => {
    const res = await exchange(app, {
      code: '4/0AVG-revoked-or-reused-code',
      codeVerifier: VERIFIER,
      redirectUri: REDIRECT_URI,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'INVALID_AUTHORIZATION_CODE', message: expect.any(String) },
    });
    expect(google.received).toHaveLength(1);
    expect(await userCount(app)).toBe(0);
    expect(await app.db.select().from(refreshTokens)).toHaveLength(0);
  });

  it('maps other Google 4xx replies (e.g. invalid_client) to 401', async () => {
    google.handle(() => ({ status: 401, body: { error: 'invalid_client' } }));
    const res = await exchange(app);
    expect(res.statusCode).toBe(401);
    expect(await userCount(app)).toBe(0);
  });

  it('maps a Google 5xx reply to 502', async () => {
    google.handle(() => ({ status: 503, body: { error: 'backend_error' } }));
    const res = await exchange(app);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: { code: 'GOOGLE_UPSTREAM_ERROR', message: expect.any(String) },
    });
    expect(await userCount(app)).toBe(0);
  });

  it('maps a 200 reply without an id_token to 502', async () => {
    google.handle(() => ({ status: 200, body: { access_token: UPSTREAM_ACCESS } }));
    const res = await exchange(app);
    expect(res.statusCode).toBe(502);
    expect(await userCount(app)).toBe(0);
  });

  it('never logs codes, verifiers, the client secret, or token values', async () => {
    capture.lines.length = 0;
    await exchange(app);
    await exchange(app, {
      code: 'bad-code-value-xyz',
      codeVerifier: VERIFIER,
      redirectUri: REDIRECT_URI,
    });
    google.handle(() => ({ status: 500, body: { error: 'oops' } }));
    await exchange(app);
    google.reset();
    await app.inject({
      method: 'POST',
      url: `/__test/careless-code-log?code=${VALID_CODE}`,
      payload: { code: VALID_CODE, codeVerifier: VERIFIER },
    });

    const output = capture.text();
    expect(output).toContain('request completed');
    expect(output).toContain('careless exchange log');
    expect(output).toContain('[REDACTED]');
    for (const secret of [
      VALID_CODE,
      'bad-code-value-xyz',
      VERIFIER,
      FAKE_SECRET,
      UPSTREAM_ACCESS,
      UPSTREAM_REFRESH,
      'upstream-id-token-value',
    ]) {
      expect(output).not.toContain(secret);
    }
  });
});

describe('POST /auth/google/code without a configured secret', () => {
  let app: FastifyInstance;
  let google: TestGoogleTokenEndpoint;

  beforeAll(async () => {
    google = await startTestGoogleTokenEndpoint(() => ({ status: 500, body: {} }));
    app = await buildTestApp({ env: { GOOGLE_TOKEN_URL: google.url, GOOGLE_CLIENT_SECRET: '' } });
  });

  afterAll(async () => {
    await app.close();
    await google.close();
  });

  it('answers 503 and never contacts Google', async () => {
    await truncateAll(app.db);
    const res = await exchange(app);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: { code: 'GOOGLE_EXCHANGE_UNAVAILABLE', message: expect.any(String) },
    });
    expect(google.received).toHaveLength(0);
    expect(await userCount(app)).toBe(0);
  });

  it('still rejects a disallowed redirectUri with 400', async () => {
    const res = await exchange(app, {
      code: VALID_CODE,
      codeVerifier: VERIFIER,
      redirectUri: 'https://evil.example.com',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /auth/google/code with an unreachable token endpoint', () => {
  let app: FastifyInstance;
  const capture = createLogCapture();

  beforeAll(async () => {
    app = await buildTestApp({
      logger: capture,
      env: { GOOGLE_TOKEN_URL: 'http://127.0.0.1:1/token', GOOGLE_CLIENT_SECRET: FAKE_SECRET },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 502 without leaking exchange parameters into logs', async () => {
    await truncateAll(app.db);
    const res = await exchange(app);
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('GOOGLE_UPSTREAM_ERROR');
    expect(await userCount(app)).toBe(0);

    const output = capture.text();
    expect(output).toContain('google token exchange failed');
    for (const secret of [VALID_CODE, VERIFIER, FAKE_SECRET]) {
      expect(output).not.toContain(secret);
    }
  });
});

describe('google code exchange config', () => {
  it('defaults the token URL and allowlist, and treats an empty secret as unset', async () => {
    const { testConfig } = await import('./helpers.js');
    const config = testConfig({ GOOGLE_CLIENT_SECRET: '' });
    expect(config.GOOGLE_TOKEN_URL).toBe('https://oauth2.googleapis.com/token');
    expect(config.GOOGLE_REDIRECT_ALLOWLIST).toEqual(['http://localhost:8081']);
    expect(config.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(
      testConfig({ GOOGLE_REDIRECT_ALLOWLIST: ' http://a , ,exp://b ' }).GOOGLE_REDIRECT_ALLOWLIST,
    ).toEqual(['http://a', 'exp://b']);
  });
});
