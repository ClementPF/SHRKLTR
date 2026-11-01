import { z } from 'zod';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { issueSession } from '../auth/jwt.js';
import type { GoogleTokenVerifier } from '../auth/google.verify.js';
import { errorResponseSchema } from '../lib/errors.js';
import { toUserDto, userDtoSchema } from '../lib/serializers.js';
import { upsertGoogleUser } from '../services/user.service.js';

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
};
