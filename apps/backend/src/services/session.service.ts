import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { issueSession, type RefreshTokenPayload, type SessionTokens } from '../auth/jwt.js';
import { refreshTokens } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';

const invalidRefreshToken = () =>
  ApiError.unauthorized('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');

/** Verifies signature, expiry and claims of a refresh token; any failure is a 401. */
export function verifyRefreshToken(app: FastifyInstance, token: string): RefreshTokenPayload {
  let payload: RefreshTokenPayload;
  try {
    payload = app.jwt.refresh.verify<RefreshTokenPayload>(token);
  } catch {
    throw invalidRefreshToken();
  }
  if (
    payload.typ !== 'refresh' ||
    typeof payload.sub !== 'string' ||
    typeof payload.jti !== 'string' ||
    typeof payload.familyId !== 'string'
  ) {
    throw invalidRefreshToken();
  }
  return payload;
}

export async function revokeFamily(app: FastifyInstance, familyId: string): Promise<void> {
  await app.db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

/**
 * Exchanges a refresh token for a new pair in the same family. Presenting a token that is
 * unknown or already rotated/revoked is treated as theft: the whole family is revoked.
 */
export async function rotateSession(app: FastifyInstance, token: string): Promise<SessionTokens> {
  const claims = verifyRefreshToken(app, token);

  const rotated = await app.db.transaction(async (tx) => {
    // Conditional update makes concurrent rotations of one token race-safe: only one wins.
    const [consumed] = await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.jti, claims.jti),
          eq(refreshTokens.familyId, claims.familyId),
          eq(refreshTokens.userId, claims.sub),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ userId: refreshTokens.userId, familyId: refreshTokens.familyId });
    if (!consumed) return null;
    return issueSession(app, tx, consumed.userId, consumed.familyId);
  });

  if (!rotated) {
    await revokeFamily(app, claims.familyId);
    throw invalidRefreshToken();
  }
  return rotated;
}

export async function logoutSession(app: FastifyInstance, token: string): Promise<void> {
  const claims = verifyRefreshToken(app, token);
  await revokeFamily(app, claims.familyId);
}
