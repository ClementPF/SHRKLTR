import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../db/client.js';
import { playerClaims, users } from '../db/schema.js';
import { generateCapabilityToken, hashCapabilityToken } from '../lib/capability-token.js';
import { isUniqueViolation } from '../lib/db-errors.js';
import { ApiError } from '../lib/errors.js';
import type { GameWithRelations } from './game.service.js';
import { countOpenUserGames, listOpenUserGames } from './game-history.service.js';
import { listOpenUserStats, type StatsWithRelations } from './stats-query.service.js';
import { deriveUsernameBase, findAvailableUsername, splitDisplayName } from './user.service.js';

type UserRow = typeof users.$inferSelect;
type ClaimRow = typeof playerClaims.$inferSelect;

const MAX_ATTEMPTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
export const CLAIM_PREVIEW_GAMES = 10;

export interface ClaimLinkSettings {
  publicWebUrl: string;
  ttlDays: number;
  now: Date;
}

/** A freshly issued claim link; the raw URL exists only in this value, never in storage. */
export interface IssuedClaimLink {
  user: UserRow;
  claimUrl: string;
  claimExpiresAt: Date;
}

export type ClaimStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'CLAIMED';

export interface InvitedPlayer {
  user: UserRow;
  status: ClaimStatus;
  claimExpiresAt: Date;
  claimRevokedAt: Date | null;
  claimedAt: Date | null;
}

export interface ClaimPreview {
  player: UserRow;
  invitedBy: UserRow | null;
  expiresAt: Date;
  gamesCount: number;
  recentGames: GameWithRelations[];
  stats: StatsWithRelations[];
}

export function claimUrlFor(publicWebUrl: string, token: string): string {
  return `${publicWebUrl}/invite/claim/${token}`;
}

function newClaimSecret(settings: ClaimLinkSettings) {
  const token = generateCapabilityToken();
  return {
    token,
    tokenHash: hashCapabilityToken(token),
    expiresAt: new Date(settings.now.getTime() + settings.ttlDays * DAY_MS),
  };
}

export function claimStatus(claim: ClaimRow, now: Date): ClaimStatus {
  if (claim.consumedAt) return 'CLAIMED';
  if (claim.revokedAt) return 'REVOKED';
  if (claim.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

/** The authenticated caller as a registered account; placeholders never hold sessions. */
export async function requireRegisteredUser(
  db: Pick<Database, 'select'>,
  userId: string,
): Promise<UserRow> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.accountType !== 'REGISTERED') {
    throw ApiError.unauthorized('Authenticated user no longer exists', 'USER_NOT_FOUND');
  }
  return user;
}

/**
 * Creates a PLACEHOLDER user named after displayName, owned by the creator, together with its
 * one-time claim link, in one transaction.
 */
export async function createPlaceholder(
  db: Database,
  input: { creatorId: string; displayName: string },
  settings: ClaimLinkSettings,
): Promise<IssuedClaimLink> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await requireRegisteredUser(tx, input.creatorId);
        const username = await findAvailableUsername(tx, deriveUsernameBase(input.displayName));
        const [user] = await tx
          .insert(users)
          .values({
            accountType: 'PLACEHOLDER',
            username,
            ...splitDisplayName(input.displayName),
            createdByUserId: input.creatorId,
          })
          .returning();
        if (!user) throw new Error('placeholder insert returned no row');
        const secret = newClaimSecret(settings);
        await tx.insert(playerClaims).values({
          placeholderUserId: user.id,
          creatorUserId: input.creatorId,
          tokenHash: secret.tokenHash,
          expiresAt: secret.expiresAt,
        });
        return {
          user,
          claimUrl: claimUrlFor(settings.publicWebUrl, secret.token),
          claimExpiresAt: secret.expiresAt,
        };
      });
    } catch (err) {
      if (isUniqueViolation(err, 'users_username_key')) continue;
      throw err;
    }
  }
  throw new Error('could not create placeholder after repeated username conflicts');
}

