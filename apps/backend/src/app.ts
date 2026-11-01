import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { createDb } from './db/client.js';

export interface BuildAppOptions {
  databaseUrl: string;
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? true,
  });

  const db = createDb(opts.databaseUrl);
  app.addHook('onClose', async () => {
    await db.$client.end({ timeout: 5 });
  });

  app.get('/health', async (_request, reply) => {
    let database: 'up' | 'down' = 'up';
    try {
      await db.execute(sql`select 1`);
    } catch (err) {
      app.log.warn({ err }, 'database probe failed');
      database = 'down';
    }
    const status = database === 'up' ? 'ok' : 'degraded';
    return reply.code(database === 'up' ? 200 : 503).send({ status, database });
  });

  return app;
}
