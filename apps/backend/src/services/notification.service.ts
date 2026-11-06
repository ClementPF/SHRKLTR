import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../db/client.js';
import {
  challenges,
  games,
  groupMembers,
  groups,
  notificationCategory,
  notificationPreferences,
  notifications,
  notificationType,
  outcomes,
  tournaments,
  users,
} from '../db/schema.js';
import { findAchievement } from '../achievements/catalog.js';
import { ApiError } from '../lib/errors.js';
import type { PageWindow } from '../lib/pagination.js';
import { visibleTournamentsFilter } from './visibility.service.js';

export type NotificationType = (typeof notificationType.enumValues)[number];
export type NotificationCategory = (typeof notificationCategory.enumValues)[number];
type NotificationRow = typeof notifications.$inferSelect;
type UserRow = typeof users.$inferSelect;

export const NOTIFICATION_CATEGORY_BY_TYPE: Record<NotificationType, NotificationCategory> = {
  game_recorded: 'games',
  challenge_received: 'challenges',
  challenge_accepted: 'challenges',
  challenge_declined: 'challenges',
  challenge_expiring: 'challenges',
  challenge_expired: 'challenges',
  achievement_unlocked: 'achievements',
  placeholder_claimed: 'claims',
  group_member_joined: 'groups',
};

/** Where a client navigates for a notification; never a URL or a capability token. */
export type NotificationTarget =
  | { type: 'game'; gameId: string }
  | { type: 'challenge'; challengeId: string }
  | { type: 'group'; groupId: string }
  | { type: 'achievements'; username: string }
  | { type: 'user'; username: string };

export interface NotificationEvent {
  recipientUserId: string;
  type: NotificationType;
  /** Event identity; the same key for the same recipient is only ever inserted once. */
  dedupeKey: string;
  actorUserId?: string | null;
  subjectUserId?: string | null;
  gameId?: string | null;
  groupId?: string | null;
  challengeId?: string | null;
  achievementCode?: string | null;
}

/**
 * Inserts inbox rows inside the caller's transaction, whatever the recipients' preferences.
 * Returns the ids of rows actually inserted (already-recorded events are skipped) so the caller
 * can hand them to push delivery once the transaction has committed.
 */
export async function insertNotifications(
  tx: Transaction,
  events: readonly NotificationEvent[],
): Promise<string[]> {
  if (events.length === 0) return [];
  const rows = await tx
    .insert(notifications)
    .values(events.map((e) => ({ ...e, category: NOTIFICATION_CATEGORY_BY_TYPE[e.type] })))
    .onConflictDoNothing({ target: [notifications.recipientUserId, notifications.dedupeKey] })
    .returning({ id: notifications.id });
  return rows.map((r) => r.id);
}

/** game_recorded for every participant, the submitter included. */
export function notifyGameRecorded(
  tx: Transaction,
  input: { gameId: string; submitterId: string | null; participantIds: readonly string[] },
): Promise<string[]> {
  return insertNotifications(
    tx,
    input.participantIds.map((recipientUserId) => ({
      recipientUserId,
      type: 'game_recorded' as const,
      dedupeKey: `game_recorded:${input.gameId}`,
      actorUserId: input.submitterId,
      gameId: input.gameId,
    })),
  );
}

/** placeholder_claimed for the creator of the placeholder that was just claimed. */
export function notifyPlaceholderClaimed(
  tx: Transaction,
  input: { creatorId: string; claimedUserId: string },
): Promise<string[]> {
  return insertNotifications(tx, [
    {
      recipientUserId: input.creatorId,
      type: 'placeholder_claimed',
      dedupeKey: `placeholder_claimed:${input.claimedUserId}`,
      actorUserId: input.claimedUserId,
      subjectUserId: input.claimedUserId,
    },
  ]);
}

/**
 * group_member_joined for the group's OWNER/ADMINs (the joiner excluded by the caller). The join
 * time is part of the event identity so a later rejoin is a new event.
 */
export function notifyGroupMemberJoined(
  tx: Transaction,
  input: { groupId: string; joinerId: string; joinedAt: Date; recipientIds: readonly string[] },
): Promise<string[]> {
  return insertNotifications(
    tx,
    input.recipientIds.map((recipientUserId) => ({
      recipientUserId,
      type: 'group_member_joined' as const,
      dedupeKey: `group_member_joined:${input.groupId}:${input.joinerId}:${input.joinedAt.getTime()}`,
      actorUserId: input.joinerId,
      subjectUserId: input.joinerId,
      groupId: input.groupId,
    })),
  );
}

export type ChallengeNotificationType = Extract<NotificationType, `challenge_${string}`>;

