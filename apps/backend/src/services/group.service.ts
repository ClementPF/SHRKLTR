import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../db/client.js';
import { groupMembers, groupPlayers, groupRole, groups, users } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import type { PageWindow } from '../lib/pagination.js';
import { awardAchievements } from './achievement.service.js';
import { notifyGroupMemberJoined } from './notification.service.js';
import { requireRegisteredUser } from './placeholder.service.js';

export type GroupRole = (typeof groupRole.enumValues)[number];
export type GroupRow = typeof groups.$inferSelect;
type UserRow = typeof users.$inferSelect;
type Reader = Pick<Database, 'select'>;

/** Row lock strength: SHARE for actions that only rely on memberships, NO KEY UPDATE to change them. */
export type GroupLockMode = 'share' | 'no key update';

export const MANAGER_ROLES: readonly GroupRole[] = ['OWNER', 'ADMIN'];

export const groupNotFound = () => ApiError.notFound('Group not found', 'GROUP_NOT_FOUND');

export const groupRoleRequired = (message: string) =>
  ApiError.forbidden(message, 'GROUP_ROLE_REQUIRED');

const ownerTransferRequired = (message: string) =>
  ApiError.badRequest(message, 'OWNER_TRANSFER_REQUIRED');

const memberNotFound = () =>
  ApiError.notFound('This user is not a member of the group', 'MEMBER_NOT_FOUND');

export interface GroupSummary {
  group: GroupRow;
  /** The viewer's role. */
  role: GroupRole;
  memberCount: number;
}

export interface GroupMembership {
  user: UserRow;
  role: GroupRole;
  joinedAt: Date;
}

export interface RosterEntry {
  user: UserRow;
  addedBy: UserRow | null;
  createdAt: Date;
}

/**
 * Locks group rows in id order (the first step of the common lock order: groups, then users,
 * then stats). Returns the rows that exist.
 */
export async function lockGroups(
  tx: Transaction,
  groupIds: readonly string[],
  mode: GroupLockMode,
): Promise<GroupRow[]> {
  if (groupIds.length === 0) return [];
  return tx
    .select()
    .from(groups)
    .where(inArray(groups.id, [...new Set(groupIds)]))
    .orderBy(asc(groups.id))
    .for(mode);
}

export async function findMemberRole(
  db: Reader,
  groupId: string,
  userId: string,
): Promise<GroupRole | undefined> {
  const [row] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return row?.role;
}

/**
 * Locks the group and returns it with the caller's current role. A missing group and a group
 * the caller does not belong to are indistinguishable (404 GROUP_NOT_FOUND).
 */
export async function lockGroupAsMember(
  tx: Transaction,
  groupId: string,
  userId: string,
  mode: GroupLockMode,
): Promise<{ group: GroupRow; role: GroupRole }> {
  const [group] = await lockGroups(tx, [groupId], mode);
  const role = group ? await findMemberRole(tx, groupId, userId) : undefined;
  if (!group || !role) throw groupNotFound();
  return { group, role };
}

/** Like lockGroupAsMember, but the caller must be OWNER or ADMIN (403 otherwise). */
export async function lockGroupAsManager(
  tx: Transaction,
  groupId: string,
  userId: string,
  mode: GroupLockMode,
  action: string,
): Promise<{ group: GroupRow; role: GroupRole }> {
  const found = await lockGroupAsMember(tx, groupId, userId, mode);
  if (!MANAGER_ROLES.includes(found.role)) {
    throw groupRoleRequired(`Only the group owner or an admin can ${action}`);
  }
  return found;
}

async function requireMember(
  db: Reader,
  groupId: string,
  userId: string,
): Promise<{ group: GroupRow; role: GroupRole }> {
  const [row] = await db
    .select({ group: groups, role: groupMembers.role })
    .from(groups)
    .innerJoin(
      groupMembers,
      and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)),
    )
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!row) throw groupNotFound();
  return row;
}

const memberCounts = (db: Reader) =>
  db
    .select({ groupId: groupMembers.groupId, n: count().as('member_count') })
    .from(groupMembers)
    .groupBy(groupMembers.groupId)
    .as('member_counts');

export async function countMembers(db: Reader, groupId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return row?.n ?? 0;
}

/** The groups the user belongs to, by name. */
export async function listMyGroups(db: Database, userId: string): Promise<GroupSummary[]> {
  const counts = memberCounts(db);
  const rows = await db
    .select({ group: groups, role: groupMembers.role, memberCount: counts.n })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .leftJoin(counts, eq(counts.groupId, groups.id))
    .where(eq(groupMembers.userId, userId))
    .orderBy(asc(sql`lower(${groups.name})`), asc(groups.id));
  return rows.map((r) => ({ group: r.group, role: r.role, memberCount: r.memberCount ?? 0 }));
}

