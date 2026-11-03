import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { issueSession, type RefreshTokenPayload, type SessionTokens } from '../auth/jwt.js';
import type { Database } from '../db/client.js';
import { refreshTokens } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

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

/**
 * Serializes every mutation of one refresh family. It must be taken before any refresh-token
 * row lock, in its own statement: under READ COMMITTED the following statements then get a
 * snapshot that includes descendants committed by the previous lock holder. The lock is
 * transaction-scoped on purpose; a session-scoped lock would leak across pooled connections.
 */
async function lockFamily(tx: Transaction, familyId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`refresh_family:${familyId}`}, 0))`,
  );
}

async function revokeFamilyRows(tx: Transaction, familyId: string): Promise<void> {
  await tx
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

export async function revokeFamily(app: FastifyInstance, familyId: string): Promise<void> {
  await app.db.transaction(async (tx) => {
    await lockFamily(tx, familyId);
    await revokeFamilyRows(tx, familyId);
  });
}

/**
 * Exchanges a refresh token for a new pair in the same family. Presenting a token that is
 * unknown or already rotated/revoked is treated as theft: the whole family is revoked.
 */
export async function rotateSession(app: FastifyInstance, token: string): Promise<SessionTokens> {
  const claims = verifyRefreshToken(app, token);

  // Reuse returns null rather than throwing so the family revocation commits before the 401.
  const rotated = await app.db.transaction(async (tx) => {
    await lockFamily(tx, claims.familyId);
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
    if (!consumed) {
      await revokeFamilyRows(tx, claims.familyId);
      return null;
    }
    return issueSession(app, tx, consumed.userId, consumed.familyId);
  });

  if (!rotated) throw invalidRefreshToken();
  return rotated;
}

export async function logoutSession(app: FastifyInstance, token: string): Promise<void> {
  const claims = verifyRefreshToken(app, token);
  await revokeFamily(app, claims.familyId);
}
