import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

const preflight = (app: FastifyInstance, origin: string) =>
  app.inject({
    method: 'OPTIONS',
    url: '/users/me',
    headers: {
      origin,
      'access-control-request-method': 'PUT',
      'access-control-request-headers': 'authorization,content-type',
    },
  });

describe('VAL-INVITE-006: CORS exact-origin allowlist', () => {
  describe('with the default CORS_ORIGINS', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('allows the local web origin with the requested method and headers', async () => {
      const res = await preflight(app, 'http://localhost:8081');
      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8081');
      expect(res.headers['access-control-allow-methods']).toContain('PUT');
      expect(String(res.headers['access-control-allow-headers'])).toMatch(/authorization/i);
      expect(String(res.headers['access-control-allow-headers'])).toMatch(/content-type/i);
    });

    it.each([
      'http://localhost:3000',
      'http://localhost:8081.evil.example',
      'http://evil-localhost:8081',
      'https://localhost:8081',
    ])('gives no allow-origin to %s', async (origin) => {
      const res = await preflight(app, origin);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('with a configured CORS_ORIGINS list', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp({
        env: { CORS_ORIGINS: 'https://shrkltr.example.test,http://192.168.1.20:8081' },
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it.each(['https://shrkltr.example.test', 'http://192.168.1.20:8081'])(
      'allows the configured origin %s',
      async (origin) => {
        const res = await preflight(app, origin);
        expect(res.statusCode).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe(origin);
      },
    );

    it.each([
      'http://localhost:8081',
      'https://shrkltr.example.test.evil.example',
      'https://evilshrkltr.example.test',
    ])('rejects the unlisted origin %s', async (origin) => {
      const res = await preflight(app, origin);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('adds the allow-origin header to actual responses only for listed origins', async () => {
      const allowed = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://shrkltr.example.test' },
      });
      expect(allowed.headers['access-control-allow-origin']).toBe('https://shrkltr.example.test');
      const denied = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'http://localhost:8081' },
      });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
