import { asc, eq, inArray } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client.js';
import { games, outcomes, users } from '../db/schema.js';
import { computeDeltas, DEFAULT_RATING } from '../elo/elo.js';
import { ApiError } from '../lib/errors.js';
import { applyRivalryResults } from './rivalry.service.js';
import {
  applyStatsResults,
  lockParticipantStats,
  refreshRivalrySelection,
  type ParticipantResult,
} from './stats.service.js';
import { evaluateGameAchievements, lockAchievementOwners } from './achievement.service.js';
import { notifyGameRecorded } from './notification.service.js';
import { authorizeGroupGame, findMemberRole } from './group.service.js';
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

export interface RecordGameInput {
  tournamentId: string;
  participants: readonly { userId: string; result: 'WIN' | 'LOSS' }[];
  /** Defaults to the database's current time; only the seed replays historical dates. */
  date?: Date;
}

/**
 * Persists an already validated game inside the caller's transaction: game and outcome rows,
 * participant stats, directional rivalries and best/worst rivalry selection. Returns the game id.
 */
export async function recordGame(tx: Transaction, input: RecordGameInput): Promise<string> {
  const { tournamentId, participants } = input;
  const userIds = participants.map((p) => p.userId);
  const statsByUserId = await lockParticipantStats(tx, tournamentId, userIds);
  const ratings = new Map(
    userIds.map((id) => [id, statsByUserId.get(id)?.score ?? DEFAULT_RATING]),
  );
  const deltas = computeDeltas(
    participants.map((p) => ({ username: p.userId, result: p.result })),
    ratings,
  );
  const results: ParticipantResult[] = participants.map((p) => {
    const delta = deltas.get(p.userId);
    if (delta === undefined) throw new Error(`missing delta for ${p.userId}`);
    return { ...p, delta };
  });

  const [game] = await tx
    .insert(games)
    .values({ tournamentId, ...(input.date ? { date: input.date } : {}) })
    .returning({ id: games.id });
  if (!game) throw new Error('game insert returned no row');
  await tx.insert(outcomes).values(
    results.map((r) => ({
      gameId: game.id,
      userId: r.userId,
      result: r.result,
      scoreValue: r.delta,
      ratingBefore: ratings.get(r.userId) ?? DEFAULT_RATING,
    })),
  );

  await applyStatsResults(tx, statsByUserId, results);
  await applyRivalryResults(tx, tournamentId, results);
  for (const userId of userIds) {
    await refreshRivalrySelection(tx, userId, tournamentId);
  }
  return game.id;
}

export interface SubmitGameInput {
  tournamentName: string;
  callerId: string;
  outcomes: readonly SubmittedOutcome[];
}

export interface SubmittedGame {
  game: GameWithRelations;
  /** Inbox rows created by the game, to push once the transaction has committed. */
  notificationIds: string[];
}

/**
 * Records a game submitted by one of its losers. The game, its outcomes, the badges it unlocks
 * and every inbox row (game_recorded for each participant, achievement_unlocked per new badge)
 * are written in a single transaction; outcome scoreValues are the Elo deltas from current
 * tournament ratings.
 */
export async function submitGame(db: Database, input: SubmitGameInput): Promise<SubmittedGame> {
  const tournament = await findTournamentByName(db, input.tournamentName);
  const groupId = tournament?.tournament.groupId ?? null;
  // Early answer for outsiders; the authoritative check runs under the group lock below.
  if (!tournament || (groupId && !(await findMemberRole(db, groupId, input.callerId)))) {
    throw ApiError.notFound('Tournament not found', 'TOURNAMENT_NOT_FOUND');
  }

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

  const participants = decisive.map((o) => {
    const user = userByName.get(o.username);
    if (!user) throw new Error(`missing user ${o.username}`);
    return { userId: user.id, result: o.result };
  });
  const { gameId, notificationIds } = await db.transaction(async (tx) => {
    const participantIds = participants.map((p) => p.userId);
    if (groupId) {
      await authorizeGroupGame(tx, { groupId, callerId: input.callerId, participantIds });
    }
    await lockAchievementOwners(tx, participantIds);
    const recorded = await recordGame(tx, { tournamentId: tournament.tournament.id, participants });
    const gameNotifications = await notifyGameRecorded(tx, {
      gameId: recorded,
      submitterId: input.callerId,
      participantIds,
    });
    const badges = await evaluateGameAchievements(tx, recorded);
    return {
      gameId: recorded,
      notificationIds: [...gameNotifications, ...badges.notificationIds],
    };
  });

  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) throw new Error('game disappeared after creation');
  return {
    game: { game, tournament, outcomes: await loadOutcomes(db, gameId) },
    notificationIds,
  };
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
