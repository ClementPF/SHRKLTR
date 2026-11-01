import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';

const PROBE_TIMEOUT_MS = 3000;

const healthResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    database: z.enum(['up', 'down']),
  })
  .meta({ id: 'HealthResponse' });

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness and database connectivity probe',
        response: { 200: healthResponseSchema, 503: healthResponseSchema },
      },
    },
    async (request, reply) => {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('database probe timed out')), PROBE_TIMEOUT_MS);
      });
      try {
        await Promise.race([app.db.execute(sql`select 1`), timeout]);
        return reply.code(200).send({ status: 'ok', database: 'up' });
      } catch (err) {
        request.log.warn({ err }, 'database probe failed');
        return reply.code(503).send({ status: 'degraded', database: 'down' });
      } finally {
        clearTimeout(timer);
      }
    },
  );
};
