import { randomUUID } from 'node:crypto';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { refreshTokens } from '../db/schema.js';

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AccessTokenPayload {
  sub: string;
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  typ: 'refresh';
  jti: string;
  familyId: string;
}

/** Attached to request.user by the authenticate guard. */
export interface AuthenticatedUser {
  id: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    namespaces: 'access' | 'refresh';
    payload: AccessTokenPayload | RefreshTokenPayload;
    user: AuthenticatedUser;
  }
}

export async function registerJwt(app: FastifyInstance, config: AppConfig): Promise<void> {
  await app.register(fastifyJwt, {
    secret: config.JWT_ACCESS_SECRET,
    namespace: 'access',
    sign: { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL },
    verify: { algorithms: ['HS256'] },
  });
  await app.register(fastifyJwt, {
    secret: config.JWT_REFRESH_SECRET,
    namespace: 'refresh',
    sign: { algorithm: 'HS256', expiresIn: REFRESH_TOKEN_TTL_SECONDS },
    verify: { algorithms: ['HS256'] },
  });
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

/** Signs a new access/refresh pair and records the refresh token; a new family unless one is given. */
export async function issueSession(
  app: FastifyInstance,
  db: Pick<Database, 'insert'>,
  userId: string,
  familyId: string = randomUUID(),
): Promise<SessionTokens> {
  const jti = randomUUID();
  const accessToken = await app.jwt.access.sign({ sub: userId, typ: 'access' });
  const refreshToken = await app.jwt.refresh.sign({ sub: userId, typ: 'refresh', jti, familyId });
  await db.insert(refreshTokens).values({
    userId,
    familyId,
    jti,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  });
  return { accessToken, refreshToken };
}