export interface ChallengeNotificationRecipient {
  userId: string;
  actorUserId?: string | null;
  /** The other challenged player, named in the rendered text. */
  subjectUserId?: string | null;
}

/** One challenge event for each recipient; the event identity is the challenge and its type. */
export function notifyChallengeEvent(
  tx: Transaction,
  input: {
    type: ChallengeNotificationType;
    challengeId: string;
    recipients: readonly ChallengeNotificationRecipient[];
  },
): Promise<string[]> {
  return insertNotifications(
    tx,
    input.recipients.map((r) => ({
      recipientUserId: r.userId,
      type: input.type,
      dedupeKey: `${input.type}:${input.challengeId}`,
      actorUserId: r.actorUserId ?? null,
      subjectUserId: r.subjectUserId ?? null,
      challengeId: input.challengeId,
    })),
  );
}

export interface NotificationView {
  notification: NotificationRow;
  actor: UserRow | null;
  title: string;
  body: string;
  target: NotificationTarget | null;
}

const actors = alias(users, 'actor');
const subjects = alias(users, 'subject');
const recipients = alias(users, 'recipient');
const challengeTournaments = alias(tournaments, 'challenge_tournament');

/**
 * Rows the viewer owns whose source context (game, group, challenge) they may still read. The
 * challenge subquery's own `tournaments` shadows the outer game join inside it.
 */
function ownVisible(viewerId: string): SQL | undefined {
  return and(
    eq(notifications.recipientUserId, viewerId),
    or(isNull(notifications.gameId), visibleTournamentsFilter(viewerId)),
    or(
      isNull(notifications.groupId),
      sql`exists (select 1 from ${groupMembers} where ${groupMembers.groupId} = ${notifications.groupId} and ${groupMembers.userId} = ${viewerId})`,
    ),
    or(
      isNull(notifications.challengeId),
      sql`exists (select 1 from ${challenges} inner join ${tournaments} on ${tournaments.id} = ${challenges.tournamentId} where ${challenges.id} = ${notifications.challengeId} and ${visibleTournamentsFilter(viewerId)})`,
    ),
  );
}

type OutcomeWithUser = { outcome: typeof outcomes.$inferSelect; user: UserRow };

function displayName(user: UserRow): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full === '' ? user.username : full;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 3) {
    return names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
}

function signedElo(delta: number): string {
  return `${delta >= 0 ? '+' : '-'}${Math.abs(Math.round(delta))}`;
}

function describeGame(
  recipientId: string,
  tournamentName: string,
  played: readonly OutcomeWithUser[],
): { title: string; body: string } {
  const winners = played.filter((o) => o.outcome.result === 'WIN');
  const losers = played.filter((o) => o.outcome.result === 'LOSS');
  const others = (team: readonly OutcomeWithUser[]) =>
    team.filter((o) => o.user.id !== recipientId).map((o) => o.user.username);
  const mine = played.find((o) => o.user.id === recipientId);
  if (!mine) {
    return {
      title: `Game recorded in ${tournamentName}`,
      body: `${joinNames(others(winners))} beat ${joinNames(others(losers))}`,
    };
  }
  const won = mine.outcome.result === 'WIN';
  const mates = others(won ? winners : losers);
  const opponents = joinNames(others(won ? losers : winners));
  const elo = `(${signedElo(mine.outcome.scoreValue)} Elo)`;
  return won
    ? {
        title: `You won in ${tournamentName}`,
        body: `${mates.length > 0 ? `You and ${joinNames(mates)}` : 'You'} beat ${opponents} ${elo}`,
      }
    : {
        title: `You lost in ${tournamentName}`,
        body: `${opponents} beat ${mates.length > 0 ? `you and ${joinNames(mates)}` : 'you'} ${elo}`,
      };
}

const CHALLENGE_TITLES: Record<ChallengeNotificationType, string> = {
  challenge_received: 'New challenge',
  challenge_accepted: 'Challenge accepted',
  challenge_declined: 'Challenge declined',
  challenge_expiring: 'Challenge expiring soon',
  challenge_expired: 'Challenge expired',
};

function describeChallenge(
  type: ChallengeNotificationType,
  row: {
    notification: NotificationRow;
    actor: UserRow | null;
    subject: UserRow | null;
    challengeTournament: typeof tournaments.$inferSelect | null;
  },
): Pick<NotificationView, 'title' | 'body' | 'target'> {
  const title = CHALLENGE_TITLES[type];
  const { notification, actor, subject, challengeTournament } = row;
  if (!notification.challengeId || !challengeTournament) {
    return { title, body: 'This challenge is no longer available.', target: null };
  }
  const where = challengeTournament.displayName;
  const actorName = actor ? displayName(actor) : 'Your opponent';
  const other = subject ? displayName(subject) : 'your opponent';
  const body = {
    challenge_received: `${actorName} challenged you in ${where}.`,
    challenge_accepted: `${actorName} accepted your challenge in ${where}.`,
    challenge_declined: `${actorName} declined your challenge in ${where}.`,
    challenge_expiring: `Your challenge with ${other} in ${where} expires within 24 hours.`,
    challenge_expired: `Your challenge with ${other} in ${where} expired.`,
  }[type];
  return { title, body, target: { type: 'challenge', challengeId: notification.challengeId } };
}

