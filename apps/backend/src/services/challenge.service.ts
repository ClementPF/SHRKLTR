import { and, asc, desc, eq, inArray, isNull, lte, gt, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../db/client.js';
import { challenges, challengeStatus, groups, sports, tournaments, users } from '../db/schema.js';
import { isUniqueViolation } from '../lib/db-errors.js';
import { ApiError } from '../lib/errors.js';
import type { PageWindow } from '../lib/pagination.js';
import { awardAchievements } from './achievement.service.js';
import { findMemberRole, lockGroups } from './group.service.js';
import { notifyChallengeEvent, type ChallengeNotificationType } from './notification.service.js';
import { requireRegisteredUser } from './placeholder.service.js';
import { findVisibleTournamentByName, type TournamentWithRelations } from './tournament.service.js';
import { findVisibleUserByUsername } from './user.service.js';
import { canViewTournament, visibleTournamentsFilter } from './visibility.service.js';

export type ChallengeStatus = (typeof challengeStatus.enumValues)[number];
type ChallengeRow = typeof challenges.$inferSelect;
type UserRow = typeof users.$inferSelect;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const DEFAULT_CHALLENGE_DURATION_MS = 7 * DAY_MS;
export const MIN_CHALLENGE_DURATION_MS = HOUR_MS;
export const MAX_CHALLENGE_DURATION_MS = 30 * DAY_MS;
/** Active challenges whose deadline is this close get one challenge_expiring reminder. */
export const CHALLENGE_REMINDER_WINDOW_MS = DAY_MS;

const ACTIVE_STATUSES: ChallengeStatus[] = ['PENDING', 'ACCEPTED'];
const ACTIVE_PAIR_INDEX = 'challenges_active_pair_unique';

export interface ChallengeView {
  challenge: ChallengeRow;
  tournament: TournamentWithRelations;
  challenger: UserRow;
  opponent: UserRow;
  winner: UserRow | null;
}

export const challengeNotFound = () =>
  ApiError.notFound('Challenge not found', 'CHALLENGE_NOT_FOUND');

export const challengeExpired = () =>
  ApiError.badRequest('This challenge has expired', 'CHALLENGE_EXPIRED');

const challengeNotPending = () =>
  ApiError.badRequest('This challenge is no longer waiting for an answer', 'CHALLENGE_NOT_PENDING');

const activeChallengeExists = () =>
  ApiError.badRequest(
    'You already have an active challenge with this player in this tournament',
    'ACTIVE_CHALLENGE_EXISTS',
  );

const tournamentNotFound = () => ApiError.notFound('Tournament not found', 'TOURNAMENT_NOT_FOUND');

const tournamentOwners = alias(users, 'tournament_owner');
const challengers = alias(users, 'challenger');
const opponents = alias(users, 'opponent');
const winners = alias(users, 'winner');

function selectViews(db: Pick<Database, 'select'>) {
  return db
    .select({
      challenge: challenges,
      tournament: tournaments,
      sport: sports,
      owner: tournamentOwners,
      group: groups,
      challenger: challengers,
      opponent: opponents,
      winner: winners,
    })
    .from(challenges)
    .innerJoin(tournaments, eq(challenges.tournamentId, tournaments.id))
    .innerJoin(sports, eq(tournaments.sportId, sports.id))
    .leftJoin(tournamentOwners, eq(tournaments.ownerUserId, tournamentOwners.id))
    .leftJoin(groups, eq(tournaments.groupId, groups.id))
    .innerJoin(challengers, eq(challenges.challengerUserId, challengers.id))
    .innerJoin(opponents, eq(challenges.opponentUserId, opponents.id))
    .leftJoin(winners, eq(challenges.winnerUserId, winners.id));
}

type ViewRow = Awaited<ReturnType<ReturnType<typeof selectViews>['where']>>[number];

function toView(row: ViewRow): ChallengeView {
  return {
    challenge: row.challenge,
    tournament: {
      tournament: row.tournament,
      sport: row.sport,
      owner: row.owner,
      group: row.group,
    },
    challenger: row.challenger,
    opponent: row.opponent,
    winner: row.winner,
  };
}

/** Challenges the viewer took part in, in tournaments the viewer can currently read. */
function ownVisible(viewerId: string): SQL | undefined {
  return and(
    or(eq(challenges.challengerUserId, viewerId), eq(challenges.opponentUserId, viewerId)),
    visibleTournamentsFilter(viewerId),
  );
}

async function loadView(db: Pick<Database, 'select'>, challengeId: string): Promise<ChallengeView> {
  const [row] = await selectViews(db).where(eq(challenges.id, challengeId)).limit(1);
  if (!row) throw challengeNotFound();
  return toView(row);
}

/**
 * The viewer's challenges (sent and received), newest first. Visibility is part of the query so
 * paging never counts challenges of tournaments the viewer can no longer read.
 */
export async function listChallenges(
  db: Database,
  viewerId: string,
  filter: { statuses?: readonly ChallengeStatus[] | undefined },
  page: PageWindow,
): Promise<ChallengeView[]> {
  const rows = await selectViews(db)
    .where(
      and(
        ownVisible(viewerId),
        filter.statuses && filter.statuses.length > 0
          ? inArray(challenges.status, [...filter.statuses])
          : undefined,
      ),
    )
    .orderBy(desc(challenges.createdAt), desc(challenges.id))
    .limit(page.limit)
    .offset(page.offset);
  return rows.map(toView);
}

/** One challenge of the viewer; other players' and invisible challenges are 404. */
export async function getChallenge(
  db: Database,
  challengeId: string,
  viewerId: string,
): Promise<ChallengeView> {
  const [row] = await selectViews(db)
    .where(and(eq(challenges.id, challengeId), ownVisible(viewerId)))
    .limit(1);
  if (!row) throw challengeNotFound();
  return toView(row);
}

function otherPlayer(row: ChallengeRow, userId: string): string {
  return row.challengerUserId === userId ? row.opponentUserId : row.challengerUserId;
}

function byId(a: ChallengeRow, b: ChallengeRow): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The same event for both players of each challenge, each naming the other one. */
async function notifyBoth(
  tx: Transaction,
  type: ChallengeNotificationType,
  rows: readonly ChallengeRow[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const row of [...rows].sort(byId)) {
    ids.push(
      ...(await notifyChallengeEvent(tx, {
        type,
        challengeId: row.id,
        recipients: [row.challengerUserId, row.opponentUserId].map((userId) => ({
          userId,
          subjectUserId: otherPlayer(row, userId),
        })),
      })),
    );
  }
  return ids;
}

/**
 * Expires challenges already locked by the caller (no winner, no game, no rating effect) and
 * notifies both players. Rows that stopped being active meanwhile are left untouched.
 */
async function expireLocked(
  tx: Transaction,
  rows: readonly ChallengeRow[],
  now: Date,
): Promise<{ expired: number; notificationIds: string[] }> {
  if (rows.length === 0) return { expired: 0, notificationIds: [] };
  const expired = await tx
    .update(challenges)
    .set({ status: 'EXPIRED', resolvedAt: now, updatedAt: now })
    .where(
      and(
        inArray(
          challenges.id,
          rows.map((r) => r.id),
        ),
        inArray(challenges.status, ACTIVE_STATUSES),
      ),
    )
    .returning();
  return {
    expired: expired.length,
    notificationIds: await notifyBoth(tx, 'challenge_expired', expired),
  };
}

/** Default now + 7 days; an explicit deadline must lie between 1 hour and 30 days ahead. */
export function resolveDeadline(deadlineAt: Date | undefined, now: Date): Date {
  if (deadlineAt === undefined) return new Date(now.getTime() + DEFAULT_CHALLENGE_DURATION_MS);
  const ahead = deadlineAt.getTime() - now.getTime();
  if (
    Number.isNaN(ahead) ||
    ahead < MIN_CHALLENGE_DURATION_MS ||
    ahead > MAX_CHALLENGE_DURATION_MS
  ) {
    throw ApiError.badRequest(
      'The deadline must be between 1 hour and 30 days from now',
      'INVALID_DEADLINE',
    );
  }
  return deadlineAt;
}

export interface CreateChallengeInput {
  callerId: string;
  tournamentName: string;
  opponentUsername: string;
  deadlineAt?: Date | undefined;
}

export interface ChallengeChange {
  view: ChallengeView;
  /** Inbox rows written by the change, to push once it has committed. */
  notificationIds: string[];
}

/**
 * Creates a PENDING challenge and its challenge_received notification. Both players must be
 * registered and able to read the tournament (current members of a grouped tournament's group).
 * A stale same-pair challenge whose deadline already passed is expired first.
 */
export async function createChallenge(
  db: Database,
  input: CreateChallengeInput,
  now: Date,
): Promise<ChallengeChange> {
  const caller = await requireRegisteredUser(db, input.callerId);
  const found = await findVisibleTournamentByName(db, input.tournamentName, caller.id);
  if (!found) throw tournamentNotFound();
  const opponent = await findVisibleUserByUsername(db, input.opponentUsername, caller.id);
  if (!opponent) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
  if (opponent.id === caller.id) {
    throw ApiError.badRequest('You cannot challenge yourself', 'SELF_CHALLENGE');
  }
  if (opponent.accountType !== 'REGISTERED') {
    throw ApiError.badRequest(
      'Only registered players can be challenged',
      'OPPONENT_NOT_REGISTERED',
    );
  }
  const deadlineAt = resolveDeadline(input.deadlineAt, now);
  const { tournament } = found;
  const [pairLowUserId, pairHighUserId] = [caller.id, opponent.id].sort() as [string, string];

  let created: { id: string; notificationIds: string[] };
  try {
    created = await db.transaction(async (tx) => {
      if (tournament.groupId) {
        // SHARE on the group row: a concurrent leave/remove waits until this challenge exists.
        await lockGroups(tx, [tournament.groupId], 'share');
        if (!(await findMemberRole(tx, tournament.groupId, caller.id))) throw tournamentNotFound();
        if (!(await findMemberRole(tx, tournament.groupId, opponent.id))) {
          throw ApiError.badRequest(
            "This player is not a member of the tournament's group",
            'PLAYER_NOT_GROUP_MEMBER',
          );
        }
      }
      const active = await tx
        .select()
        .from(challenges)
        .where(
          and(
            eq(challenges.tournamentId, tournament.id),
            eq(challenges.pairLowUserId, pairLowUserId),
            eq(challenges.pairHighUserId, pairHighUserId),
            inArray(challenges.status, ACTIVE_STATUSES),
          ),
        )
        .orderBy(asc(challenges.id))
        .for('update');
      if (active.some((row) => row.deadlineAt.getTime() > now.getTime())) {
        throw activeChallengeExists();
      }
      const stale = await expireLocked(tx, active, now);

      const [row] = await tx
        .insert(challenges)
        .values({
          tournamentId: tournament.id,
          challengerUserId: caller.id,
          opponentUserId: opponent.id,
          pairLowUserId,
          pairHighUserId,
          deadlineAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error('challenge insert returned no row');
      const received = await notifyChallengeEvent(tx, {
        type: 'challenge_received',
        challengeId: row.id,
        recipients: [{ userId: opponent.id, actorUserId: caller.id, subjectUserId: caller.id }],
      });
      return { id: row.id, notificationIds: [...stale.notificationIds, ...received] };
    });
  } catch (err) {
    // A concurrent creation for the same pair (either direction) committed first.
    if (isUniqueViolation(err, ACTIVE_PAIR_INDEX)) throw activeChallengeExists();
    throw err;
  }
  return { view: await loadView(db, created.id), notificationIds: created.notificationIds };
}

export type ChallengeResponse = 'ACCEPT' | 'DECLINE';

export type ChallengeResponseResult =
  ({ expired: false } & ChallengeChange) | { expired: true; notificationIds: string[] };

/**
 * The opponent accepts or declines a PENDING challenge. Repeating the answer already given
 * returns the challenge unchanged without new events; any other answer to an answered challenge
 * is CHALLENGE_NOT_PENDING. A challenge found past its deadline is expired here (result
 * `expired: true`, which the caller reports as CHALLENGE_EXPIRED once committed). The clock is
 * read once the challenge row is locked, so time spent waiting for a concurrent sweep or game
 * counts against the deadline.
 */
export async function respondToChallenge(
  db: Database,
  input: { challengeId: string; callerId: string; response: ChallengeResponse },
  clock: () => Date,
): Promise<ChallengeResponseResult> {
  const result = await db.transaction(async (tx) => {
    const [peek] = await tx
      .select({ groupId: tournaments.groupId })
      .from(challenges)
      .innerJoin(tournaments, eq(challenges.tournamentId, tournaments.id))
      .where(eq(challenges.id, input.challengeId))
      .limit(1);
    if (!peek) throw challengeNotFound();
    // Lock order shared with game submission: group row, then the challenge row.
    if (peek.groupId) await lockGroups(tx, [peek.groupId], 'share');
    const [row] = await tx
      .select()
      .from(challenges)
      .where(eq(challenges.id, input.challengeId))
      .for('update');
    if (
      !row ||
      (row.challengerUserId !== input.callerId && row.opponentUserId !== input.callerId) ||
      !(await canViewTournament(tx, { groupId: peek.groupId }, input.callerId))
    ) {
      throw challengeNotFound();
    }
    if (row.opponentUserId !== input.callerId) {
      throw ApiError.forbidden(
        'Only the challenged player can answer this challenge',
        'NOT_CHALLENGE_OPPONENT',
      );
    }

    const now = clock();
    const active = ACTIVE_STATUSES.includes(row.status);
    if (active && row.deadlineAt.getTime() <= now.getTime()) {
      const { notificationIds } = await expireLocked(tx, [row], now);
      return { expired: true as const, notificationIds };
    }
    if (row.status === 'EXPIRED') throw challengeExpired();
    if (
      (row.status === 'ACCEPTED' && input.response === 'ACCEPT') ||
      (row.status === 'DECLINED' && input.response === 'DECLINE')
    ) {
      return { expired: false as const, notificationIds: [] };
    }
    if (row.status !== 'PENDING') throw challengeNotPending();

    const accepted = input.response === 'ACCEPT';
    await tx
      .update(challenges)
      .set(
        accepted
          ? { status: 'ACCEPTED', acceptedAt: now, updatedAt: now }
          : { status: 'DECLINED', resolvedAt: now, updatedAt: now },
      )
      .where(eq(challenges.id, row.id));
    const notificationIds = await notifyChallengeEvent(tx, {
      type: accepted ? 'challenge_accepted' : 'challenge_declined',
      challengeId: row.id,
      recipients: [
        {
          userId: row.challengerUserId,
          actorUserId: row.opponentUserId,
          subjectUserId: row.opponentUserId,
        },
      ],
    });
    return { expired: false as const, notificationIds };
  });
  if (result.expired) return result;
  return { ...result, view: await loadView(db, input.challengeId) };
}

export interface GameParticipantResult {
  userId: string;
  result: 'WIN' | 'LOSS';
}

/**
 * Completes, inside the game's transaction, every ACCEPTED challenge of the tournament whose two
 * players were on opposite teams of this game. `at` is the game operation time, taken once the
 * participants' stats are locked: the challenge must have been accepted at or before it and its
 * deadline must be strictly after it. Winners unlock first_challenge_won.
 */
export async function completeChallengesForGame(
  tx: Transaction,
  input: {
    gameId: string;
    tournamentId: string;
    participants: readonly GameParticipantResult[];
    at: Date;
  },
): Promise<{ completedIds: string[]; notificationIds: string[] }> {
  const resultOf = new Map(input.participants.map((p) => [p.userId, p.result]));
  const ids = [...resultOf.keys()];
  if (ids.length < 2) return { completedIds: [], notificationIds: [] };
  const candidates = await tx
    .select()
    .from(challenges)
    .where(
      and(
        eq(challenges.tournamentId, input.tournamentId),
        eq(challenges.status, 'ACCEPTED'),
        inArray(challenges.challengerUserId, ids),
        inArray(challenges.opponentUserId, ids),
      ),
    )
    .orderBy(asc(challenges.id))
    .for('update');
  const at = input.at.getTime();
  const eligible = candidates.filter(
    (c) =>
      c.status === 'ACCEPTED' &&
      resultOf.get(c.challengerUserId) !== resultOf.get(c.opponentUserId) &&
      c.acceptedAt !== null &&
      c.acceptedAt.getTime() <= at &&
      at < c.deadlineAt.getTime(),
  );
  const completedIds: string[] = [];
  const awards: Parameters<typeof awardAchievements>[1][number][] = [];
  for (const challenge of eligible) {
    const winnerUserId =
      resultOf.get(challenge.challengerUserId) === 'WIN'
        ? challenge.challengerUserId
        : challenge.opponentUserId;
    const [done] = await tx
      .update(challenges)
      .set({
        status: 'COMPLETED',
        resolvedAt: input.at,
        gameId: input.gameId,
        winnerUserId,
        updatedAt: input.at,
      })
      .where(and(eq(challenges.id, challenge.id), eq(challenges.status, 'ACCEPTED')))
      .returning({ id: challenges.id });
    if (!done) continue;
    completedIds.push(done.id);
    awards.push({
      userId: winnerUserId,
      code: 'first_challenge_won',
      sourceType: 'CHALLENGE',
      sourceChallengeId: done.id,
      sourceGameId: input.gameId,
    });
  }
  const badges = await awardAchievements(tx, awards);
  return { completedIds, notificationIds: badges.notificationIds };
}

export interface SweepResult {
  expired: number;
  reminded: number;
  /** Inbox rows written by the sweep, to push after it returns. */
  notificationIds: string[];
}

export const SWEEP_BATCH_SIZE = 100;

/**
 * Deadline maintenance at `now`, in bounded batches each in its own transaction: first expires
 * every active challenge whose deadline is at or before now, then sends one challenge_expiring
 * reminder for active challenges due within the next 24 hours. Rows are locked and rechecked, so
 * concurrent sweeps, answers and games never resolve a challenge twice.
 */
export async function sweepChallenges(
  db: Database,
  now: Date,
  batchSize: number = SWEEP_BATCH_SIZE,
): Promise<SweepResult> {
  const result: SweepResult = { expired: 0, reminded: 0, notificationIds: [] };

  for (;;) {
    const batch = await db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(challenges)
        .where(and(inArray(challenges.status, ACTIVE_STATUSES), lte(challenges.deadlineAt, now)))
        .orderBy(asc(challenges.id))
        .limit(batchSize)
        .for('update');
      return { found: due.length, ...(await expireLocked(tx, due, now)) };
    });
    result.notificationIds.push(...batch.notificationIds);
    result.expired += batch.expired;
    if (batch.found < batchSize) break;
  }

  const windowEnd = new Date(now.getTime() + CHALLENGE_REMINDER_WINDOW_MS);
  for (;;) {
    const batch = await db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(challenges)
        .where(
          and(
            inArray(challenges.status, ACTIVE_STATUSES),
            gt(challenges.deadlineAt, now),
            lte(challenges.deadlineAt, windowEnd),
            isNull(challenges.expiringNotifiedAt),
          ),
        )
        .orderBy(asc(challenges.id))
        .limit(batchSize)
        .for('update');
      if (due.length === 0) return { found: 0, reminded: 0, notified: [] as string[] };
      const marked = await tx
        .update(challenges)
        .set({ expiringNotifiedAt: now, updatedAt: now })
        .where(
          and(
            inArray(
              challenges.id,
              due.map((r) => r.id),
            ),
            inArray(challenges.status, ACTIVE_STATUSES),
            isNull(challenges.expiringNotifiedAt),
          ),
        )
        .returning();
      const notified = await notifyBoth(tx, 'challenge_expiring', marked);
      return { found: due.length, reminded: marked.length, notified };
    });
    result.notificationIds.push(...batch.notified);
    result.reminded += batch.reminded;
    if (batch.found < batchSize) break;
  }
  return result;
}
