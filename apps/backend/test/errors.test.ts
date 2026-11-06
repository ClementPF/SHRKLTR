import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/errors.js';
import { buildTestApp } from './helpers.js';

const envelope = z
  .object({
    error: z.object({ code: z.string().min(1), message: z.string().min(1) }).strict(),
  })
  .strict();

describe('error envelope', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    const typed = app.withTypeProvider<ZodTypeProvider>();
    typed.post(
      '/__test/echo',
      {
        schema: {
          body: z.object({ name: z.string().min(1), count: z.number().int() }),
          querystring: z.object({ mode: z.enum(['a', 'b']).optional() }),
          response: { 200: z.object({ name: z.string(), count: z.number() }) },
        },
      },
      async (req) => req.body,
    );
    typed.get('/__test/api-error', async () => {
      throw new ApiError(403, 'NOT_OWNER', 'Only the owner can do that');
    });
    typed.get('/__test/boom', async () => {
      throw new Error('secret internal detail');
    });
    typed.get(
      '/__test/bad-response',
      { schema: { response: { 200: z.object({ ok: z.boolean() }) } } },
      // Deliberately violates the response schema.
      async () => ({ ok: 'yes' }) as unknown as { ok: boolean },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('passes valid bodies through the zod validator', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      payload: { name: 'sam', count: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'sam', count: 2 });
  });

  it('returns 400 VALIDATION_ERROR for an invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      payload: { name: '', count: 'two' },
    });
    expect(res.statusCode).toBe(400);
    const body = envelope.parse(res.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/body/);
  });

  it('returns 400 VALIDATION_ERROR for an invalid querystring', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/__test/echo?mode=c',
      payload: { name: 'sam', count: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(envelope.parse(res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 in the envelope for malformed JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"name":',
    });
    expect(res.statusCode).toBe(400);
    expect(envelope.parse(res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('maps ApiError to its status and code', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/api-error' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'NOT_OWNER', message: 'Only the owner can do that' },
    });
  });

  it('maps unexpected errors to 500 without leaking details', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  it('maps response serialization failures to 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/bad-response' });
    expect(res.statusCode).toBe(500);
    expect(envelope.parse(res.json()).error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 404 in the same envelope for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/does-not-exist?x=1' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /does-not-exist not found' },
    });
  });

  it('returns 400 in the envelope for a malformed URL', async () => {
    const res = await app.inject({ method: 'GET', url: '/%world' });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(envelope.parse(res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 in the envelope for a preflight missing Access-Control-Request-Method', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: 'http://localhost:8083' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Invalid CORS preflight request' },
    });
  });

  it('returns 400 in the envelope for a preflight missing Origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { 'access-control-request-method': 'GET' },
    });
    expect(res.statusCode).toBe(400);
    expect(envelope.parse(res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('still answers valid preflights with 204 and CORS headers', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: 'http://localhost:8083', 'access-control-request-method': 'GET' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8083');
    expect(res.headers['access-control-allow-methods']).toContain('GET');
  });
});