/** Display text and target built from trusted rows, never from stored free-form text. */
function render(
  row: {
    notification: NotificationRow;
    actor: UserRow | null;
    subject: UserRow | null;
    recipient: UserRow;
    tournament: typeof tournaments.$inferSelect | null;
    group: typeof groups.$inferSelect | null;
    challengeTournament: typeof tournaments.$inferSelect | null;
  },
  outcomesByGame: Map<string, OutcomeWithUser[]>,
): NotificationView {
  const { notification, actor, subject, recipient, tournament, group } = row;
  const base = { notification, actor };
  switch (notification.type) {
    case 'game_recorded': {
      if (!notification.gameId || !tournament) {
        return {
          ...base,
          title: 'Game recorded',
          body: 'This game is no longer available.',
          target: null,
        };
      }
      const text = describeGame(
        recipient.id,
        tournament.displayName,
        outcomesByGame.get(notification.gameId) ?? [],
      );
      return { ...base, ...text, target: { type: 'game', gameId: notification.gameId } };
    }
    case 'placeholder_claimed':
      return subject
        ? {
            ...base,
            title: 'Invite accepted',
            body: `${displayName(subject)} claimed their player profile.`,
            target: { type: 'user', username: subject.username },
          }
        : { ...base, title: 'Invite accepted', body: 'A player you invited joined.', target: null };
    case 'achievement_unlocked': {
      const achievement = findAchievement(notification.achievementCode ?? '');
      return {
        ...base,
        title: achievement ? `Achievement unlocked: ${achievement.title}` : 'Achievement unlocked',
        body: achievement?.description ?? 'You unlocked a new badge.',
        target: { type: 'achievements', username: recipient.username },
      };
    }
    case 'challenge_received':
    case 'challenge_accepted':
    case 'challenge_declined':
    case 'challenge_expiring':
    case 'challenge_expired':
      return { ...base, ...describeChallenge(notification.type, row) };
    case 'group_member_joined': {
      const who = subject ? displayName(subject) : 'Someone';
      return group
        ? {
            ...base,
            title: 'New group member',
            body: `${who} joined ${group.name}.`,
            target: { type: 'group', groupId: group.id },
          }
        : { ...base, title: 'New group member', body: `${who} joined a group.`, target: null };
    }
  }
}

/** Notifications of the viewer matching `where`, newest first, rendered for display or push. */
export async function loadNotificationViews(
  db: Database,
  viewerId: string,
  where: SQL | undefined,
  page?: PageWindow,
): Promise<NotificationView[]> {
  const query = db
    .select({
      notification: notifications,
      actor: actors,
      subject: subjects,
      recipient: recipients,
      tournament: tournaments,
      group: groups,
      challengeTournament: challengeTournaments,
    })
    .from(notifications)
    .innerJoin(recipients, eq(notifications.recipientUserId, recipients.id))
    .leftJoin(actors, eq(notifications.actorUserId, actors.id))
    .leftJoin(subjects, eq(notifications.subjectUserId, subjects.id))
    .leftJoin(games, eq(notifications.gameId, games.id))
    .leftJoin(tournaments, eq(games.tournamentId, tournaments.id))
    .leftJoin(groups, eq(notifications.groupId, groups.id))
    .leftJoin(challenges, eq(notifications.challengeId, challenges.id))
    .leftJoin(challengeTournaments, eq(challenges.tournamentId, challengeTournaments.id))
    .where(and(ownVisible(viewerId), where))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));
  const rows = page ? await query.limit(page.limit).offset(page.offset) : await query;

  const gameIds = [
    ...new Set(rows.flatMap((r) => (r.notification.gameId ? [r.notification.gameId] : []))),
  ];
  const outcomesByGame = new Map<string, OutcomeWithUser[]>();
  if (gameIds.length > 0) {
    const outcomeRows = await db
      .select({ outcome: outcomes, user: users })
      .from(outcomes)
      .innerJoin(users, eq(outcomes.userId, users.id))
      .where(inArray(outcomes.gameId, gameIds))
      .orderBy(asc(outcomes.result), asc(users.username));
    for (const row of outcomeRows) {
      const list = outcomesByGame.get(row.outcome.gameId) ?? [];
      list.push(row);
      outcomesByGame.set(row.outcome.gameId, list);
    }
  }
  return rows.map((row) => render(row, outcomesByGame));
}

