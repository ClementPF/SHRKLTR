import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from '@fastify/type-provider-zod';
import type { AppConfig } from './config.js';
import { createDb, type Database } from './db/client.js';
import { frameworkErrorHandler, registerErrorHandling } from './lib/errors.js';
import { buildLoggerOptions, type LogDestination } from './lib/logger.js';
import { createGoogleVerifier } from './auth/google.verify.js';
import { registerJwt } from './auth/jwt.js';
import { authGuard } from './auth/guard.js';
import { authRoutes } from './routes/auth.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { userRoutes } from './routes/users.routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: Database;
  }
}

export const CORS_ORIGINS = ['http://localhost:8081'];

export interface BuildAppOptions {
  config: AppConfig;
  /** false disables logging; a destination captures log lines (tests). Defaults to stdout. */
  logger?: boolean | LogDestination;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = opts;
  const logger =
    opts.logger === false
      ? false
      : buildLoggerOptions(config, opts.logger === true ? undefined : opts.logger);

  const app = Fastify({
    logger,
    frameworkErrors: frameworkErrorHandler,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  const db = createDb(config.DATABASE_URL);
  app.decorate('config', config);
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await db.$client.end({ timeout: 5 });
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: CORS_ORIGINS,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Sharkulator API', version: '1.0.0' },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
    // Emits schemas registered with .meta({ id }) under components.schemas so $refs resolve.
    transformObject: jsonSchemaTransformObject,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await registerJwt(app, config);
  await app.register(authGuard);

  await app.register(healthRoutes);
  await app.register(authRoutes, {
    verifyGoogleIdToken: createGoogleVerifier({
      jwksUrl: config.GOOGLE_JWKS_URL,
      clientId: config.GOOGLE_CLIENT_ID,
    }),
  });
  await app.register(userRoutes);

  return app;
}
