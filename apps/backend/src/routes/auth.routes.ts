import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { issueSession } from '../auth/jwt.js';
import type { GoogleCodeExchanger } from '../auth/google.code.js';
import type { GoogleTokenVerifier } from '../auth/google.verify.js';
import { ApiError, errorResponseSchema } from '../lib/errors.js';
import { toUserDto, userDtoSchema } from '../lib/serializers.js';
import { signInWithGoogle } from '../services/google-account.service.js';
import { logoutSession, rotateSession } from '../services/session.service.js';
import { findUserByUsername } from '../services/user.service.js';

const claimTokenSchema = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe(
    'Token from a placeholder claim link. Binds a Google account that is new to Sharkulator ' +
      'to the placeholder; an existing account gets 400 CLAIM_REQUIRES_NEW_ACCOUNT.',
  );

const tokenRequestSchema = z
  .object({
    provider: z.literal('google'),
    idToken: z.string().min(1),
    claimToken: claimTokenSchema,
  })
  .meta({ id: 'TokenRequest' });

// RFC 7636: 43-128 characters from the unreserved set.
const codeExchangeRequestSchema = z
  .object({
    code: z.string().min(1).max(2048),
    codeVerifier: z
      .string()
      .min(43)
      .max(128)
      .regex(/^[A-Za-z0-9\-._~]+$/),
    redirectUri: z.string().min(1).max(2048),
    claimToken: claimTokenSchema,
  })
  .meta({ id: 'GoogleCodeExchangeRequest' });

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
  exchangeGoogleCode: GoogleCodeExchanger;
}

export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (app, opts) => {
  /**
   * The single Google sign-in path: verify the ID token, then log in, provision, or claim a
   * placeholder, issuing the session in the same transaction.
   */
  async function sessionForGoogleIdToken(idToken: string, claimToken: string | undefined) {
    const identity = await opts.verifyGoogleIdToken(idToken);
    const { user, ...tokens } = await signInWithGoogle(app, identity, {
      claimToken,
      now: app.clock(),
    });
    return { ...tokens, user: toUserDto(user) };
  }

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
    async (request) => sessionForGoogleIdToken(request.body.idToken, request.body.claimToken),
  );

  app.post(
    '/auth/google/code',
    {
      schema: {
        tags: ['auth'],
        summary: 'Exchange a Google authorization code (PKCE) for a backend session',
        description:
          'The server redeems the code at Google with its client secret, then verifies the returned ID token exactly like POST /auth/token. redirectUri must match an allowlisted URI.',
        body: codeExchangeRequestSchema,
        response: {
          200: sessionResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          502: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request) =>
      sessionForGoogleIdToken(
        await opts.exchangeGoogleCode(request.body, request.log),
        request.body.claimToken,
      ),
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
          description:
            'Requires the x-dev-auth header to match DEV_AUTH_SECRET; 404 otherwise. ' +
            'Placeholder players cannot sign in (403 PLACEHOLDER_CANNOT_SIGN_IN).',
          body: devTokenRequestSchema,
          response: {
            200: sessionResponseSchema,
            400: errorResponseSchema,
            403: errorResponseSchema,
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
        if (user.accountType !== 'REGISTERED') {
          throw ApiError.forbidden(
            'Placeholder players cannot sign in until their profile is claimed',
            'PLACEHOLDER_CANNOT_SIGN_IN',
          );
        }
        const tokens = await issueSession(app, app.db, user.id);
        return { ...tokens, user: toUserDto(user) };
      },
    );
  }
};
