import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RESERVED_USERNAMES } from '../src/services/user.service.js';
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

  it('reserves every static segment that shadows /users/{username}', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json();
    const staticSegments = Object.keys(doc.paths)
      .map((p) => p.split('/'))
      .filter((parts) => parts[1] === 'users' && parts[2] && !parts[2].startsWith('{'))
      .map((parts) => parts[2] as string);
    expect(staticSegments).toContain('me');
    for (const segment of staticSegments) expect(RESERVED_USERNAMES.has(segment)).toBe(true);
  });

  it('documents every route group with zod-derived schemas', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json();
    const paths = Object.keys(doc.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/auth/token',
        '/auth/refresh',
        '/auth/logout',
        '/auth/dev-token',
        '/users',
        '/users/me',
        '/users/{username}',
        '/users/{username}/stats',
        '/users/{username}/rivalries',
        '/users/{username}/tournaments',
        '/users/{username}/games',
        '/users/me/push-token',
        '/users/{username}/challenge',
        '/sports',
        '/tournaments',
        '/tournaments/{name}',
        '/tournaments/{name}/users',
        '/tournaments/{name}/stats',
        '/tournaments/{name}/games',
        '/tournaments/{name}/rivalries',
        '/games/{id}',
        '/players/placeholders',
        '/players/invited',
        '/players/{id}/claim-link',
        '/invites/claim/{token}',
        '/invites/app',
        '/invites/app/{token}',
        '/stats',
        '/rivalries',
        '/rivalry',
      ]),
    );
    const games = doc.paths['/tournaments/{name}/games'];
    expect(games.post.requestBody.content['application/json'].schema.$ref).toMatch(
      /^#\/components\/schemas\/SubmitGameRequest/,
    );
    expect(games.get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: 'query', name: 'page' }),
        expect.objectContaining({
          in: 'query',
          name: 'pageSize',
          schema: expect.objectContaining({ maximum: 100 }),
        }),
      ]),
    );
    expect(games.get.responses['200'].content['application/json'].schema.items.$ref).toBe(
      '#/components/schemas/Game',
    );
    expect(
      doc.paths['/games/{id}'].get.responses['200'].content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/Game');
    expect(doc.components.schemas.Outcome.properties.ratingBefore).toBeDefined();
    expect(doc.components.schemas.User.properties.accountType.enum).toEqual([
      'REGISTERED',
      'PLACEHOLDER',
    ]);
    expect(doc.components.schemas.TokenRequest.properties.claimToken).toBeDefined();
    expect(doc.components.schemas.GoogleCodeExchangeRequest.properties.claimToken).toBeDefined();
    expect(doc.paths['/invites/claim/{token}'].get.security).toBeUndefined();
    expect(doc.paths['/invites/app'].post.security).toEqual([{ bearerAuth: [] }]);
    for (const schema of [
      'Game',
      'Outcome',
      'Stats',
      'RivalryStats',
      'User',
      'Tournament',
      'PlaceholderClaimLink',
      'InvitedPlayer',
      'ClaimPreview',
      'AppInvite',
      'AppInvitePreview',
    ]) {
      expect(doc.components.schemas[schema]).toBeDefined();
    }
    const tags = new Set(
      Object.values(doc.paths).flatMap((ops) =>
        Object.values(ops as Record<string, { tags?: string[] }>).flatMap((op) => op.tags ?? []),
      ),
    );
    expect([...tags]).toEqual(
      expect.arrayContaining([
        'auth',
        'users',
        'sports',
        'tournaments',
        'games',
        'stats',
        'players',
        'invites',
      ]),
    );
  });
});
