import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema.js';
import { authHeadersFor, buildTestApp, createUser, truncateAll } from './helpers.js';

describe('user routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
  });

  const fullProfile = {
    username: 'jean-dupont',
    firstName: 'Jean',
    lastName: 'Dupont',
    pictureUrl: 'https://example.com/jean.png',
    locale: 'fr',
    email: 'jean@example.com',
    googleSub: 'google-sub-jean',
  };

  async function rowOf(id: string) {
    const [row] = await app.db.select().from(users).where(eq(users.id, id));
    if (!row) throw new Error('user row missing');
    return row;
  }

  describe('authentication', () => {
    it.each([
      ['GET', '/users'],
      ['GET', '/users/me'],
      ['GET', '/users/someone'],
      ['PUT', '/users/me'],
      ['POST', '/users/me/push-token'],
    ] as const)('%s %s without a token → 401', async (method, url) => {
      const res = await app.inject({ method, url, payload: method === 'GET' ? undefined : {} });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('VAL-USERS-001: GET /users/me', () => {
    it('returns the authenticated user profile as a camelCase DTO', async () => {
      const me = await createUser(app.db, fullProfile);
      await createUser(app.db);
      const res = await app.inject({
        method: 'GET',
        url: '/users/me',
        headers: await authHeadersFor(app, me.id),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id: me.id,
        username: 'jean-dupont',
        accountType: 'REGISTERED',
        firstName: 'Jean',
        lastName: 'Dupont',
        pictureUrl: 'https://example.com/jean.png',
        locale: 'fr',
      });
    });

    it('returns 401 when the token belongs to a user that no longer exists', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/users/me',
        headers: await authHeadersFor(app, '00000000-0000-4000-8000-000000000000'),
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('VAL-USERS-002: user lookups', () => {
    it('GET /users lists every user without private fields', async () => {
      const a = await createUser(app.db, fullProfile);
      const b = await createUser(app.db, { username: 'marie' });
      const c = await createUser(app.db, { username: 'zoe', pushToken: 'ExponentPushToken[x]' });
      const res = await app.inject({
        method: 'GET',
        url: '/users',
        headers: await authHeadersFor(app, a.id),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>[]>();
      expect(body).toHaveLength(3);
      expect(body.map((u) => u.id).sort()).toEqual([a.id, b.id, c.id].sort());
      for (const u of body) {
        expect(Object.keys(u).sort()).toEqual(
          ['accountType', 'firstName', 'id', 'lastName', 'locale', 'pictureUrl', 'username'].sort(),
        );
      }
    });

    it('GET /users/:username preserves every public field', async () => {
      const target = await createUser(app.db, fullProfile);
      const caller = await createUser(app.db);
      const res = await app.inject({
        method: 'GET',
        url: '/users/jean-dupont',
        headers: await authHeadersFor(app, caller.id),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(target.id);
      expect(body.username).toBe('jean-dupont');
      expect(body.firstName).toBe('Jean');
      expect(body.lastName).toBe('Dupont');
      expect(body.pictureUrl).toBe('https://example.com/jean.png');
      expect(body.locale).toBe('fr');
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('googleSub');
      expect(body).not.toHaveProperty('pushToken');
    });

    it('GET /users/:username for an unknown user → 404', async () => {
      const caller = await createUser(app.db);
      const res = await app.inject({
        method: 'GET',
        url: '/users/nobody-here',
        headers: await authHeadersFor(app, caller.id),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        error: { code: 'USER_NOT_FOUND', message: expect.any(String) },
      });
    });
  });

  describe('VAL-USERS-003: PUT /users/me', () => {
    it('updates firstName, lastName, locale and pictureUrl', async () => {
      const me = await createUser(app.db, fullProfile);
      const res = await app.inject({
        method: 'PUT',
        url: '/users/me',
        headers: await authHeadersFor(app, me.id),
        payload: {
          firstName: 'Jeanne',
          lastName: 'Durand',
          locale: 'en',
          pictureUrl: 'https://example.com/new.png',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id: me.id,
        username: 'jean-dupont',
        accountType: 'REGISTERED',
        firstName: 'Jeanne',
        lastName: 'Durand',
        locale: 'en',
        pictureUrl: 'https://example.com/new.png',
      });
      const row = await rowOf(me.id);
      expect(row.firstName).toBe('Jeanne');
      expect(row.lastName).toBe('Durand');
      expect(row.locale).toBe('en');
      expect(row.pictureUrl).toBe('https://example.com/new.png');
      expect(row.username).toBe('jean-dupont');
      expect(row.googleSub).toBe('google-sub-jean');
    });

    it('leaves omitted fields unchanged on a partial update', async () => {
      const me = await createUser(app.db, fullProfile);
      const res = await app.inject({
        method: 'PUT',
        url: '/users/me',
        headers: await authHeadersFor(app, me.id),
        payload: { locale: 'de' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ firstName: 'Jean', lastName: 'Dupont', locale: 'de' });
    });

    // The schema is strict: immutable fields are rejected with 400, not silently dropped.
    it.each([
      ['username', { username: 'hijack' }],
      ['googleSub', { googleSub: 'other-sub' }],
      ['username alongside allowed fields', { firstName: 'X', username: 'hijack' }],
    ])('rejects %s with 400 and changes nothing', async (_label, payload) => {
      const me = await createUser(app.db, fullProfile);
      const res = await app.inject({
        method: 'PUT',
        url: '/users/me',
        headers: await authHeadersFor(app, me.id),
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      const row = await rowOf(me.id);
      expect(row.username).toBe('jean-dupont');
      expect(row.googleSub).toBe('google-sub-jean');
      expect(row.firstName).toBe('Jean');
    });

    it('rejects invalid field values with 400', async () => {
      const me = await createUser(app.db, fullProfile);
      const res = await app.inject({
        method: 'PUT',
        url: '/users/me',
        headers: await authHeadersFor(app, me.id),
        payload: { firstName: '', pictureUrl: 'not a url' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('VAL-USERS-004: POST /users/me/push-token', () => {
    it('stores the token on the authenticated user row (latest wins)', async () => {
      const me = await createUser(app.db);
      const other = await createUser(app.db);
      const headers = await authHeadersFor(app, me.id);

      const first = await app.inject({
        method: 'POST',
        url: '/users/me/push-token',
        headers,
        payload: { value: 'ExponentPushToken[first]' },
      });
      expect(first.statusCode).toBe(204);
      expect((await rowOf(me.id)).pushToken).toBe('ExponentPushToken[first]');

      const second = await app.inject({
        method: 'POST',
        url: '/users/me/push-token',
        headers,
        payload: { value: 'ExponentPushToken[second]' },
      });
      expect(second.statusCode).toBe(204);
      expect((await rowOf(me.id)).pushToken).toBe('ExponentPushToken[second]');
      expect((await rowOf(other.id)).pushToken).toBeNull();
    });

    it('does not expose the push token in the user DTO', async () => {
      const me = await createUser(app.db, { pushToken: 'ExponentPushToken[secret]' });
      const res = await app.inject({
        method: 'GET',
        url: '/users/me',
        headers: await authHeadersFor(app, me.id),
      });
      expect(res.json()).not.toHaveProperty('pushToken');
    });

    it('rejects a missing or empty value with 400', async () => {
      const me = await createUser(app.db);
      const headers = await authHeadersFor(app, me.id);
      for (const payload of [{}, { value: '' }]) {
        const res = await app.inject({
          method: 'POST',
          url: '/users/me/push-token',
          headers,
          payload,
        });
        expect(res.statusCode).toBe(400);
      }
      expect((await rowOf(me.id)).pushToken).toBeNull();
    });
  });
});
