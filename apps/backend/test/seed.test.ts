import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../src/db/client.js';
import {
  games,
  outcomes,
  rivalryStats,
  sports,
  stats,
  tournaments,
  users,
} from '../src/db/schema.js';
import { DEMO_TOURNAMENTS, DEMO_USERS, runSeed } from '../src/db/seed.js';
import { truncateAll } from './helpers.js';
import { TEST_DATABASE_URL } from './test-env.js';

const tables = { users, sports, tournaments, games, outcomes, stats, rivalryStats };

async function rowCounts(db: Database): Promise<Record<string, number>> {
  const entries = await Promise.all(
    Object.entries(tables).map(async ([name, table]) => {
      const [row] = await db.select({ n: count() }).from(table);
      return [name, row?.n ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries);
}

describe('dev seed', () => {
  let db: Database;

  beforeAll(async () => {
    db = createDb(TEST_DATABASE_URL);
    await truncateAll(db);
  });

  afterAll(async () => {
    await truncateAll(db);
    await db.$client.end({ timeout: 5 });
  });

  it('populates demo data and is idempotent', async () => {
    await runSeed(db);
    const first = await rowCounts(db);
    const expectedGames = DEMO_TOURNAMENTS.reduce((n, t) => n + t.games.length, 0);
    expect(first.users).toBe(DEMO_USERS.length);
    expect(first.tournaments).toBe(DEMO_TOURNAMENTS.length);
    expect(first.sports).toBeGreaterThan(0);
    expect(first.games).toBe(expectedGames);
    expect(first.stats).toBeGreaterThan(0);
    expect(first.rivalryStats).toBeGreaterThan(0);

    const second = await runSeed(db);
    expect(second.tournamentsWithNewGames).toBe(0);
    expect(await rowCounts(db)).toEqual(first);
  });

  it('creates the dev-token subjects', async () => {
    const rows = await db.select({ username: users.username }).from(users);
    const names = rows.map((r) => r.username);
    expect(names).toEqual(expect.arrayContaining(['dev-alex', 'dev-sam']));
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps every tournament zero-sum with mirrored rivalries', async () => {
    for (const t of await db.select().from(tournaments)) {
      const rows = await db.select().from(stats).where(eq(stats.tournamentId, t.id));
      const total = rows.reduce((sum, r) => sum + r.score, 0);
      expect(total).toBeCloseTo(1000 * rows.length, 9);
      for (const r of rows) {
        expect(r.bestScore).toBeGreaterThanOrEqual(r.score);
        expect(r.worstScore).toBeLessThanOrEqual(r.score);
        expect(r.winCount + r.loseCount).toBe(r.gameCount);
      }

      const rivalries = await db
        .select()
        .from(rivalryStats)
        .where(eq(rivalryStats.tournamentId, t.id));
      for (const r of rivalries) {
        const reverse = rivalries.find((o) => o.userId === r.rivalId && o.rivalId === r.userId);
        expect(reverse?.score).toBeCloseTo(-r.score, 9);
        expect(reverse?.gameCount).toBe(r.gameCount);
      }
      for (const r of rows) {
        const own = rivalries.filter((o) => o.userId === r.userId);
        const best = own.find((o) => o.id === r.bestRivalryId);
        const worst = own.find((o) => o.id === r.worstRivalryId);
        const maxPositive = Math.max(0, ...own.map((o) => o.score));
        const minNegative = Math.min(0, ...own.map((o) => o.score));
        expect(best?.score ?? 0).toBe(maxPositive);
        expect(worst?.score ?? 0).toBe(minNegative);
      }
    }
  });

  it('first game of a fresh tournament moves ratings by 16', async () => {
    const [chess] = await db.select().from(tournaments).where(eq(tournaments.name, 'chessclub'));
    expect(chess).toBeDefined();
    const [firstGame] = await db
      .select()
      .from(games)
      .where(eq(games.tournamentId, chess!.id))
      .orderBy(games.date)
      .limit(1);
    const rows = await db.select().from(outcomes).where(eq(outcomes.gameId, firstGame!.id));
    expect(rows.map((r) => [r.result, r.scoreValue]).sort()).toEqual([
      ['LOSS', -16],
      ['WIN', 16],
    ]);
  });
});
