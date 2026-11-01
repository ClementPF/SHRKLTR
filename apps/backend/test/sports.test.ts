import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sports } from '../src/db/schema.js';
import { authHeadersFor, buildTestApp, createSport, createUser, truncateAll } from './helpers.js';

describe('sport routes', () => {
  let app: FastifyInstance;
  let headers: { authorization: string };

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    const user = await createUser(app.db);
    headers = await authHeadersFor(app, user.id);
  });

  describe('authentication', () => {
    it.each([
      ['GET', '/sports'],
      ['POST', '/sports'],
    ] as const)('%s %s without a token → 401', async (method, url) => {
      const res = await app.inject({ method, url, payload: method === 'GET' ? undefined : {} });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('VAL-TOURN-001: GET /sports', () => {
    it('returns an empty array when no sport exists', async () => {
      const res = await app.inject({ method: 'GET', url: '/sports', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('lists every sport as a camelCase {id, name} DTO sorted by name', async () => {
      const pingpong = await createSport(app.db, { name: 'pingpong' });
      const babyfoot = await createSport(app.db, { name: 'babyfoot' });
      const res = await app.inject({ method: 'GET', url: '/sports', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        { id: babyfoot.id, name: 'babyfoot' },
        { id: pingpong.id, name: 'pingpong' },
      ]);
    });
  });

  describe('VAL-TOURN-001: POST /sports', () => {
    it('creates a sport → 201 and it appears in the list', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/sports',
        headers,
        payload: { name: 'babyfoot' },
      });
      expect(res.statusCode).toBe(201);
      const created = res.json();
      expect(created).toEqual({ id: expect.any(String), name: 'babyfoot' });
      expect(Object.keys(created).sort()).toEqual(['id', 'name']);

      const rows = await app.db.select().from(sports);
      expect(rows).toEqual([{ id: created.id, name: 'babyfoot' }]);

      const list = await app.inject({ method: 'GET', url: '/sports', headers });
      expect(list.json()).toEqual([created]);
    });

    it('trims the submitted name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/sports',
        headers,
        payload: { name: '  billard  ' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe('billard');
    });

    it('rejects a duplicate name with 400 (legacy returned 500)', async () => {
      await createSport(app.db, { name: 'babyfoot' });
      const res = await app.inject({
        method: 'POST',
        url: '/sports',
        headers,
        payload: { name: 'babyfoot' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: { code: 'SPORT_ALREADY_EXISTS', message: expect.any(String) },
      });
      expect(await app.db.select().from(sports)).toHaveLength(1);
    });

    it.each([
      ['missing name', {}],
      ['empty name', { name: '' }],
      ['blank name', { name: '   ' }],
      ['non-string name', { name: 42 }],
    ])('rejects %s with 400 VALIDATION_ERROR', async (_label, payload) => {
      const res = await app.inject({ method: 'POST', url: '/sports', headers, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      expect(await app.db.select().from(sports)).toHaveLength(0);
    });
  });
});
