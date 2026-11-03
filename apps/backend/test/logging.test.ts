import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redactUrl } from '../src/lib/logger.js';
import { buildTestApp, createLogCapture } from './helpers.js';

const ACCESS = 'eyJhbGciOiJIUzI1NiJ9.access-token-secret-value.sig';
const REFRESH = 'eyJhbGciOiJIUzI1NiJ9.refresh-token-secret-value.sig';

describe('log redaction', () => {
  let app: FastifyInstance;
  const capture = createLogCapture();

  beforeAll(async () => {
    app = await buildTestApp({ logger: capture });
    app
      .withTypeProvider<ZodTypeProvider>()
      .post(
        '/__test/session',
        { schema: { body: z.object({ refreshToken: z.string() }) } },
        async (req) => {
          // Simulates a careless log statement in a handler.
          req.log.info(
            { headers: req.headers, body: req.body, refreshToken: req.body.refreshToken },
            'handling session',
          );
          return { ok: true };
        },
      );
    app.get('/__test/fail', async () => {
      throw new Error('boom');
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('never writes Authorization headers or token strings', async () => {
    const authorization = `Bearer ${ACCESS}`;
    await app.inject({ method: 'GET', url: '/health', headers: { authorization } });
    await app.inject({
      method: 'POST',
      url: '/__test/session',
      headers: { authorization, 'x-dev-auth': 'dev-secret-header-value' },
      payload: { refreshToken: REFRESH },
    });
    await app.inject({
      method: 'GET',
      url: `/__test/fail?token=${ACCESS}`,
      headers: { authorization },
    });

    const output = capture.text();
    expect(output).toContain('request completed');
    expect(output).toContain('handling session');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain(ACCESS);
    expect(output).not.toContain(REFRESH);
    expect(output).not.toContain('access-token-secret-value');
    expect(output).not.toContain('dev-secret-header-value');
    expect(output).not.toMatch(/Bearer /);
  });

  it('redacts token-like query parameters', () => {
    expect(redactUrl('/x?token=abc&page=2')).toBe('/x?token=%5BREDACTED%5D&page=2');
    expect(redactUrl('/x?page=2')).toBe('/x?page=2');
    expect(redactUrl('/x')).toBe('/x');
  });
});
