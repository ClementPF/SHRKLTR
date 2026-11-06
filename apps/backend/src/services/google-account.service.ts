import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { issueSession, type SessionTokens } from '../auth/jwt.js';
import type { GoogleIdentity } from '../auth/google.verify.js';
import type { Transaction } from '../db/client.js';
import { playerClaims, users } from '../db/schema.js';
import { hashCapabilityToken } from '../lib/capability-token.js';
import { isUniqueViolation } from '../lib/db-errors.js';
import { ApiError } from '../lib/errors.js';
import { awardAchievements } from './achievement.service.js';
import { notifyPlaceholderClaimed } from './notification.service.js';
import { addMemberships, lockGroups, rosteredGroupIds } from './group.service.js';
import {
  deriveUsernameBase,
  findAvailableUsername,
  googleDisplayName,
  splitGoogleName,
} from './user.service.js';

type UserRow = typeof users.$inferSelect;

const MAX_ATTEMPTS = 5;

export interface GoogleSignInOptions {
  /** Raw claim token from a claim link; binds this brand-new Google identity to its placeholder. */
  claimToken?: string | undefined;
  now: Date;
}

export interface GoogleSignInResult extends SessionTokens {
  user: UserRow;
  /** Inbox rows created by a claim, to push once the transaction has committed. */
  notificationIds: string[];
}

export const claimInvalid = () =>
  ApiError.badRequest('This claim link is invalid, expired or already used', 'CLAIM_INVALID');

/** Advisory-lock key shared by ordinary sign-in and claims of one Google subject. */
export function googleSubjectLockKey(sub: string): string {
  return `google_sub:${sub}`;
}

/**
 * Serializes provisioning and claiming per Google subject. Taken in its own statement before
 * any lookup so, under READ COMMITTED, later statements see the previous holder's commit.
 */
