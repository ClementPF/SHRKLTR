import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with a database probe reporting up', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', database: 'up' });
  });

  it('sets security headers and allows the Expo web origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:8081' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not allow other origins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://evil.example' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS_ORIGINS', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({
      env: { CORS_ORIGINS: 'https://app.example.com, https://other.example.com' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['https://app.example.com', 'https://other.example.com'])(
    'allows the configured origin %s',
    async (origin) => {
      const res = await app.inject({ method: 'GET', url: '/health', headers: { origin } });
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    },
  );

  it('drops the localhost default once origins are configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:8081' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('GET /health with the database down', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({
      env: { DATABASE_URL: 'postgres://sharkulator:sharkulator@127.0.0.1:1/unreachable' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 503 with database down', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', database: 'down' });
  });
});
