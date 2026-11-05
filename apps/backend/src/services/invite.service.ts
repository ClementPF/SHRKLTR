import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { appInvites, users } from '../db/schema.js';
import { generateCapabilityToken, hashCapabilityToken } from '../lib/capability-token.js';
import { ApiError } from '../lib/errors.js';
import { requireRegisteredUser } from './placeholder.service.js';

type UserRow = typeof users.$inferSelect;

export function appInviteUrlFor(publicWebUrl: string, token: string): string {
  return `${publicWebUrl}/invite/app/${token}`;
}

/**
 * Issues the caller's reusable general invitation link. Each user has one link; issuing again
 * rotates it, so a lost or leaked previous URL stops working. Links never expire on their own.
 */
export async function issueAppInvite(
  db: Database,
  creatorId: string,
  publicWebUrl: string,
  now: Date,
): Promise<{ url: string }> {
  return db.transaction(async (tx) => {
    await requireRegisteredUser(tx, creatorId);
    const token = generateCapabilityToken();
    const tokenHash = hashCapabilityToken(token);
    await tx
      .insert(appInvites)
      .values({ creatorUserId: creatorId, tokenHash, createdAt: now })
      .onConflictDoUpdate({
        target: appInvites.creatorUserId,
        set: { tokenHash, revokedAt: null, createdAt: now },
      });
    return { url: appInviteUrlFor(publicWebUrl, token) };
  });
}

/** Public, non-consuming preview of a general invitation: only who sent it. */
export async function previewAppInvite(
  db: Database,
  token: string,
): Promise<{ invitedBy: UserRow }> {
  const [row] = await db
    .select({ creator: users })
    .from(appInvites)
    .innerJoin(users, eq(appInvites.creatorUserId, users.id))
    .where(
      and(
        eq(appInvites.tokenHash, hashCapabilityToken(token)),
        isNull(appInvites.revokedAt),
        eq(users.accountType, 'REGISTERED'),
      ),
    )
    .limit(1);
  if (!row) throw ApiError.notFound('This invitation link is not valid', 'INVITE_NOT_FOUND');
  return { invitedBy: row.creator };
}