export async function getGroupSummary(
  db: Database,
  groupId: string,
  viewerId: string,
): Promise<GroupSummary> {
  const { group, role } = await requireMember(db, groupId, viewerId);
  return { group, role, memberCount: await countMembers(db, groupId) };
}

export interface GroupCreated {
  summary: GroupSummary;
  /** first_group_joined unlock, to push after commit. */
  notificationIds: string[];
}

/** Creates a group owned by its creator; creating counts as joining for first_group_joined. */
export async function createGroup(
  db: Database,
  input: { creatorId: string; name: string },
  now: Date,
): Promise<GroupCreated> {
  return db.transaction(async (tx) => {
    await requireRegisteredUser(tx, input.creatorId);
    const [group] = await tx
      .insert(groups)
      .values({
        name: input.name,
        createdByUserId: input.creatorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!group) throw new Error('group insert returned no row');
    await tx
      .insert(groupMembers)
      .values({ groupId: group.id, userId: input.creatorId, role: 'OWNER', joinedAt: now });
    const badges = await awardAchievements(tx, [
      {
        userId: input.creatorId,
        code: 'first_group_joined',
        sourceType: 'GROUP',
        sourceGroupId: group.id,
      },
    ]);
    return {
      summary: { group, role: 'OWNER', memberCount: 1 },
      notificationIds: badges.notificationIds,
    };
  });
}

export async function renameGroup(
  db: Database,
  input: { groupId: string; callerId: string; name: string },
  now: Date,
): Promise<GroupSummary> {
  return db.transaction(async (tx) => {
    const { role } = await lockGroupAsManager(
      tx,
      input.groupId,
      input.callerId,
      'no key update',
      'rename the group',
    );
    const [group] = await tx
      .update(groups)
      .set({ name: input.name, updatedAt: now })
      .where(eq(groups.id, input.groupId))
      .returning();
    if (!group) throw groupNotFound();
    return { group, role, memberCount: await countMembers(tx, input.groupId) };
  });
}

/** Members with their roles: OWNER first, then ADMINs, then MEMBERs, each by join date. */
export async function listMembers(
  db: Database,
  groupId: string,
  viewerId: string,
  page: PageWindow,
): Promise<GroupMembership[]> {
  await requireMember(db, groupId, viewerId);
  return db
    .select({ user: users, role: groupMembers.role, joinedAt: groupMembers.joinedAt })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.role), asc(groupMembers.joinedAt), asc(users.username))
    .limit(page.limit)
    .offset(page.offset);
}

async function loadMembership(
  tx: Reader,
  groupId: string,
  userId: string,
): Promise<GroupMembership | undefined> {
  const [row] = await tx
    .select({ user: users, role: groupMembers.role, joinedAt: groupMembers.joinedAt })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return row;
}

/** OWNER grants or revokes ADMIN. The owner's own role only changes through a transfer. */
export async function setMemberRole(
  db: Database,
  input: { groupId: string; callerId: string; targetUserId: string; role: 'ADMIN' | 'MEMBER' },
): Promise<GroupMembership> {
  return db.transaction(async (tx) => {
    const { role } = await lockGroupAsMember(tx, input.groupId, input.callerId, 'no key update');
    if (role !== 'OWNER') throw groupRoleRequired('Only the group owner can change member roles');
    const target = await loadMembership(tx, input.groupId, input.targetUserId);
    if (!target) throw memberNotFound();
    if (target.role === 'OWNER') {
      throw ownerTransferRequired(
        'Transfer ownership to another member instead of demoting the owner',
      );
    }
    if (target.role === input.role) return target;
    await tx
      .update(groupMembers)
      .set({ role: input.role })
      .where(
        and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.userId, input.targetUserId)),
      );
    return { ...target, role: input.role };
  });
}

/**
 * Removes a member: the OWNER may remove anyone but themselves, an ADMIN only MEMBERs. Anyone
 * may remove themselves except the owner, which is the same as leaving.
 */
