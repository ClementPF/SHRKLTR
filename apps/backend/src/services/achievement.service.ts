import { and, asc, countDistinct, desc, eq, inArray } from 'drizzle-orm';
import {
  crossedThresholds,
  GAME_COUNT_THRESHOLDS,
  GIANT_KILLER_GAP,
  SPORT_COUNT_THRESHOLDS,
  WIN_STREAK_THRESHOLDS,
  type AchievementCode,
} from '../achievements/catalog.js';
import type { Database, Transaction } from '../db/client.js';
import {
  achievementSource,
  games,
  groupMembers,
  outcomes,
  stats,
  tournaments,
  userAchievements,
  users,
} from '../db/schema.js';
import type { PageWindow } from '../lib/pagination.js';
import { insertNotifications } from './notification.service.js';
import { visibleTournamentsFilter } from './visibility.service.js';

export type AchievementSource = (typeof achievementSource.enumValues)[number];
type UserAchievementRow = typeof userAchievements.$inferSelect;
type UserRow = typeof users.$inferSelect;

export interface AchievementAward {
  userId: string;
  code: AchievementCode;
  sourceType: AchievementSource;
  sourceGameId?: string | null;
  sourceGroupId?: string | null;
}

export interface AwardResult {
  unlocked: { userId: string; code: AchievementCode }[];
  /** achievement_unlocked inbox rows, to push once the transaction has committed. */
  notificationIds: string[];
}

/**
 * Inserts each badge at most once per user and code, inside the caller's transaction. Only
 * badges inserted by this call (not ones already unlocked) get an achievement_unlocked inbox row.
 */
export async function awardAchievements(
  tx: Transaction,
  awards: readonly AchievementAward[],
): Promise<AwardResult> {
  const unique = new Map<string, AchievementAward>();
  for (const award of awards) {
    const key = `${award.userId}:${award.code}`;
    if (!unique.has(key)) unique.set(key, award);
  }
  if (unique.size === 0) return { unlocked: [], notificationIds: [] };
  // Deterministic insert order keeps concurrent awarders from deadlocking on the primary key.
  const ordered = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const inserted = await tx
    .insert(userAchievements)
    .values(
      ordered.map(([, a]) => ({
        userId: a.userId,
        achievementCode: a.code,
        sourceType: a.sourceType,
        sourceGameId: a.sourceGameId ?? null,
        sourceGroupId: a.sourceGroupId ?? null,
      })),
    )
    .onConflictDoNothing({ target: [userAchievements.userId, userAchievements.achievementCode] })
    .returning({ userId: userAchievements.userId, code: userAchievements.achievementCode });
  const unlocked = inserted.map((row) => ({
    userId: row.userId,
    code: row.code as AchievementCode,
  }));
  const notificationIds = await insertNotifications(
    tx,
    unlocked.map((u) => ({
      recipientUserId: u.userId,
      type: 'achievement_unlocked' as const,
      dedupeKey: `achievement_unlocked:${u.code}`,
      achievementCode: u.code,
    })),
  );
  return { unlocked, notificationIds };
}

/**
 * Locks participants' user rows in id order so concurrent games sharing a player evaluate
 * cross-tournament totals (games, sports) one after the other instead of each missing the other.
 */
export async function lockAchievementOwners(
  tx: Transaction,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await tx
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]))
    .orderBy(asc(users.id))
    .for('no key update');
}