/** Locks the claim of a placeholder for its creator; refuses other callers and used claims. */
async function lockManagedClaim(
  tx: Transaction,
  placeholderId: string,
  callerId: string,
): Promise<{ claim: ClaimRow; user: UserRow }> {
  const [claim] = await tx
    .select()
    .from(playerClaims)
    .where(eq(playerClaims.placeholderUserId, placeholderId))
    .for('update');
  const [user] = claim
    ? await tx.select().from(users).where(eq(users.id, claim.placeholderUserId)).limit(1)
    : [];
  if (!claim || !user) {
    throw ApiError.notFound('Invited player not found', 'PLACEHOLDER_NOT_FOUND');
  }
  if (claim.creatorUserId !== callerId) {
    throw ApiError.forbidden(
      'Only the player who created this placeholder can manage its claim link',
      'NOT_PLACEHOLDER_CREATOR',
    );
  }
  if (claim.consumedAt || user.accountType !== 'PLACEHOLDER') {
    throw ApiError.badRequest('This player has already been claimed', 'CLAIM_ALREADY_USED');
  }
  return { claim, user };
}

/** Rotates the claim link: the previous URL stops working and a fresh expiry starts. */
export async function reissueClaimLink(
  db: Database,
  input: { placeholderId: string; callerId: string },
  settings: ClaimLinkSettings,
): Promise<IssuedClaimLink> {
  return db.transaction(async (tx) => {
    const { claim, user } = await lockManagedClaim(tx, input.placeholderId, input.callerId);
    const secret = newClaimSecret(settings);
    await tx
      .update(playerClaims)
      .set({ tokenHash: secret.tokenHash, expiresAt: secret.expiresAt, revokedAt: null })
      .where(eq(playerClaims.id, claim.id));
    return {
      user,
      claimUrl: claimUrlFor(settings.publicWebUrl, secret.token),
      claimExpiresAt: secret.expiresAt,
    };
  });
}

/** Disables the current claim link immediately; idempotent for an already revoked link. */
export async function revokeClaimLink(
  db: Database,
  input: { placeholderId: string; callerId: string },
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    const { claim } = await lockManagedClaim(tx, input.placeholderId, input.callerId);
    if (claim.revokedAt) return;
    await tx.update(playerClaims).set({ revokedAt: now }).where(eq(playerClaims.id, claim.id));
  });
}

/** The creator's placeholders (including claimed ones) with claim metadata; never tokens. */
export async function listInvitedPlayers(
  db: Database,
  creatorId: string,
  now: Date,
): Promise<InvitedPlayer[]> {
  const rows = await db
    .select({ claim: playerClaims, user: users })
    .from(playerClaims)
    .innerJoin(users, eq(playerClaims.placeholderUserId, users.id))
    .where(eq(playerClaims.creatorUserId, creatorId))
    .orderBy(desc(users.createdAt), desc(users.id));
  return rows.map(({ claim, user }) => ({
    user,
    status: claimStatus(claim, now),
    claimExpiresAt: claim.expiresAt,
    claimRevokedAt: claim.revokedAt,
    claimedAt: user.claimedAt ?? claim.consumedAt,
  }));
}

const creators = alias(users, 'creator');

/**
 * Public, non-consuming preview of a usable claim link: the player's identity and open history.
 * Unknown, expired, revoked and consumed links are all 404 CLAIM_INVALID.
 */
export async function previewClaim(db: Database, token: string, now: Date): Promise<ClaimPreview> {
  const [row] = await db
    .select({ claim: playerClaims, player: users, creator: creators })
    .from(playerClaims)
    .innerJoin(users, eq(playerClaims.placeholderUserId, users.id))
    .leftJoin(creators, eq(playerClaims.creatorUserId, creators.id))
    .where(
      and(
        eq(playerClaims.tokenHash, hashCapabilityToken(token)),
        isNull(playerClaims.consumedAt),
        isNull(playerClaims.revokedAt),
        gt(playerClaims.expiresAt, now),
        eq(users.accountType, 'PLACEHOLDER'),
      ),
    )
    .limit(1);
  if (!row) {
    throw ApiError.notFound('This claim link is invalid, expired or already used', 'CLAIM_INVALID');
  }
  const [gamesCount, recentGames, stats] = await Promise.all([
    countOpenUserGames(db, row.player.id),
    listOpenUserGames(db, row.player.id, { offset: 0, limit: CLAIM_PREVIEW_GAMES }),
    listOpenUserStats(db, row.player.id),
  ]);
  return {
    player: row.player,
    invitedBy: row.creator,
    expiresAt: row.claim.expiresAt,
    gamesCount,
    recentGames,
    stats,
  };
}
