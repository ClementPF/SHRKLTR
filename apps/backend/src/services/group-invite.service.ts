import { randomInt } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { groupInvites, groups, users } from '../db/schema.js';
import { generateCapabilityToken, hashCapabilityToken } from '../lib/capability-token.js';
import { ApiError } from '../lib/errors.js';
import {
  addMemberships,
  countMembers,
  findMemberRole,
  lockGroupAsManager,
  lockGroups,
  type GroupRole,
  type GroupSummary,
} from './group.service.js';
import { requireRegisteredUser } from './placeholder.service.js';

type InviteRow = typeof groupInvites.$inferSelect;
type UserRow = typeof users.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/** Uppercase letters and digits without look-alikes (0/O, 1/I/L). */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 10;

export interface InviteCredentials {
  token: string;
  code: string;
}

/** A random 10-character short code drawn uniformly from the unambiguous alphabet. */
export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

export function generateInviteCredentials(): InviteCredentials {
  return { token: generateCapabilityToken(), code: generateInviteCode() };
}

/** What people may type: any case, with spaces or dashes between characters. */
export function normalizeInviteCode(code: string): string {
  return code.replace(/[\s-]+/g, '').toUpperCase();
}

export function hashInviteCode(code: string): string {
  return hashCapabilityToken(normalizeInviteCode(code));
}

export function joinUrlFor(publicWebUrl: string, token: string): string {
  return `${publicWebUrl}/join/${token}`;
}

export type InviteStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export function inviteStatus(invite: InviteRow, now: Date): InviteStatus {
  if (invite.revokedAt) return 'REVOKED';
  if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

export interface GroupInviteSettings {
  publicWebUrl: string;
  ttlDays: number;
  now: Date;
}

/** Freshly issued credentials; the raw URL and code exist only in this value. */
export interface IssuedGroupInvite {
  invite: InviteRow;
  url: string;
  code: string;
}

export interface GroupInviteMetadata {
  invite: InviteRow;
  createdBy: UserRow | null;
  status: InviteStatus;
}

const invalidExpiry = (message: string) => ApiError.badRequest(message, 'INVALID_INVITE_EXPIRY');

const isoDateTime = z.iso.datetime({ offset: true });

/** Omitted → default TTL, null → never expires, otherwise an ISO date-time in the future. */
export function resolveInviteExpiry(
  expiresAt: string | null | undefined,
  settings: Pick<GroupInviteSettings, 'ttlDays' | 'now'>,
): Date | null {
  if (expiresAt === undefined) {
    return new Date(settings.now.getTime() + settings.ttlDays * DAY_MS);
  }
  if (expiresAt === null) return null;
  if (!isoDateTime.safeParse(expiresAt).success) {
    throw invalidExpiry('expiresAt must be an ISO 8601 date-time, or null for no expiry');
  }
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) throw invalidExpiry('expiresAt is not a valid date');
  if (date.getTime() <= settings.now.getTime()) {
    throw invalidExpiry('expiresAt must be in the future');
  }
  return date;
}

/**
 * Issues a reusable invite (OWNER/ADMIN). A hash collision with an existing invite simply draws
 * fresh credentials; the conflicting row is never read.
 */
export async function createGroupInvite(
  db: Database,
  input: { groupId: string; callerId: string; expiresAt: string | null | undefined },
  settings: GroupInviteSettings,
  generate: () => InviteCredentials = generateInviteCredentials,
): Promise<IssuedGroupInvite> {
  return db.transaction(async (tx) => {
    await lockGroupAsManager(tx, input.groupId, input.callerId, 'share', 'create invites');
    const expiresAt = resolveInviteExpiry(input.expiresAt, settings);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const credentials = generate();
      const [invite] = await tx
        .insert(groupInvites)
        .values({
          groupId: input.groupId,
          createdByUserId: input.callerId,
          tokenHash: hashCapabilityToken(credentials.token),
          codeHash: hashInviteCode(credentials.code),
          expiresAt,
          createdAt: settings.now,
        })
        .onConflictDoNothing()
        .returning();
      if (invite) {
        return {
          invite,
          url: joinUrlFor(settings.publicWebUrl, credentials.token),
          code: credentials.code,
        };
      }
    }
    throw new Error('could not generate unique group invite credentials');
  });
}

const creators = alias(users, 'invite_creator');