export async function removeMember(
  db: Database,
  input: { groupId: string; callerId: string; targetUserId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const { role } = await lockGroupAsMember(tx, input.groupId, input.callerId, 'no key update');
    const self = input.targetUserId === input.callerId;
    if (!self && role === 'MEMBER') {
      throw groupRoleRequired('Only the group owner or an admin can remove members');
    }
    const target = self ? { role } : await loadMembership(tx, input.groupId, input.targetUserId);
    if (!target) throw memberNotFound();
    if (target.role === 'OWNER') {
      if (role === 'OWNER') {
        throw ownerTransferRequired('Transfer ownership before the owner can leave the group');
      }
      throw groupRoleRequired('The group owner cannot be removed');
    }
    if (!self && role === 'ADMIN' && target.role !== 'MEMBER') {
      throw groupRoleRequired('Only the group owner can remove an admin');
    }
    await tx
      .delete(groupMembers)
      .where(
        and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.userId, input.targetUserId)),
      );
  });
}

export async function leaveGroup(
  db: Database,
  input: { groupId: string; userId: string },
): Promise<void> {
  await removeMember(db, {
    groupId: input.groupId,
    callerId: input.userId,
    targetUserId: input.userId,
  });
}

/**
 * Hands ownership to an existing member atomically: the current owner becomes ADMIN first (the
 * partial unique index allows one OWNER at a time), then the recipient becomes OWNER.
 */
export async function transferOwnership(
  db: Database,
  input: { groupId: string; callerId: string; targetUserId: string },
): Promise<GroupSummary> {
  return db.transaction(async (tx) => {
    const { group, role } = await lockGroupAsMember(
      tx,
      input.groupId,
      input.callerId,
      'no key update',
    );
    if (role !== 'OWNER') throw groupRoleRequired('Only the group owner can transfer ownership');
    let callerRole: GroupRole = 'OWNER';
    if (input.targetUserId !== input.callerId) {
      const target = await loadMembership(tx, input.groupId, input.targetUserId);
      if (!target) throw memberNotFound();
      await tx
        .update(groupMembers)
        .set({ role: 'ADMIN' })
        .where(
          and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.userId, input.callerId)),
        );
      await tx
        .update(groupMembers)
        .set({ role: 'OWNER' })
        .where(
          and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.userId, input.targetUserId)),
        );
      callerRole = 'ADMIN';
    }
    return { group, role: callerRole, memberCount: await countMembers(tx, input.groupId) };
  });
}

/**
 * Adds the user as MEMBER of each group (already locked by the caller) where they are not a
 * member yet; existing roles are kept. Each new membership notifies the group's current OWNER
 * and ADMINs, and the first one ever unlocks first_group_joined.
 */
export async function addMemberships(
  tx: Transaction,
  input: { userId: string; groupIds: readonly string[]; now: Date },
): Promise<{ joinedGroupIds: string[]; notificationIds: string[] }> {
  const joinedGroupIds: string[] = [];
  const notificationIds: string[] = [];
  for (const groupId of [...new Set(input.groupIds)].sort()) {
    const [inserted] = await tx
      .insert(groupMembers)
      .values({ groupId, userId: input.userId, role: 'MEMBER', joinedAt: input.now })
      .onConflictDoNothing({ target: [groupMembers.groupId, groupMembers.userId] })
      .returning({ joinedAt: groupMembers.joinedAt });
    if (!inserted) continue;
    joinedGroupIds.push(groupId);
    const managers = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          inArray(groupMembers.role, [...MANAGER_ROLES]),
          ne(groupMembers.userId, input.userId),
        ),
      );
    notificationIds.push(
      ...(await notifyGroupMemberJoined(tx, {
        groupId,
        joinerId: input.userId,
        joinedAt: inserted.joinedAt,
        recipientIds: managers.map((m) => m.userId),
      })),
    );
  }
  const [firstJoined] = joinedGroupIds;
  if (firstJoined) {
    const badges = await awardAchievements(tx, [
      {
        userId: input.userId,
        code: 'first_group_joined',
        sourceType: 'GROUP',
        sourceGroupId: firstJoined,
      },
    ]);
    notificationIds.push(...badges.notificationIds);
  }
  return { joinedGroupIds, notificationIds };
}

/** Groups whose roster lists the placeholder. */
export async function rosteredGroupIds(db: Reader, placeholderId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: groupPlayers.groupId })
    .from(groupPlayers)
    .where(eq(groupPlayers.placeholderUserId, placeholderId))
    .orderBy(asc(groupPlayers.groupId));
  return rows.map((r) => r.groupId);
}

/** Adds a placeholder to a group roster inside the caller's transaction; idempotent. */
export async function rosterPlaceholder(
  tx: Transaction,
  input: { groupId: string; placeholderId: string; addedById: string },
): Promise<void> {
  await tx
    .insert(groupPlayers)
    .values({
      groupId: input.groupId,
      placeholderUserId: input.placeholderId,
      addedByUserId: input.addedById,
    })
    .onConflictDoNothing({ target: [groupPlayers.groupId, groupPlayers.placeholderUserId] });
}

