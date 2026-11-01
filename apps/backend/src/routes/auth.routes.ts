import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { issueSession } from '../auth/jwt.js';
import type { GoogleTokenVerifier } from '../auth/google.verify.js';
import { ApiError, errorResponseSchema } from '../lib/errors.js';
import { toUserDto, userDtoSchema } from '../lib/serializers.js';
import { logoutSession, rotateSession } from '../services/session.service.js';
import { findUserByUsername, upsertGoogleUser } from '../services/user.service.js';

const tokenRequestSchema = z
  .object({
    provider: z.literal('google'),
    idToken: z.string().min(1),
  })
  .meta({ id: 'TokenRequest' });

export const sessionResponseSchema = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    user: userDtoSchema,
  })
  .meta({ id: 'SessionResponse' });

const refreshRequestSchema = z
  .object({ refreshToken: z.string().min(1) })
  .meta({ id: 'RefreshRequest' });

export const tokenPairSchema = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
  })
  .meta({ id: 'TokenPair' });

const devTokenRequestSchema = z
  .object({ username: z.string().min(1) })
  .meta({ id: 'DevTokenRequest' });

function secretsMatch(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AuthRoutesOptions {
  verifyGoogleIdToken: GoogleTokenVerifier;
}

export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (app, opts) => {
  app.post(
    '/auth/token',
    {
      schema: {
        tags: ['auth'],
        summary: 'Exchange a Google ID token for a backend session',
        body: tokenRequestSchema,
        response: {
          200: sessionResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const identity = await opts.verifyGoogleIdToken(request.body.idToken);
      const user = await upsertGoogleUser(app.db, identity);
      const tokens = await issueSession(app, app.db, user.id);
      return { ...tokens, user: toUserDto(user) };
    },
  );

  app.post(
    '/auth/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Rotate a refresh token into a new token pair',
        description:
          'The presented refresh token is consumed. Reusing a consumed token revokes its whole family.',
        body: refreshRequestSchema,
        response: {
          200: tokenPairSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => rotateSession(app, request.body.refreshToken),
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke the session family of a refresh token',
        body: refreshRequestSchema,
        response: {
          204: z.null().describe('Session revoked'),
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      await logoutSession(app, request.body.refreshToken);
      return reply.code(204).send(null);
    },
  );

  // Never registered in production, so the route is indistinguishable from an unknown path.
  if (app.config.APP_ENV !== 'production') {
    app.post(
      '/auth/dev-token',
      {
        schema: {
          tags: ['auth'],
          summary: 'Development only: issue a session for an existing user',
          description: 'Requires the x-dev-auth header to match DEV_AUTH_SECRET; 404 otherwise.',
          body: devTokenRequestSchema,
          response: {
            200: sessionResponseSchema,
            400: errorResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => {
        if (!secretsMatch(request.headers['x-dev-auth'], app.config.DEV_AUTH_SECRET)) {
          throw ApiError.notFound('Route POST /auth/dev-token not found');
        }
        const user = await findUserByUsername(app.db, request.body.username);
        if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
        const tokens = await issueSession(app, app.db, user.id);
        return { ...tokens, user: toUserDto(user) };
      },
    );
  }
};
