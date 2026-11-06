import { and, asc, countDistinct, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../db/client.js';
import { games, groups, outcomes, sports, tournaments, users } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import type { PageWindow } from '../lib/pagination.js';
import type { GameWithRelations } from './game.service.js';
import { requireVisibleTournament } from './tournament.service.js';
import { requireVisibleUser } from './user.service.js';
import { openTournamentsFilter, visibleTournamentsFilter } from './visibility.service.js';

const owners = alias(users, 'owner');

/** One page of games matching `where`, newest first, with tournaments and outcomes loaded. */
async function listGames(
  db: Database,
  where: SQL | undefined,
  page: PageWindow,
): Promise<GameWithRelations[]> {
  const rows = await db
    .select({ game: games, tournament: tournaments, sport: sports, owner: owners, group: groups })
    .from(games)
    .innerJoin(tournaments, eq(games.tournamentId, tournaments.id))
    .innerJoin(sports, eq(tournaments.sportId, sports.id))
    .leftJoin(owners, eq(tournaments.ownerUserId, owners.id))
    .leftJoin(groups, eq(tournaments.groupId, groups.id))
    .where(where)
    // createdAt and id break ties between games sharing a date so pages never overlap.
    .orderBy(desc(games.date), desc(games.createdAt), desc(games.id))
    .limit(page.limit)
    .offset(page.offset);
  if (rows.length === 0) return [];

  const outcomeRows = await db
    .select({ outcome: outcomes, user: users })
    .from(outcomes)
    .innerJoin(users, eq(outcomes.userId, users.id))
    .where(
      inArray(
        outcomes.gameId,
        rows.map((r) => r.game.id),
      ),
    )
    .orderBy(asc(outcomes.result), asc(users.username));
  const outcomesByGame = new Map<string, GameWithRelations['outcomes']>();
  for (const row of outcomeRows) {
    const list = outcomesByGame.get(row.outcome.gameId) ?? [];
    list.push(row);
    outcomesByGame.set(row.outcome.gameId, list);
  }

  return rows.map(({ game, tournament, sport, owner, group }) => ({
    game,
    tournament: { tournament, sport, owner, group },
    outcomes: outcomesByGame.get(game.id) ?? [],
  }));
}

/** Games of a tournament, newest first. Unknown or invisible tournament → 404. */
export async function listTournamentGames(
  db: Database,
  tournamentName: string,
  page: PageWindow,
  viewerId: string,
): Promise<GameWithRelations[]> {
  const found = await requireVisibleTournament(db, tournamentName, viewerId);
  return listGames(db, eq(games.tournamentId, found.tournament.id), page);
}

/**
 * Games the user took part in within tournaments the viewer may read, newest first, optionally
 * within one tournament (unknown or invisible → 404).
 */
export async function listUserGames(
  db: Database,
  username: string,
  filter: { tournamentName?: string | undefined },
  page: PageWindow,
  viewerId: string,
): Promise<GameWithRelations[]> {
  const user = await requireVisibleUser(db, username, viewerId);

  const conditions: SQL[] = [
    inArray(
      games.id,
      db.select({ id: outcomes.gameId }).from(outcomes).where(eq(outcomes.userId, user.id)),
    ),
    visibleTournamentsFilter(viewerId),
  ];
  if (filter.tournamentName !== undefined) {
    const found = await requireVisibleTournament(db, filter.tournamentName, viewerId);
    conditions.push(eq(games.tournamentId, found.tournament.id));
  }
  return listGames(db, and(...conditions), page);
}

/** One game by id. Unknown games and games the viewer may not see → 404. */
export async function getGame(
  db: Database,
  gameId: string,
  viewerId: string,
): Promise<GameWithRelations> {
  const where = and(eq(games.id, gameId), visibleTournamentsFilter(viewerId));
  const [found] = await listGames(db, where, { offset: 0, limit: 1 });
  if (!found) throw ApiError.notFound('Game not found', 'GAME_NOT_FOUND');
  return found;
}

/** A user's games in open tournaments only, newest first, for anonymous previews. */
export async function listOpenUserGames(
  db: Database,
  userId: string,
  page: PageWindow,
): Promise<GameWithRelations[]> {
  const played = inArray(
    games.id,
    db.select({ id: outcomes.gameId }).from(outcomes).where(eq(outcomes.userId, userId)),
  );
  return listGames(db, and(played, openTournamentsFilter()), page);
}

/** Number of distinct games a user played in open tournaments. */
export async function countOpenUserGames(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: countDistinct(outcomes.gameId) })
    .from(outcomes)
    .innerJoin(games, eq(outcomes.gameId, games.id))
    .innerJoin(tournaments, eq(games.tournamentId, tournaments.id))
    .where(and(eq(outcomes.userId, userId), openTournamentsFilter()));
  return row?.n ?? 0;
}
