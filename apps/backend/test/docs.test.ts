import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

describe('API docs', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    app.withTypeProvider<ZodTypeProvider>().post(
      '/__test/widgets/:name',
      {
        schema: {
          params: z.object({ name: z.string() }),
          body: z.object({ size: z.number().int().min(1) }),
          response: { 201: z.object({ id: z.uuid() }) },
        },
      },
      async (_req, reply) => reply.code(201).send({ id: crypto.randomUUID() }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves Swagger UI at /docs', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('swagger');
  });

  it('serves an OpenAPI document derived from the zod schemas', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toMatch(/^3\./);
    const healthRef =
      doc.paths['/health'].get.responses['200'].content['application/json'].schema.$ref;
    expect(healthRef).toBe('#/components/schemas/HealthResponse');
    expect(doc.components.schemas.HealthResponse.properties.status.enum).toEqual([
      'ok',
      'degraded',
    ]);

    const widget = doc.paths['/__test/widgets/{name}'].post;
    expect(widget.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ in: 'path', name: 'name' })]),
    );
    const bodySchema = widget.requestBody.content['application/json'].schema;
    expect(bodySchema.properties.size).toMatchObject({ type: 'integer', minimum: 1 });
    expect(bodySchema.required).toEqual(['size']);
    expect(widget.responses['201']).toBeDefined();
    expect(Object.keys(doc.paths).some((p) => p.startsWith('/docs'))).toBe(false);
  });
});
