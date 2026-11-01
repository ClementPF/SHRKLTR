import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { games, outcomes, stats, users } from '../db/schema.js';
import { computeDeltas } from '../elo/elo.js';
import { ApiError } from '../lib/errors.js';
import { findTournamentByName, type TournamentWithRelations } from './tournament.service.js';

type GameRow = typeof games.$inferSelect;
type OutcomeRow = typeof outcomes.$inferSelect;
type UserRow = typeof users.$inferSelect;
type GameResult = OutcomeRow['result'];

export interface SubmittedOutcome {
  username: string;
  result: GameResult;
}

export interface GameWithRelations {
  game: GameRow;
  tournament: TournamentWithRelations;
  outcomes: { outcome: OutcomeRow; user: UserRow }[];
}

type DecisiveOutcome = SubmittedOutcome & { result: 'WIN' | 'LOSS' };

/** Structural checks ported from the legacy GameService.validateGame. */
function validateOutcomes(submitted: readonly SubmittedOutcome[]): DecisiveOutcome[] {
  if (submitted.length === 0) {
    throw ApiError.badRequest('A game needs at least one outcome', 'INVALID_GAME');
  }
  const decisive: DecisiveOutcome[] = [];
  for (const outcome of submitted) {
    if (outcome.result === 'TIE') {
      throw ApiError.badRequest('Tied games are not supported', 'TIE_NOT_SUPPORTED');
    }
    decisive.push({ username: outcome.username, result: outcome.result });
  }
  const usernames = new Set(decisive.map((o) => o.username));
  if (usernames.size !== decisive.length) {
    throw ApiError.badRequest('A player can only appear once per game', 'DUPLICATE_PLAYER');
  }
  const winners = decisive.filter((o) => o.result === 'WIN').length;
  const losers = decisive.length - winners;
  if (winners === 0 || winners !== losers) {
    throw ApiError.badRequest(
      'A game needs as many winners as losers, and at least one of each',
      'UNBALANCED_TEAMS',
    );
  }
  return decisive;
}

export interface SubmitGameInput {
  tournamentName: string;
  callerId: string;
  outcomes: readonly SubmittedOutcome[];
}

/**
 * Records a game submitted by one of its losers. The game and its outcomes are written in a
 * single transaction; outcome scoreValues are the Elo deltas from current tournament ratings.
 */
export async function submitGame(db: Database, input: SubmitGameInput): Promise<GameWithRelations> {
  const tournament = await findTournamentByName(db, input.tournamentName);
  if (!tournament) throw ApiError.notFound('Tournament not found', 'TOURNAMENT_NOT_FOUND');

  const decisive = validateOutcomes(input.outcomes);
  const usernames = decisive.map((o) => o.username);
  const userRows = await db.select().from(users).where(inArray(users.username, usernames));
  const userByName = new Map(userRows.map((u) => [u.username, u]));
  const unknown = usernames.filter((name) => !userByName.has(name));
  if (unknown.length > 0) {
    throw ApiError.badRequest(`Unknown user(s): ${unknown.join(', ')}`, 'UNKNOWN_USER');
  }

  const callerLost = decisive.some(
    (o) => o.result === 'LOSS' && userByName.get(o.username)?.id === input.callerId,
  );
  if (!callerLost) {
    throw ApiError.forbidden('Only a losing player can submit a game', 'CALLER_MUST_LOSE');
  }

  const tournamentId = tournament.tournament.id;
  const gameId = await db.transaction(async (tx) => {
    const ratingRows = await tx
      .select({ userId: stats.userId, score: stats.score })
      .from(stats)
      .where(
        and(
          eq(stats.tournamentId, tournamentId),
          inArray(
            stats.userId,
            userRows.map((u) => u.id),
          ),
        ),
      );
    const ratingByUserId = new Map(ratingRows.map((r) => [r.userId, r.score]));
    const ratings = new Map<string, number>();
    for (const user of userRows) {
      const score = ratingByUserId.get(user.id);
      if (score !== undefined) ratings.set(user.username, score);
    }
    const deltas = computeDeltas(decisive, ratings);

    const [game] = await tx.insert(games).values({ tournamentId }).returning({ id: games.id });
    if (!game) throw new Error('game insert returned no row');
    await tx.insert(outcomes).values(
      decisive.map((o) => {
        const user = userByName.get(o.username);
        const delta = deltas.get(o.username);
        if (!user || delta === undefined) throw new Error(`missing data for ${o.username}`);
        return { gameId: game.id, userId: user.id, result: o.result, scoreValue: delta };
      }),
    );
    return game.id;
  });

  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) throw new Error('game disappeared after creation');
  return { game, tournament, outcomes: await loadOutcomes(db, gameId) };
}

/** Outcomes of a game with their users, winners first then by username. */
export async function loadOutcomes(db: Database, gameId: string) {
  return db
    .select({ outcome: outcomes, user: users })
    .from(outcomes)
    .innerJoin(users, eq(outcomes.userId, users.id))
    .where(eq(outcomes.gameId, gameId))
    .orderBy(asc(outcomes.result), asc(users.username));
}
