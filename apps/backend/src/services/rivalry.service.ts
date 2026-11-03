import { and, asc, eq, or } from 'drizzle-orm';
import type { Transaction } from '../db/client.js';
import { rivalryStats } from '../db/schema.js';
import { applyResult, pickStatLine, type ParticipantResult } from './stats.service.js';

/**
 * Updates the directional rivalry rows of every cross-team pair. Each participant's row against
 * each opponent receives that participant's full delta; teammates never get a rivalry row.
 */
export async function applyRivalryResults(
  tx: Transaction,
  tournamentId: string,
  results: readonly ParticipantResult[],
): Promise<void> {
  const pairs = results.flatMap((self) =>
    results
      .filter((other) => other.result !== self.result)
      .map((other) => ({ self, rivalId: other.userId })),
  );
  if (pairs.length === 0) return;

  await tx
    .insert(rivalryStats)
    .values(
      pairs.map(({ self, rivalId }) => ({
        userId: self.userId,
        rivalId,
        tournamentId,
        score: 0,
        bestScore: 0,
        worstScore: 0,
      })),
    )
    .onConflictDoNothing();

  const rows = await tx
    .select()
    .from(rivalryStats)
    .where(
      and(
        eq(rivalryStats.tournamentId, tournamentId),
        or(
          ...pairs.map(({ self, rivalId }) =>
            and(eq(rivalryStats.userId, self.userId), eq(rivalryStats.rivalId, rivalId)),
          ),
        ),
      ),
    )
    .orderBy(asc(rivalryStats.id))
    .for('update');
  const rowByPair = new Map(rows.map((r) => [`${r.userId}:${r.rivalId}`, r]));

  for (const { self, rivalId } of pairs) {
    const row = rowByPair.get(`${self.userId}:${rivalId}`);
    if (!row) throw new Error(`rivalry row missing for ${self.userId} vs ${rivalId}`);
    await tx
      .update(rivalryStats)
      .set(applyResult(pickStatLine(row), self.result, self.delta))
      .where(eq(rivalryStats.id, row.id));
  }
}
