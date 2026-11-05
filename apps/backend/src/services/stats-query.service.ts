import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../db/client.js';
import { rivalryStats, sports, stats, tournaments, users } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { findTournamentByName, type TournamentWithRelations } from './tournament.service.js';
import { findUserByUsername } from './user.service.js';
import { openTournamentsFilter } from './visibility.service.js';

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
    })
    .from(rivalryStats)
    .innerJoin(users, eq(rivalryStats.userId, users.id))
    .innerJoin(rivals, eq(rivalryStats.rivalId, rivals.id))
    .innerJoin(tournaments, eq(rivalryStats.tournamentId, tournaments.id))
    .innerJoin(sports, eq(tournaments.sportId, sports.id))
    .leftJoin(owners, eq(tournaments.ownerUserId, owners.id))
    .where(where)
    .orderBy(desc(rivalryStats.score), asc(tournaments.name), asc(rivals.username));
  return rows.map(({ rivalry, user, rival, tournament, sport, owner }): RivalryWithRelations => ({
    rivalry,
    user,
    rival,
    tournament: { tournament, sport, owner },
  }));
}

/** Stats rows matching `where` in the given order, with best/worst rivalries resolved. */
async function queryStats(
  db: Database,
  where: SQL | undefined,
  orderBy: SQL[],
): Promise<StatsWithRelations[]> {
  const rows = await db
    .select({ stats, user: users, tournament: tournaments, sport: sports, owner: owners })
    .from(stats)
    .innerJoin(users, eq(stats.userId, users.id))
    .innerJoin(tournaments, eq(stats.tournamentId, tournaments.id))
    .innerJoin(sports, eq(tournaments.sportId, sports.id))
    .leftJoin(owners, eq(tournaments.ownerUserId, owners.id))
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
    tournament: { tournament: r.tournament, sport: r.sport, owner: r.owner },
    bestRivalry: resolve(r.stats.bestRivalryId),
    worstRivalry: resolve(r.stats.worstRivalryId),
  }));
}

async function requireTournament(db: Database, name: string): Promise<TournamentWithRelations> {
  const found = await findTournamentByName(db, name);
  if (!found) throw ApiError.notFound('Tournament not found', 'TOURNAMENT_NOT_FOUND');
  return found;
}

async function requireUser(db: Database, username: string): Promise<UserRow> {
  const user = await findUserByUsername(db, username);
  if (!user) throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
  return user;
}

/** Tournament leaderboard: stats rows sorted by score, highest first. */
export async function listTournamentStats(
  db: Database,
  tournamentName: string,
): Promise<StatsWithRelations[]> {
  const { tournament } = await requireTournament(db, tournamentName);
  return queryStats(db, eq(stats.tournamentId, tournament.id), [
    desc(stats.score),
    asc(users.username),
  ]);
}

/** Every stats row of a user, one per tournament played, by tournament name. */
export async function listUserStats(db: Database, username: string): Promise<StatsWithRelations[]> {
  const user = await requireUser(db, username);
  return queryStats(db, eq(stats.userId, user.id), [asc(tournaments.name)]);
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

/** Stats of one user in one tournament; 404 when either is unknown or the user never played. */
export async function getUserTournamentStats(
  db: Database,
  username: string,
  tournamentName: string,
): Promise<StatsWithRelations> {
  const user = await requireUser(db, username);
  const { tournament } = await requireTournament(db, tournamentName);
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
 * Directional rivalries matching every given filter, best score first. Any named user or
 * tournament that does not exist → 404.
 */
export async function listRivalries(
  db: Database,
  filter: RivalryFilter,
): Promise<RivalryWithRelations[]> {
  const conditions: SQL[] = [];
  if (filter.tournamentName !== undefined) {
    const { tournament } = await requireTournament(db, filter.tournamentName);
    conditions.push(eq(rivalryStats.tournamentId, tournament.id));
  }
  if (filter.userName !== undefined) {
    const user = await requireUser(db, filter.userName);
    conditions.push(eq(rivalryStats.userId, user.id));
  }
  if (filter.rivalName !== undefined) {
    const rival = await requireUser(db, filter.rivalName);
    conditions.push(eq(rivalryStats.rivalId, rival.id));
  }
  return queryRivalries(db, and(...conditions));
}

/** The rivalry of a user against one rival in one tournament, or 404. */
export async function getRivalry(
  db: Database,
  filter: Required<RivalryFilter>,
): Promise<RivalryWithRelations> {
  const [row] = await listRivalries(db, filter);
  if (!row) throw ApiError.notFound('Rivalry not found', 'RIVALRY_NOT_FOUND');
  return row;
}