/** Management metadata only: never tokens, codes or their hashes. */
export async function listGroupInvites(
  db: Database,
  input: { groupId: string; callerId: string },
  now: Date,
): Promise<GroupInviteMetadata[]> {
  const rows = await db.transaction(async (tx) => {
    await lockGroupAsManager(tx, input.groupId, input.callerId, 'share', 'manage invites');
    return tx
      .select({ invite: groupInvites, createdBy: creators })
      .from(groupInvites)
      .leftJoin(creators, eq(groupInvites.createdByUserId, creators.id))
      .where(eq(groupInvites.groupId, input.groupId))
      .orderBy(desc(groupInvites.createdAt), desc(groupInvites.id));
  });
  return rows.map((r) => ({ ...r, status: inviteStatus(r.invite, now) }));
}

/** Revokes an invite of this group; revoking again keeps the first revocation time. */
export async function revokeGroupInvite(
  db: Database,
  input: { groupId: string; callerId: string; inviteId: string },
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockGroupAsManager(tx, input.groupId, input.callerId, 'share', 'manage invites');
    const [invite] = await tx
      .select()
      .from(groupInvites)
      .where(and(eq(groupInvites.id, input.inviteId), eq(groupInvites.groupId, input.groupId)))
      .for('update');
    if (!invite) throw ApiError.notFound('Invite not found', 'INVITE_NOT_FOUND');
    if (invite.revokedAt) return;
    await tx.update(groupInvites).set({ revokedAt: now }).where(eq(groupInvites.id, invite.id));
  });
}

/** Public, non-consuming preview: the group name and expiry only. */
export async function previewGroupInvite(
  db: Database,
  token: string,
  now: Date,
): Promise<{ groupName: string; expiresAt: Date | null }> {
  const [row] = await db
    .select({ invite: groupInvites, group: groups })
    .from(groupInvites)
    .innerJoin(groups, eq(groupInvites.groupId, groups.id))
    .where(eq(groupInvites.tokenHash, hashCapabilityToken(token)))
    .limit(1);
  if (!row || inviteStatus(row.invite, now) !== 'ACTIVE') {
    throw ApiError.notFound('This invite link is invalid, expired or revoked', 'INVITE_NOT_FOUND');
  }
  return { groupName: row.group.name, expiresAt: row.invite.expiresAt };
}

export type InviteCredential = { token: string } | { code: string };

export interface GroupJoinResult {
  summary: GroupSummary;
  /** False when the caller already belonged to the group (their role is unchanged). */
  joined: boolean;
  notificationIds: string[];
}

const inviteInvalid = () =>
  ApiError.badRequest('This invite is invalid, expired or revoked', 'INVITE_INVALID');

/**
 * Redeems an invite by URL token or short code. Under the group lock the invite is rechecked and
 * the caller becomes MEMBER unless already a member, so repeated or concurrent redemptions add
 * one membership, one badge and one notification per owner/admin at most.
 */
export async function redeemGroupInvite(
  db: Database,
  input: { userId: string; credential: InviteCredential },
  now: Date,
): Promise<GroupJoinResult> {
  const where =
    'token' in input.credential
      ? eq(groupInvites.tokenHash, hashCapabilityToken(input.credential.token))
      : eq(groupInvites.codeHash, hashInviteCode(input.credential.code));
  const [candidate] = await db
    .select({ id: groupInvites.id, groupId: groupInvites.groupId })
    .from(groupInvites)
    .where(where)
    .limit(1);
  if (!candidate) throw inviteInvalid();

  return db.transaction(async (tx) => {
    await requireRegisteredUser(tx, input.userId);
    const [group] = await lockGroups(tx, [candidate.groupId], 'no key update');
    const [invite] = await tx
      .select()
      .from(groupInvites)
      .where(eq(groupInvites.id, candidate.id))
      .for('share');
    if (!group || !invite || inviteStatus(invite, now) !== 'ACTIVE') throw inviteInvalid();

    const existing = await findMemberRole(tx, group.id, input.userId);
    let role: GroupRole;
    let notificationIds: string[] = [];
    if (existing) {
      role = existing;
    } else {
      const added = await addMemberships(tx, { userId: input.userId, groupIds: [group.id], now });
      notificationIds = added.notificationIds;
      role = 'MEMBER';
    }
    return {
      summary: { group, role, memberCount: await countMembers(tx, group.id) },
      joined: !existing,
      notificationIds,
    };
  });
}
