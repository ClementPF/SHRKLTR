import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Transaction } from '../db/client.js';
import { rivalryStats, stats } from '../db/schema.js';
import { DEFAULT_RATING } from '../elo/elo.js';

export type DecisiveResult = 'WIN' | 'LOSS';

export interface ParticipantResult {
  userId: string;
  result: DecisiveResult;
  delta: number;
}

/** The mutable statistic columns shared by `stats` and `rivalry_stats`. */
export interface StatLine {
  score: number;
  bestScore: number;
  worstScore: number;
  gameCount: number;
  winCount: number;
  loseCount: number;
  tieCount: number;
  winStreak: number;
  loseStreak: number;
  tieStreak: number;
  longuestWinStreak: number;
  longuestLoseStreak: number;
  longuestTieStreak: number;
}

export function pickStatLine(row: StatLine): StatLine {
  return {
    score: row.score,
    bestScore: row.bestScore,
    worstScore: row.worstScore,
    gameCount: row.gameCount,
    winCount: row.winCount,
    loseCount: row.loseCount,
    tieCount: row.tieCount,
    winStreak: row.winStreak,
    loseStreak: row.loseStreak,
    tieStreak: row.tieStreak,
    longuestWinStreak: row.longuestWinStreak,
    longuestLoseStreak: row.longuestLoseStreak,
    longuestTieStreak: row.longuestTieStreak,
  };
}

/** Ported recalculateAfterOutcome: score, extrema, counts and streaks after one decisive result. */
export function applyResult(line: StatLine, result: DecisiveResult, delta: number): StatLine {
  const score = line.score + delta;
  const won = result === 'WIN';
  const winStreak = won ? line.winStreak + 1 : 0;
  const loseStreak = won ? 0 : line.loseStreak + 1;
  return {
    ...line,
    score,
    bestScore: Math.max(line.bestScore, score),
    worstScore: Math.min(line.worstScore, score),
    gameCount: line.gameCount + 1,
    winCount: line.winCount + (won ? 1 : 0),
    loseCount: line.loseCount + (won ? 0 : 1),
    winStreak,
    loseStreak,
    tieStreak: 0,
    longuestWinStreak: Math.max(line.longuestWinStreak, winStreak),
    longuestLoseStreak: Math.max(line.longuestLoseStreak, loseStreak),
  };
}

/**
 * Ensures a stats row exists for every user (created at the default rating, with best and worst
 * score equal to it) and returns the rows locked for update, keyed by user id. Locking in user-id
 * order serializes concurrent games sharing a participant without deadlocking.
 */
export async function lockParticipantStats(
  tx: Transaction,
  tournamentId: string,
  userIds: readonly string[],
) {
  await tx
    .insert(stats)
    .values(
      userIds.map((userId) => ({
        userId,
        tournamentId,
        score: DEFAULT_RATING,
        bestScore: DEFAULT_RATING,
        worstScore: DEFAULT_RATING,
      })),
    )
    .onConflictDoNothing();
  const rows = await tx
    .select()
    .from(stats)
    .where(and(eq(stats.tournamentId, tournamentId), inArray(stats.userId, [...userIds])))
    .orderBy(asc(stats.userId))
    .for('update');
  return new Map(rows.map((row) => [row.userId, row]));
}

export async function applyStatsResults(
  tx: Transaction,
  rowsByUserId: ReadonlyMap<string, typeof stats.$inferSelect>,
  results: readonly ParticipantResult[],
): Promise<void> {
  for (const { userId, result, delta } of results) {
    const row = rowsByUserId.get(userId);
    if (!row) throw new Error(`stats row missing for ${userId}`);
    await tx
      .update(stats)
      .set(applyResult(pickStatLine(row), result, delta))
      .where(eq(stats.id, row.id));
  }
}

interface Candidate {
  id: string;
  score: number;
}

/**
 * Picks the candidate with the most extreme score in the given direction, among those strictly
 * on the matching side of zero. The current selection wins ties so it is only replaced by a
 * strictly better rivalry.
 */
function selectExtreme(
  candidates: readonly Candidate[],
  currentId: string | null,
  sign: 1 | -1,
): string | null {
  let selected: Candidate | null = null;
  for (const candidate of candidates) {
    const signed = candidate.score * sign;
    if (signed <= 0) continue;
    const selectedSigned = selected ? selected.score * sign : 0;
    if (
      !selected ||
      signed > selectedSigned ||
      (signed === selectedSigned && candidate.id === currentId)
    ) {
      selected = candidate;
    }
  }
  return selected?.id ?? null;
}

/** Best rivalry: largest strictly positive score, or null. */
export function selectBestRivalry(candidates: readonly Candidate[], currentId: string | null) {
  return selectExtreme(candidates, currentId, 1);
}

/** Worst rivalry: smallest strictly negative score, or null. */
export function selectWorstRivalry(candidates: readonly Candidate[], currentId: string | null) {
  return selectExtreme(candidates, currentId, -1);
}

/**
 * Re-evaluates a user's best/worst rivalry in a tournament against all of their rivalry rows,
 * which covers creation, replacement of a deteriorated selection and removal on sign crossing.
 */
export async function refreshRivalrySelection(
  tx: Transaction,
  userId: string,
  tournamentId: string,
): Promise<void> {
  const [row] = await tx
    .select({
      id: stats.id,
      bestRivalryId: stats.bestRivalryId,
      worstRivalryId: stats.worstRivalryId,
    })
    .from(stats)
    .where(and(eq(stats.userId, userId), eq(stats.tournamentId, tournamentId)));
  if (!row) return;
  const candidates = await tx
    .select({ id: rivalryStats.id, score: rivalryStats.score })
    .from(rivalryStats)
    .where(and(eq(rivalryStats.userId, userId), eq(rivalryStats.tournamentId, tournamentId)))
    .orderBy(asc(rivalryStats.id));
  const bestRivalryId = selectBestRivalry(candidates, row.bestRivalryId);
  const worstRivalryId = selectWorstRivalry(candidates, row.worstRivalryId);
  if (bestRivalryId !== row.bestRivalryId || worstRivalryId !== row.worstRivalryId) {
    await tx.update(stats).set({ bestRivalryId, worstRivalryId }).where(eq(stats.id, row.id));
  }
}
