import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { games, groupMembers, groupPlayers, outcomes, tournaments, users } from '../db/schema.js';

type Reader = Pick<Database, 'select'>;

/**
 * Restricts a query joined on `tournaments` to the tournaments the viewer may read: open
 * (ungrouped) tournaments and those of groups the viewer currently belongs to. Use it in the
 * WHERE clause of the query itself so ordering, counts and LIMIT/OFFSET only see visible rows.
 * A left-joined `tournaments` that matched no row passes, like an open tournament.
 */
export function visibleTournamentsFilter(viewerId: string): SQL {
  return sql`(${tournaments.groupId} is null or exists (select 1 from ${groupMembers} where ${groupMembers.groupId} = ${tournaments.groupId} and ${groupMembers.userId} = ${viewerId}))`;
}

/**
 * Restricts a query joined on `tournaments` to data an anonymous capability holder (e.g. a
 * claim-link preview) may read: open tournaments only.
 */
export function openTournamentsFilter(): SQL {
  return sql`${tournaments.groupId} is null`;
}

/** Whether the viewer may read this tournament (open, or the viewer is a current member). */
export async function canViewTournament(
  db: Reader,
  tournament: { groupId: string | null },
  viewerId: string,
): Promise<boolean> {
  if (tournament.groupId === null) return true;
  const [row] = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, tournament.groupId), eq(groupMembers.userId, viewerId)))
    .limit(1);
  return row !== undefined;
}

/**
 * Restricts a query on `users` to accounts the viewer may discover. Registered accounts are
 * always discoverable. A placeholder is hidden only when it is private: rostered in a group or
 * having played in a grouped tournament, while the viewer neither created it, nor shares one of
 * those groups, nor can see open history of it.
 */
export function discoverableUsersFilter(viewerId: string): SQL {
  const playedIn = (tournamentCondition: SQL) =>
    sql`exists (select 1 from ${outcomes} inner join ${games} on ${games.id} = ${outcomes.gameId} inner join ${tournaments} on ${tournaments.id} = ${games.tournamentId} where ${outcomes.userId} = ${users.id} and ${tournamentCondition})`;
  const rostered = sql`exists (select 1 from ${groupPlayers} where ${groupPlayers.placeholderUserId} = ${users.id})`;
  const sharesRoster = sql`exists (select 1 from ${groupPlayers} inner join ${groupMembers} on ${groupMembers.groupId} = ${groupPlayers.groupId} where ${groupPlayers.placeholderUserId} = ${users.id} and ${groupMembers.userId} = ${viewerId})`;
  return sql`(${users.accountType} = 'REGISTERED' or ${users.id} = ${viewerId} or ${users.createdByUserId} = ${viewerId} or ${sharesRoster} or ${playedIn(openTournamentsFilter())} or ${playedIn(sql`${tournaments.groupId} is not null and ${visibleTournamentsFilter(viewerId)}`)} or (not ${rostered} and not ${playedIn(sql`${tournaments.groupId} is not null`)}))`;
}