const addedBy = alias(users, 'added_by');

function selectRoster(db: Reader) {
  return db
    .select({ user: users, addedBy, createdAt: groupPlayers.createdAt })
    .from(groupPlayers)
    .innerJoin(users, eq(groupPlayers.placeholderUserId, users.id))
    .leftJoin(addedBy, eq(groupPlayers.addedByUserId, addedBy.id));
}

/** Rostered players that are still placeholders ("Unclaimed players"); claimed ones are members. */
export async function listUnclaimedPlayers(
  db: Database,
  groupId: string,
  viewerId: string,
): Promise<RosterEntry[]> {
  await requireMember(db, groupId, viewerId);
  return selectRoster(db)
    .where(and(eq(groupPlayers.groupId, groupId), eq(users.accountType, 'PLACEHOLDER')))
    .orderBy(asc(groupPlayers.createdAt), asc(users.username));
}

/**
 * Rosters an existing placeholder. Its creator (as a member) or the group's OWNER/ADMIN may do
 * so. Lock order matches claims: group first, then the placeholder row, whose account type is
 * rechecked so a concurrent claim either sees this roster entry or this call sees the claim.
 */
export async function addRosterPlayer(
  db: Database,
  input: { groupId: string; callerId: string; placeholderUserId: string },
): Promise<RosterEntry> {
  return db.transaction(async (tx) => {
    const { role } = await lockGroupAsMember(tx, input.groupId, input.callerId, 'share');
    const [player] = await tx
      .select()
      .from(users)
      .where(eq(users.id, input.placeholderUserId))
      .for('share');
    if (!player) throw ApiError.notFound('Player not found', 'PLAYER_NOT_FOUND');
    if (player.accountType !== 'PLACEHOLDER') {
      throw ApiError.badRequest(
        'Only players added by name (placeholders) can be added to the roster',
        'NOT_PLACEHOLDER',
      );
    }
    if (player.createdByUserId !== input.callerId && !MANAGER_ROLES.includes(role)) {
      throw ApiError.forbidden(
        'Only the player who added this placeholder or a group owner or admin can roster it',
        'NOT_PLACEHOLDER_CREATOR',
      );
    }
    await rosterPlaceholder(tx, {
      groupId: input.groupId,
      placeholderId: player.id,
      addedById: input.callerId,
    });
    const [entry] = await selectRoster(tx)
      .where(
        and(eq(groupPlayers.groupId, input.groupId), eq(groupPlayers.placeholderUserId, player.id)),
      )
      .limit(1);
    if (!entry) throw new Error('roster entry missing after insert');
    return entry;
  });
}

/**
 * Authorizes a grouped game inside its transaction: locks the group (SHARE, so concurrent games
 * proceed while leave/remove wait), then requires the caller and every registered participant to
 * be current members and every placeholder to be rostered.
 */
export async function authorizeGroupGame(
  tx: Transaction,
  input: { groupId: string; callerId: string; participantIds: readonly string[] },
): Promise<void> {
  const [group] = await lockGroups(tx, [input.groupId], 'share');
  const callerRole = group ? await findMemberRole(tx, input.groupId, input.callerId) : undefined;
  if (!group || !callerRole) {
    throw ApiError.notFound('Tournament not found', 'TOURNAMENT_NOT_FOUND');
  }
  const ids = [...new Set(input.participantIds)];
  const rows = await tx
    .select({
      username: users.username,
      accountType: users.accountType,
      member: groupMembers.userId,
      rostered: groupPlayers.placeholderUserId,
    })
    .from(users)
    .leftJoin(
      groupMembers,
      and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.userId, users.id)),
    )
    .leftJoin(
      groupPlayers,
      and(eq(groupPlayers.groupId, input.groupId), eq(groupPlayers.placeholderUserId, users.id)),
    )
    .where(inArray(users.id, ids))
    .orderBy(asc(users.username));
  const outsiders = rows
    .filter((r) => (r.accountType === 'REGISTERED' ? r.member === null : r.rostered === null))
    .map((r) => r.username);
  if (outsiders.length > 0 || rows.length !== ids.length) {
    throw ApiError.badRequest(
      `Not a member of this tournament's group: ${outsiders.join(', ')}`,
      'PLAYER_NOT_GROUP_MEMBER',
    );
  }
}