function average(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Team averages of decimal ratings are not exact in binary floating point.
const RATING_EPSILON = 1e-9;

/**
 * Game badges earned by a game just recorded in this transaction (its outcomes, stats and the
 * participants' earlier history are all visible here). Awards every newly crossed threshold.
 */
export async function evaluateGameAchievements(
  tx: Transaction,
  gameId: string,
): Promise<AwardResult> {
  const played = await tx
    .select({
      userId: outcomes.userId,
      result: outcomes.result,
      ratingBefore: outcomes.ratingBefore,
      tournamentId: games.tournamentId,
    })
    .from(outcomes)
    .innerJoin(games, eq(outcomes.gameId, games.id))
    .where(eq(outcomes.gameId, gameId));
  if (played.length === 0) return { unlocked: [], notificationIds: [] };
  const tournamentId = played[0]!.tournamentId;
  const userIds = played.map((p) => p.userId);
  const winners = played.filter((p) => p.result === 'WIN');
  const losers = played.filter((p) => p.result === 'LOSS');
  const winnerIds = winners.map((w) => w.userId);

  const codes: { userId: string; code: AchievementCode }[] = [];
  for (const userId of winnerIds) codes.push({ userId, code: 'first_win' });

  if (winnerIds.length > 0) {
    const streaks = await tx
      .select({ userId: stats.userId, winStreak: stats.winStreak })
      .from(stats)
      .where(and(eq(stats.tournamentId, tournamentId), inArray(stats.userId, winnerIds)));
    for (const row of streaks) {
      for (const code of crossedThresholds(WIN_STREAK_THRESHOLDS, row.winStreak)) {
        codes.push({ userId: row.userId, code });
      }
    }
  }

  const gameCounts = await tx
    .select({ userId: outcomes.userId, n: countDistinct(outcomes.gameId) })
    .from(outcomes)
    .where(inArray(outcomes.userId, userIds))
    .groupBy(outcomes.userId);
  for (const row of gameCounts) {
    for (const code of crossedThresholds(GAME_COUNT_THRESHOLDS, row.n)) {
      codes.push({ userId: row.userId, code });
    }
  }

  const sportCounts = await tx
    .select({ userId: outcomes.userId, n: countDistinct(tournaments.sportId) })
    .from(outcomes)
    .innerJoin(games, eq(outcomes.gameId, games.id))
    .innerJoin(tournaments, eq(games.tournamentId, tournaments.id))
    .where(inArray(outcomes.userId, userIds))
    .groupBy(outcomes.userId);
  for (const row of sportCounts) {
    for (const code of crossedThresholds(SPORT_COUNT_THRESHOLDS, row.n)) {
      codes.push({ userId: row.userId, code });
    }
  }

  const winnerRatings = winners.map((w) => w.ratingBefore);
  const loserRatings = losers.map((l) => l.ratingBefore);
  if (
    winners.length > 0 &&
    losers.length > 0 &&
    winnerRatings.every((r) => r !== null) &&
    loserRatings.every((r) => r !== null)
  ) {
    const gap = average(loserRatings) - average(winnerRatings);
    if (gap >= GIANT_KILLER_GAP - RATING_EPSILON) {
      for (const userId of winnerIds) codes.push({ userId, code: 'giant_killer' });
    }
  }

  return awardAchievements(
    tx,
    codes.map((c) => ({ ...c, sourceType: 'GAME' as const, sourceGameId: gameId })),
  );
}

/**
 * Ids among `gameIds` whose tournament the viewer may read; other source links are withheld
 * while the badge itself stays visible.
 */
async function visibleSourceGames(
  db: Database,
  viewerId: string,
  gameIds: readonly string[],
): Promise<Set<string>> {
  if (gameIds.length === 0) return new Set();
  const rows = await db
    .select({ id: games.id })
    .from(games)
    .innerJoin(tournaments, eq(games.tournamentId, tournaments.id))
    .where(and(inArray(games.id, [...new Set(gameIds)]), visibleTournamentsFilter(viewerId)));
  return new Set(rows.map((r) => r.id));
}

/** Ids among `groupIds` of groups the viewer currently belongs to. */
async function visibleSourceGroups(
  db: Database,
  viewerId: string,
  groupIds: readonly string[],
): Promise<Set<string>> {
  if (groupIds.length === 0) return new Set();
  const rows = await db
    .select({ id: groupMembers.groupId })
    .from(groupMembers)
    .where(
      and(eq(groupMembers.userId, viewerId), inArray(groupMembers.groupId, [...new Set(groupIds)])),
    );
  return new Set(rows.map((r) => r.id));
}

export interface UnlockView {
  achievement: UserAchievementRow;
  /** Source game id, or null when there is none or the viewer may not see it. */
  visibleSourceGameId: string | null;
  /** Source group id, or null when there is none or the viewer is not a member. */
  visibleSourceGroupId: string | null;
}

async function withVisibleSources(
  db: Database,
  viewerId: string,
  rows: readonly UserAchievementRow[],
): Promise<UnlockView[]> {
  const [visible, visibleGroups] = await Promise.all([
    visibleSourceGames(
      db,
      viewerId,
      rows.flatMap((r) => (r.sourceGameId ? [r.sourceGameId] : [])),
    ),
    visibleSourceGroups(
      db,
      viewerId,
      rows.flatMap((r) => (r.sourceGroupId ? [r.sourceGroupId] : [])),
    ),
  ]);
  return rows.map((achievement) => ({
    achievement,
    visibleSourceGameId:
      achievement.sourceGameId && visible.has(achievement.sourceGameId)
        ? achievement.sourceGameId
        : null,
    visibleSourceGroupId:
      achievement.sourceGroupId && visibleGroups.has(achievement.sourceGroupId)
        ? achievement.sourceGroupId
        : null,
  }));
}

/** Every badge the user unlocked, as seen by the viewer. */
export async function listUnlocks(
  db: Database,
  viewerId: string,
  userId: string,
): Promise<UnlockView[]> {
  const rows = await db
    .select()
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId))
    .orderBy(desc(userAchievements.unlockedAt), asc(userAchievements.achievementCode));
  return withVisibleSources(db, viewerId, rows);
}

/** The viewer's own unlocks, newest first, for the personal feed. */
export async function listRecentUnlocks(
  db: Database,
  viewer: UserRow,
  page: PageWindow,
): Promise<UnlockView[]> {
  const rows = await db
    .select()
    .from(userAchievements)
    .where(eq(userAchievements.userId, viewer.id))
    .orderBy(desc(userAchievements.unlockedAt), asc(userAchievements.achievementCode))
    .limit(page.limit)
    .offset(page.offset);
  return withVisibleSources(db, viewer.id, rows);
}
