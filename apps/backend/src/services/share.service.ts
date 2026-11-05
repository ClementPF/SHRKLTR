import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { gameShares, games } from '../db/schema.js';
import { generateCapabilityToken } from '../lib/capability-token.js';
import { ApiError } from '../lib/errors.js';
import {
  boundLabel,
  SHARE_SNAPSHOT_VERSION,
  shareSnapshotSchema,
  type ShareSnapshot,
} from '../lib/share-snapshot.js';
import { getGame } from './game-history.service.js';
import type { GameWithRelations } from './game.service.js';

type ShareRow = typeof gameShares.$inferSelect;

/** Shape of every issued token: 32 random bytes, base64url without padding. */
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function displayName(user: {
  firstName: string | null;
  lastName: string | null;
  username: string;
}) {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full === '' ? user.username : full;
}

/** Only the explicit result: names, results, Elo changes, sport, tournament label and date. */
export function buildShareSnapshot(found: GameWithRelations): ShareSnapshot {
  return shareSnapshotSchema.parse({
    version: SHARE_SNAPSHOT_VERSION,
    gameId: found.game.id,
    date: found.game.date.toISOString(),
    sport: boundLabel(found.tournament.sport.name),
    tournament: boundLabel(found.tournament.tournament.displayName),
    participants: found.outcomes.map(({ outcome, user }) => ({
      username: boundLabel(user.username),
      displayName: boundLabel(displayName(user)),
      result: outcome.result,
      eloDelta: outcome.scoreValue,
      ratingBefore: outcome.ratingBefore,
    })),
  });
}

export interface IssuedShare {
  share: ShareRow;
  /** False when the caller's existing active share was returned. */
  created: boolean;
}

/**
 * Returns the caller's active share of a game, issuing one if needed. The caller must be able to
 * see the game (404 otherwise) and must have played in it (403 NOT_GAME_PARTICIPANT).
 */
export async function issueShare(
  db: Database,
  input: { gameId: string; userId: string; now: Date },
): Promise<IssuedShare> {
  const found = await getGame(db, input.gameId, input.userId);
  if (!found.outcomes.some(({ user }) => user.id === input.userId)) {
    throw ApiError.forbidden('Only players of this game can share it', 'NOT_GAME_PARTICIPANT');
  }
  const snapshot = buildShareSnapshot(found);

  // A concurrent issue or revoke can slip between the insert and the lookup; retry then.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [inserted] = await db
      .insert(gameShares)
      .values({
        gameId: input.gameId,
        createdByUserId: input.userId,
        token: generateCapabilityToken(),
        snapshot,
        templateVersion: SHARE_SNAPSHOT_VERSION,
        createdAt: input.now,
      })
      .onConflictDoNothing({
        target: [gameShares.gameId, gameShares.createdByUserId],
        where: sql`${gameShares.revokedAt} is null`,
      })
      .returning();
    if (inserted) return { share: inserted, created: true };

    const [existing] = await db
      .select()
      .from(gameShares)
      .where(
        and(
          eq(gameShares.gameId, input.gameId),
          eq(gameShares.createdByUserId, input.userId),
          isNull(gameShares.revokedAt),
        ),
      );
    if (existing) return { share: existing, created: false };
  }
  throw new Error('could not issue or find an active share');
}

/**
 * Revokes the caller's own share. Needs no access to the game, so an issuer can still revoke
 * after leaving its group. Shares of other users answer 404 like unknown ones.
 */
export async function revokeShare(
  db: Database,
  input: { gameId: string; shareId: string; userId: string; now: Date },
): Promise<void> {
  const [row] = await db
    .update(gameShares)
    .set({
      revokedAt: sql`coalesce(${gameShares.revokedAt}, ${input.now.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        eq(gameShares.id, input.shareId),
        eq(gameShares.gameId, input.gameId),
        eq(gameShares.createdByUserId, input.userId),
      ),
    )
    .returning({ id: gameShares.id });
  if (!row) throw shareNotFound();
}

export function shareNotFound(): ApiError {
  return ApiError.notFound('Shared result not found', 'SHARE_NOT_FOUND');
}

export interface PublicShare {
  id: string;
  templateVersion: number;
  snapshot: ShareSnapshot;
}

/**
 * The active share behind a public token. Malformed, unknown and revoked tokens, and shares whose
 * game no longer exists, all answer the same 404 SHARE_NOT_FOUND.
 */
export async function findPublicShare(db: Database, token: string): Promise<PublicShare> {
  if (!SHARE_TOKEN_PATTERN.test(token)) throw shareNotFound();
  const [row] = await db
    .select({
      id: gameShares.id,
      templateVersion: gameShares.templateVersion,
      snapshot: gameShares.snapshot,
    })
    .from(gameShares)
    .innerJoin(games, eq(games.id, gameShares.gameId))
    .where(and(eq(gameShares.token, token), isNull(gameShares.revokedAt)));
  if (!row) throw shareNotFound();
  return {
    id: row.id,
    templateVersion: row.templateVersion,
    snapshot: shareSnapshotSchema.parse(row.snapshot),
  };
}

export function shareUrls(publicApiUrl: string, token: string): { url: string; imageUrl: string } {
  return { url: `${publicApiUrl}/s/${token}`, imageUrl: `${publicApiUrl}/s/${token}.png` };
}
