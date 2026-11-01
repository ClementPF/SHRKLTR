import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { games, sports, stats, tournaments, users } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/db-errors.js';

type TournamentRow = typeof tournaments.$inferSelect;
type SportRow = typeof sports.$inferSelect;
type UserRow = typeof users.$inferSelect;

export interface TournamentWithRelations {
  tournament: TournamentRow;
  sport: SportRow;
  owner: UserRow | null;
}

const TOURNAMENT_NAME_CONSTRAINT = 'tournaments_name_key';

/** Slug used in URLs: displayName with every whitespace character removed, lowercased. */
export function deriveTournamentName(displayName: string): string {
  return displayName.replace(/\s+/g, '').toLowerCase();
}

function notFound(): ApiError {
  return ApiError.notFound('Tournament not found', 'TOURNAMENT_NOT_FOUND');
}

function alreadyExists(name: string): ApiError {
  return ApiError.badRequest(`Tournament "${name}" already exists`, 'TOURNAMENT_ALREADY_EXISTS');
}

function selectWithRelations(db: Database) {
  return db
    .select({ tournament: tournaments, sport: sports, owner: users })
    .from(tournaments)
    .innerJoin(sports, eq(tournaments.sportId, sports.id))
    .leftJoin(users, eq(tournaments.ownerUserId, users.id));
}

export async function findTournamentByName(
  db: Database,
  name: string,
): Promise<TournamentWithRelations | undefined> {
  const [row] = await selectWithRelations(db).where(eq(tournaments.name, name)).limit(1);
  return row;
}

async function requireTournament(db: Database, name: string): Promise<TournamentWithRelations> {
  const found = await findTournamentByName(db, name);
  if (!found) throw notFound();
  return found;
}

async function requireOwnedTournament(
  db: Database,
  name: string,
  callerId: string,
): Promise<TournamentWithRelations> {
  const found = await requireTournament(db, name);
  if (found.tournament.ownerUserId !== callerId) {
    throw ApiError.forbidden(
      'Only the tournament owner can modify this tournament',
      'NOT_TOURNAMENT_OWNER',
    );
  }
  return found;
}

/** All tournaments (optionally of one sport), most played first. Unknown sport → 404. */
export async function listTournaments(
  db: Database,
  filter: { sportName?: string | undefined } = {},
): Promise<TournamentWithRelations[]> {
  const conditions: SQL[] = [];
  if (filter.sportName) {
    const [sport] = await db
      .select({ id: sports.id })
      .from(sports)
      .where(eq(sports.name, filter.sportName))
      .limit(1);
    if (!sport) throw ApiError.notFound('Sport not found', 'SPORT_NOT_FOUND');
    conditions.push(eq(tournaments.sportId, sport.id));
  }

  const gameCounts = db
    .select({ tournamentId: games.tournamentId, gameCount: count().as('game_count') })
    .from(games)
    .groupBy(games.tournamentId)
    .as('game_counts');

  return selectWithRelations(db)
    .leftJoin(gameCounts, eq(gameCounts.tournamentId, tournaments.id))
    .where(and(...conditions))
    .orderBy(desc(sql`coalesce(${gameCounts.gameCount}, 0)`), asc(tournaments.name));
}

/** Tournaments in which the user has a stats row (i.e. has played). */
export async function listTournamentsForUser(
  db: Database,
  userId: string,
): Promise<TournamentWithRelations[]> {
  return selectWithRelations(db)
    .innerJoin(stats, eq(stats.tournamentId, tournaments.id))
    .where(eq(stats.userId, userId))
    .orderBy(asc(tournaments.name));
}

/** Users having a stats row in the tournament. Unknown tournament → 404. */
export async function listTournamentUsers(db: Database, name: string): Promise<UserRow[]> {
  const { tournament } = await requireTournament(db, name);
  const rows = await db
    .select({ user: users })
    .from(stats)
    .innerJoin(users, eq(stats.userId, users.id))
    .where(eq(stats.tournamentId, tournament.id))
    .orderBy(asc(users.username));
  return rows.map((r) => r.user);
}

export interface CreateTournamentInput {
  displayName: string;
  sportName: string;
  ownerUserId: string;
}

/** Creates the tournament, creating its sport on the fly when unknown. */
export async function createTournament(
  db: Database,
  input: CreateTournamentInput,
): Promise<TournamentWithRelations> {
  const name = deriveTournamentName(input.displayName);
  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      await tx.insert(sports).values({ name: input.sportName }).onConflictDoNothing();
      const [sport] = await tx
        .select({ id: sports.id })
        .from(sports)
        .where(eq(sports.name, input.sportName))
        .limit(1);
      if (!sport) throw new Error('sport missing after upsert');
      const [created] = await tx
        .insert(tournaments)
        .values({
          name,
          displayName: input.displayName,
          sportId: sport.id,
          ownerUserId: input.ownerUserId,
        })
        .returning({ id: tournaments.id });
      if (!created) throw new Error('tournament insert returned no row');
      return created.id;
    });
  } catch (err) {
    if (isUniqueViolation(err, TOURNAMENT_NAME_CONSTRAINT)) throw alreadyExists(name);
    throw err;
  }
  const [row] = await selectWithRelations(db).where(eq(tournaments.id, id)).limit(1);
  if (!row) throw new Error('tournament disappeared after creation');
  return row;
}

export interface UpdateTournamentInput {
  displayName?: string | undefined;
  isOver?: boolean | undefined;
}

/** Owner-only in-place update; a new displayName regenerates the slug, the id never changes. */
export async function updateTournament(
  db: Database,
  name: string,
  callerId: string,
  input: UpdateTournamentInput,
): Promise<TournamentWithRelations> {
  const { tournament } = await requireOwnedTournament(db, name, callerId);
  const changes: Partial<Pick<TournamentRow, 'name' | 'displayName' | 'isOver'>> = {};
  if (input.displayName !== undefined) {
    changes.displayName = input.displayName;
    changes.name = deriveTournamentName(input.displayName);
  }
  if (input.isOver !== undefined) changes.isOver = input.isOver;

  try {
    await db.update(tournaments).set(changes).where(eq(tournaments.id, tournament.id));
  } catch (err) {
    if (isUniqueViolation(err, TOURNAMENT_NAME_CONSTRAINT)) {
      throw alreadyExists(changes.name ?? tournament.name);
    }
    throw err;
  }
  const [row] = await selectWithRelations(db).where(eq(tournaments.id, tournament.id)).limit(1);
  if (!row) throw notFound();
  return row;
}

/** Owner-only delete; games, outcomes, stats and rivalries go with it via FK cascades. */
export async function deleteTournament(db: Database, name: string, callerId: string) {
  const { tournament } = await requireOwnedTournament(db, name, callerId);
  await db.delete(tournaments).where(eq(tournaments.id, tournament.id));
}