async function lockGoogleSubject(tx: Transaction, sub: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${googleSubjectLockKey(sub)}, 0))`,
  );
}

/** The placeholder's roster changed while the claim waited for its row; retry from scratch. */
class ClaimRosterChanged extends Error {
  constructor() {
    super('placeholder roster changed during claim');
    this.name = 'ClaimRosterChanged';
  }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function googleProfile(identity: GoogleIdentity) {
  return {
    email: identity.email,
    emailVerified: identity.emailVerified,
    ...splitGoogleName(identity),
    pictureUrl: identity.picture,
    locale: identity.locale,
  };
}

async function refreshProfile(
  tx: Transaction,
  userId: string,
  identity: GoogleIdentity,
): Promise<UserRow> {
  const [updated] = await tx
    .update(users)
    .set({ ...googleProfile(identity), updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) throw new Error('user disappeared during profile refresh');
  return updated;
}

async function createRegisteredUser(tx: Transaction, identity: GoogleIdentity): Promise<UserRow> {
  const username = await findAvailableUsername(tx, deriveUsernameBase(googleDisplayName(identity)));
  const [created] = await tx
    .insert(users)
    .values({ googleSub: identity.sub, username, ...googleProfile(identity) })
    .returning();
  if (!created) throw new Error('user insert returned no row');
  return created;
}

/**
 * Binds the Google subject to the placeholder's existing row, so its id, username, games,
 * stats and rivalries are inherited without moving any history, and consumes the claim.
 * Lock order: the groups rostering the placeholder (sorted), the placeholder user row, then its
 * claim row; all are rechecked under lock. If a roster entry appeared before the placeholder
 * lock was granted, the whole transaction restarts so no rostered group is left out.
 */
async function claimPlaceholder(
  tx: Transaction,
  identity: GoogleIdentity,
  claimToken: string,
  now: Date,
): Promise<{ user: UserRow; creatorId: string; groupIds: string[] }> {
  const tokenHash = hashCapabilityToken(claimToken);
  const [candidate] = await tx
    .select({ placeholderUserId: playerClaims.placeholderUserId })
    .from(playerClaims)
    .where(eq(playerClaims.tokenHash, tokenHash))
    .limit(1);
  if (!candidate) throw claimInvalid();

  const groupIds = await rosteredGroupIds(tx, candidate.placeholderUserId);
  await lockGroups(tx, groupIds, 'no key update');

  const [placeholder] = await tx
    .select()
    .from(users)
    .where(eq(users.id, candidate.placeholderUserId))
    .for('update');
  const [claim] = await tx
    .select()
    .from(playerClaims)
    .where(eq(playerClaims.placeholderUserId, candidate.placeholderUserId))
    .for('update');
  if (
    !placeholder ||
    placeholder.accountType !== 'PLACEHOLDER' ||
    !claim ||
    claim.tokenHash !== tokenHash ||
    claim.consumedAt !== null ||
    claim.revokedAt !== null ||
    claim.expiresAt.getTime() <= now.getTime()
  ) {
    throw claimInvalid();
  }
  if (!sameIds(groupIds, await rosteredGroupIds(tx, placeholder.id))) {
    throw new ClaimRosterChanged();
  }

  const [claimed] = await tx
    .update(users)
    .set({
      ...googleProfile(identity),
      googleSub: identity.sub,
      accountType: 'REGISTERED',
      claimedAt: now,
      updatedAt: now,
    })
    .where(and(eq(users.id, placeholder.id), eq(users.accountType, 'PLACEHOLDER')))
    .returning();
  if (!claimed) throw claimInvalid();
  await tx.update(playerClaims).set({ consumedAt: now }).where(eq(playerClaims.id, claim.id));
  return { user: claimed, creatorId: claim.creatorUserId, groupIds };
}

/**
 * The single Google sign-in path for a verified identity. Without a claim token it logs in the
 * existing account or provisions a new one; with a claim token the identity must be new to
 * Sharkulator, otherwise the claim is refused (400 CLAIM_REQUIRES_NEW_ACCOUNT) and left intact.
 * The session is issued in the same transaction.
 */
export async function signInWithGoogle(
  app: FastifyInstance,
  identity: GoogleIdentity,
  opts: GoogleSignInOptions,
): Promise<GoogleSignInResult> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await app.db.transaction(async (tx) => {
        await lockGoogleSubject(tx, identity.sub);
        const [existing] = await tx
          .select()
          .from(users)
          .where(eq(users.googleSub, identity.sub))
          .limit(1);

        let user: UserRow;
        let notificationIds: string[] = [];
        if (opts.claimToken !== undefined) {
          if (existing) {
            throw ApiError.badRequest(
              'Only a Google account that is not registered with Sharkulator yet can claim this player',
              'CLAIM_REQUIRES_NEW_ACCOUNT',
            );
          }
          const claimed = await claimPlaceholder(tx, identity, opts.claimToken, opts.now);
          user = claimed.user;
          const claimNotifications = await notifyPlaceholderClaimed(tx, {
            creatorId: claimed.creatorId,
            claimedUserId: user.id,
          });
          const badges = await awardAchievements(tx, [
            { userId: claimed.creatorId, code: 'invited_player_claimed', sourceType: 'CLAIM' },
          ]);
          const memberships = await addMemberships(tx, {
            userId: user.id,
            groupIds: claimed.groupIds,
            now: opts.now,
          });
          notificationIds = [
            ...claimNotifications,
            ...badges.notificationIds,
            ...memberships.notificationIds,
          ];
        } else if (existing) {
          user = await refreshProfile(tx, existing.id, identity);
        } else {
          user = await createRegisteredUser(tx, identity);
        }
        const tokens = await issueSession(app, tx, user.id);
        return { ...tokens, user, notificationIds };
      });
    } catch (err) {
      // Another account took the derived username concurrently; pick the next free one.
      if (isUniqueViolation(err, 'users_username_key')) continue;
      if (err instanceof ClaimRosterChanged) continue;
      throw err;
    }
  }
  throw new Error('could not provision user after repeated unique-constraint conflicts');
}
