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
import { createGoogleCodeExchanger } from './auth/google.code.js';
import { createGoogleVerifier } from './auth/google.verify.js';
import { registerJwt } from './auth/jwt.js';
import { authGuard } from './auth/guard.js';
import { createPushNotifier, type PushNotifier } from './services/push.service.js';
import { notificationRoutes } from './routes/notifications.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { gameRoutes } from './routes/games.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { inviteRoutes } from './routes/invites.routes.js';
import { playerRoutes } from './routes/players.routes.js';
import { sportRoutes } from './routes/sports.routes.js';
import { statsRoutes } from './routes/stats.routes.js';
import { tournamentRoutes } from './routes/tournaments.routes.js';
import { userRoutes } from './routes/users.routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: Database;
    /** Current time for domain rules (expiries); injectable in tests. */
    clock: () => Date;
    /** Post-commit, best-effort Expo push delivery. */
    push: PushNotifier;
  }
}

// Tournament slugs come from displayNames of up to 100 chars, and lowercasing can double a
// char's UTF-16 length (U+0130 → "i" + U+0307), so decoded path params may reach 200 units.
export const MAX_PARAM_LENGTH = 200;

export interface BuildAppOptions {
  config: AppConfig;
  /** false disables logging; a destination captures log lines (tests). Defaults to stdout. */
  logger?: boolean | LogDestination;
  /** Defaults to the system clock. */
  clock?: () => Date;
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
    routerOptions: { maxParamLength: MAX_PARAM_LENGTH },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  const db = createDb(config.DATABASE_URL);
  app.decorate('config', config);
  app.decorate('db', db);
  const clock = opts.clock ?? (() => new Date());
  app.decorate('clock', clock);
  const push = createPushNotifier({
    db,
    transport: {
      url: config.PUSH_URL,
      accessToken: config.EXPO_ACCESS_TOKEN,
      timeoutMs: config.PUSH_TIMEOUT_MS,
    },
    log: app.log,
    clock,
  });
  app.decorate('push', push);
  app.addHook('onClose', async () => {
    // In-flight deliveries still write device state, so they finish before the pool closes.
    await push.drain();
    await db.$client.end({ timeout: 5 });
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
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
    exchangeGoogleCode: createGoogleCodeExchanger({
      tokenUrl: config.GOOGLE_TOKEN_URL,
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      redirectAllowlist: config.GOOGLE_REDIRECT_ALLOWLIST,
    }),
  });
  await app.register(userRoutes);
  await app.register(sportRoutes);
  await app.register(tournamentRoutes);
  await app.register(statsRoutes);
  await app.register(gameRoutes);
  await app.register(playerRoutes);
  await app.register(inviteRoutes);
  await app.register(notificationRoutes);

  return app;
}
