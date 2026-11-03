import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../lib/errors.js';
import type { AccessTokenPayload } from './jwt.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/**
 * `authenticate` accepts only access tokens: they are verified with the access secret and must
 * carry typ 'access', so a refresh token can never authorize an API call.
 */
export const authGuard = fp(
  async (app) => {
    app.decorate('authenticate', async (request: FastifyRequest) => {
      const token = bearerToken(request);
      if (!token) throw ApiError.unauthorized();
      let payload: AccessTokenPayload;
      try {
        payload = app.jwt.access.verify<AccessTokenPayload>(token);
      } catch {
        throw ApiError.unauthorized('Invalid or expired access token', 'INVALID_ACCESS_TOKEN');
      }
      if (payload.typ !== 'access' || typeof payload.sub !== 'string') {
        throw ApiError.unauthorized('Invalid or expired access token', 'INVALID_ACCESS_TOKEN');
      }
      request.user = { id: payload.sub };
    });
  },
  { name: 'auth-guard' },
);
