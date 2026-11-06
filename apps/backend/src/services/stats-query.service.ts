import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../db/client.js';
import { groups, rivalryStats, sports, stats, tournaments, users } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { requireVisibleTournament, type TournamentWithRelations } from './tournament.service.js';
import { requireVisibleUser } from './user.service.js';
import { openTournamentsFilter, visibleTournamentsFilter } from './visibility.service.js';

type StatsRow = typeof stats.$inferSelect;
type RivalryRow = typeof rivalryStats.$inferSelect;
type UserRow = typeof users.$inferSelect;

export interface RivalryWithRelations {
  rivalry: RivalryRow;
  user: UserRow;
  rival: UserRow;
  tournament: TournamentWithRelations;
}

export interface StatsWithRelations {
  stats: StatsRow;
  user: UserRow;
  tournament: TournamentWithRelations;
  bestRivalry: RivalryWithRelations | null;
  worstRivalry: RivalryWithRelations | null;
}

const owners = alias(users, 'owner');
const rivals = alias(users, 'rival');

/** Rivalry rows matching `where`, best score first, with users and tournament loaded. */
async function queryRivalries(db: Database, where: SQL | undefined) {
  const rows = await db
    .select({
      rivalry: rivalryStats,
      user: users,
      rival: rivals,
      tournament: tournaments,
      sport: sports,
      owner: owners,
      group: groups,
    })
    .from(rivalryStats)
    .innerJoin(users, eq(rivalryStats.userId, users.id))
    .innerJoin(rivals, eq(rivalryStats.rivalId, rivals.id))
    .innerJoin(tournaments, eq(rivalryStats.tournamentId, tournaments.id))
    .innerJoin(sports, eq(tournaments.sportId, sports.id))
    .leftJoin(owners, eq(tournaments.ownerUserId, owners.id))
    .leftJoin(groups, eq(tournaments.groupId, groups.id))
    .where(where)
    .orderBy(desc(rivalryStats.score), asc(tournaments.name), asc(rivals.username));
  return rows.map(
    ({ rivalry, user, rival, tournament, sport, owner, group }): RivalryWithRelations => ({
      rivalry,
      user,
      rival,
      tournament: { tournament, sport, owner, group },
    }),
  );
}

/** Stats rows matching `where` in the given order, with best/worst rivalries resolved. */
async function queryStats(
  db: Database,
  where: SQL | undefined,
  orderBy: SQL[],
): Promise<StatsWithRelations[]> {
  const rows = await db
    .select({
      stats,
      user: users,
      tournament: tournaments,
      sport: sports,
      owner: owners,
      group: groups,
    })
    .from(stats)
    .innerJoin(users, eq(stats.userId, users.id))
    .innerJoin(tournaments, eq(stats.tournamentId, tournaments.id))
    .innerJoin(sports, eq(tournaments.sportId, sports.id))
    .leftJoin(owners, eq(tournaments.ownerUserId, owners.id))
    .leftJoin(groups, eq(tournaments.groupId, groups.id))
    .where(where)
    .orderBy(...orderBy);

  const rivalryIds = rows.flatMap((r) =>
    [r.stats.bestRivalryId, r.stats.worstRivalryId].filter((id): id is string => id !== null),
  );
  const rivalryById = new Map(
    (rivalryIds.length === 0
      ? []
      : await queryRivalries(db, inArray(rivalryStats.id, rivalryIds))
    ).map((r) => [r.rivalry.id, r]),
  );
  const resolve = (id: string | null) => (id ? (rivalryById.get(id) ?? null) : null);

  return rows.map((r) => ({
    stats: r.stats,
    user: r.user,
    tournament: { tournament: r.tournament, sport: r.sport, owner: r.owner, group: r.group },
    bestRivalry: resolve(r.stats.bestRivalryId),
    worstRivalry: resolve(r.stats.worstRivalryId),
  }));
}

/** Tournament leaderboard: stats rows sorted by score, highest first. */
export async function listTournamentStats(
  db: Database,
  tournamentName: string,
  viewerId: string,
): Promise<StatsWithRelations[]> {
  const { tournament } = await requireVisibleTournament(db, tournamentName, viewerId);
  return queryStats(db, eq(stats.tournamentId, tournament.id), [
    desc(stats.score),
    asc(users.username),
  ]);
}

/** Stats rows of a user in tournaments the viewer may read, one per tournament, by name. */
export async function listUserStats(
  db: Database,
  username: string,
  viewerId: string,
): Promise<StatsWithRelations[]> {
  const user = await requireVisibleUser(db, username, viewerId);
  return queryStats(db, and(eq(stats.userId, user.id), visibleTournamentsFilter(viewerId)), [
    asc(tournaments.name),
  ]);
}

/** A user's stats in open tournaments only, for anonymous previews. */
export async function listOpenUserStats(
  db: Database,
  userId: string,
): Promise<StatsWithRelations[]> {
  return queryStats(db, and(eq(stats.userId, userId), openTournamentsFilter()), [
    asc(tournaments.name),
  ]);
}

/**
 * Stats of one user in one tournament; 404 when either is unknown or invisible to the viewer or
 * the user never played.
 */
export async function getUserTournamentStats(
  db: Database,
  username: string,
  tournamentName: string,
  viewerId: string,
): Promise<StatsWithRelations> {
  const user = await requireVisibleUser(db, username, viewerId);
  const { tournament } = await requireVisibleTournament(db, tournamentName, viewerId);
  const [row] = await queryStats(
    db,
    and(eq(stats.userId, user.id), eq(stats.tournamentId, tournament.id)),
    [],
  );
  if (!row) throw ApiError.notFound('No stats for this user in this tournament', 'STATS_NOT_FOUND');
  return row;
}

export interface RivalryFilter {
  userName?: string | undefined;
  rivalName?: string | undefined;
  tournamentName?: string | undefined;
}

/**
 * Directional rivalries in tournaments the viewer may read, matching every given filter, best
 * score first. Any named user or tournament that does not exist or is invisible → 404.
 */
export async function listRivalries(
  db: Database,
  filter: RivalryFilter,
  viewerId: string,
): Promise<RivalryWithRelations[]> {
  const conditions: SQL[] = [visibleTournamentsFilter(viewerId)];
  if (filter.tournamentName !== undefined) {
    const { tournament } = await requireVisibleTournament(db, filter.tournamentName, viewerId);
    conditions.push(eq(rivalryStats.tournamentId, tournament.id));
  }
  if (filter.userName !== undefined) {
    const user = await requireVisibleUser(db, filter.userName, viewerId);
    conditions.push(eq(rivalryStats.userId, user.id));
  }
  if (filter.rivalName !== undefined) {
    const rival = await requireVisibleUser(db, filter.rivalName, viewerId);
    conditions.push(eq(rivalryStats.rivalId, rival.id));
  }
  return queryRivalries(db, and(...conditions));
}

/** The rivalry of a user against one rival in one tournament, or 404. */
export async function getRivalry(
  db: Database,
  filter: Required<RivalryFilter>,
  viewerId: string,
): Promise<RivalryWithRelations> {
  const [row] = await listRivalries(db, filter, viewerId);
  if (!row) throw ApiError.notFound('Rivalry not found', 'RIVALRY_NOT_FOUND');
  return row;
}