export function listNotifications(
  db: Database,
  viewerId: string,
  filter: { unreadOnly: boolean },
  page: PageWindow,
): Promise<NotificationView[]> {
  return loadNotificationViews(
    db,
    viewerId,
    filter.unreadOnly ? isNull(notifications.readAt) : undefined,
    page,
  );
}

export async function countUnreadNotifications(db: Database, viewerId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .leftJoin(games, eq(notifications.gameId, games.id))
    .leftJoin(tournaments, eq(games.tournamentId, tournaments.id))
    .where(and(ownVisible(viewerId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

function notificationNotFound(): ApiError {
  return ApiError.notFound('Notification not found', 'NOTIFICATION_NOT_FOUND');
}

/** Marks one of the viewer's notifications read; already-read rows keep their first readAt. */
export async function markNotificationRead(
  db: Database,
  viewerId: string,
  notificationId: string,
  now: Date,
): Promise<NotificationView> {
  const [visible] = await loadNotificationViews(db, viewerId, eq(notifications.id, notificationId));
  if (!visible) throw notificationNotFound();
  if (visible.notification.readAt !== null) return visible;
  const [updated] = await db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientUserId, viewerId),
        isNull(notifications.readAt),
      ),
    )
    .returning();
  // A concurrent request may have marked it first; either way the stored row is authoritative.
  if (updated) return { ...visible, notification: updated };
  const [current] = await loadNotificationViews(db, viewerId, eq(notifications.id, notificationId));
  if (!current) throw notificationNotFound();
  return current;
}

export async function markAllNotificationsRead(
  db: Database,
  viewerId: string,
  now: Date,
): Promise<void> {
  const visibleUnread = db
    .select({ id: notifications.id })
    .from(notifications)
    .leftJoin(games, eq(notifications.gameId, games.id))
    .leftJoin(tournaments, eq(games.tournamentId, tournaments.id))
    .where(and(ownVisible(viewerId), isNull(notifications.readAt)));
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.recipientUserId, viewerId),
        isNull(notifications.readAt),
        inArray(notifications.id, visibleUnread),
      ),
    );
}

export type NotificationPreferences = Record<NotificationCategory, boolean>;

const PREFERENCE_COLUMNS = {
  games: 'gamesEnabled',
  challenges: 'challengesEnabled',
  achievements: 'achievementsEnabled',
  claims: 'claimsEnabled',
  groups: 'groupsEnabled',
} as const satisfies Record<
  NotificationCategory,
  keyof typeof notificationPreferences.$inferSelect
>;

const ALL_ENABLED: NotificationPreferences = {
  games: true,
  challenges: true,
  achievements: true,
  claims: true,
  groups: true,
};

function toPreferences(row: typeof notificationPreferences.$inferSelect): NotificationPreferences {
  return {
    games: row.gamesEnabled,
    challenges: row.challengesEnabled,
    achievements: row.achievementsEnabled,
    claims: row.claimsEnabled,
    groups: row.groupsEnabled,
  };
}

/** Push preferences of each user; users without a stored row get every category enabled. */
export async function getPreferencesFor(
  db: Database,
  userIds: readonly string[],
): Promise<Map<string, NotificationPreferences>> {
  const result = new Map(userIds.map((id) => [id, ALL_ENABLED]));
  if (userIds.length === 0) return result;
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, [...userIds]));
  for (const row of rows) result.set(row.userId, toPreferences(row));
  return result;
}

export async function getNotificationPreferences(
  db: Database,
  userId: string,
): Promise<NotificationPreferences> {
  return (await getPreferencesFor(db, [userId])).get(userId) ?? ALL_ENABLED;
}

/** Changes only the given categories; the others keep their stored (or default) value. */
export async function updateNotificationPreferences(
  db: Database,
  userId: string,
  update: Partial<NotificationPreferences>,
  now: Date,
): Promise<NotificationPreferences> {
  const changes: Partial<typeof notificationPreferences.$inferInsert> = {};
  for (const category of notificationCategory.enumValues) {
    const value = update[category];
    if (value !== undefined) changes[PREFERENCE_COLUMNS[category]] = value;
  }
  const [row] = await db
    .insert(notificationPreferences)
    .values({ userId, ...changes, updatedAt: now })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { ...changes, updatedAt: now },
    })
    .returning();
  if (!row) throw new Error('preferences upsert returned no row');
  return toPreferences(row);
}
