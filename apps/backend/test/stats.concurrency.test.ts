import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { and, asc, count, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { games, outcomes, rivalryStats, stats } from '../src/db/schema.js';
import {
  authHeadersFor,
  buildTestApp,
  createTournament,
  createUser,
  truncateAll,
} from './helpers.js';
import { TEST_DATABASE_URL } from './test-env.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;

const GATE_KEY = 742_001;

const eloDelta = (winnerRating: number, loserRating: number) =>
  32 * (1 - 1 / (1 + 10 ** ((loserRating - winnerRating) / 400)));

/**
 * Forces the interleaving that used to deadlock two first games between the same unrated users.
 * A test-only trigger makes every transaction's second lazily inserted stats row wait on an
 * advisory gate held by the test. Request A parks on the gate after inserting its first row;
 * request B is then started and the test waits (observing pg_stat_activity/pg_locks) until it is
 * blocked too before opening the gate. With unordered inserts B has already inserted the other
 * user's row, so both transactions wait on each other once the gate opens (40P01).
 */
describe('concurrent first games between the same users', () => {
  let app: FastifyInstance;
  let control: postgres.Sql;
  let gate: postgres.ReservedSql | null = null;
  let pending: Promise<unknown>[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
    control = postgres(TEST_DATABASE_URL, { max: 2, onnotice: () => {} });
    await control.unsafe(`
      create or replace function test_stats_insert_gate() returns trigger language plpgsql as $$
      declare
        n int := coalesce(nullif(current_setting('test_gate.stats_rows', true), ''), '0')::int + 1;
      begin
        perform set_config('test_gate.stats_rows', n::text, true);
        if n >= 2 then
          perform pg_advisory_xact_lock_shared(${GATE_KEY});
        end if;
        return new;
      end $$;
      drop trigger if exists test_stats_insert_gate on stats;
      create trigger test_stats_insert_gate before insert on stats
        for each row execute function test_stats_insert_gate();
    `);
  });

  afterAll(async () => {
    await control.unsafe(`
      drop trigger if exists test_stats_insert_gate on stats;
      drop function if exists test_stats_insert_gate();
    `);
    await control.end({ timeout: 5 });
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
  });

  afterEach(async () => {
    await openGate();
    await Promise.allSettled(pending);
    pending = [];
  });

  async function closeGate(): Promise<number> {
    const conn = await control.reserve();
    gate = conn;
    const [row] = await conn<{ pid: number }[]>`
      select pg_backend_pid() as pid, pg_advisory_lock(${GATE_KEY})`;
    if (!row) throw new Error('gate lock not acquired');
    return row.pid;
  }

  async function openGate(): Promise<void> {
    if (!gate) return;
    const conn = gate;
    gate = null;
    await conn`select pg_advisory_unlock(${GATE_KEY})`;
    conn.release();
  }

  async function waitUntil(description: string, check: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting until ${description}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async function lockWaiters(gatePid: number): Promise<{ pid: number; onGate: boolean }[]> {
    const rows = await control<{ pid: number; on_gate: boolean }[]>`
      select a.pid, exists (
        select 1 from pg_locks l
        where l.pid = a.pid and l.locktype = 'advisory' and not l.granted
          and l.objid = ${GATE_KEY}
      ) as on_gate
      from pg_stat_activity a
      where a.datname = current_database() and a.wait_event_type = 'Lock' and a.pid <> ${gatePid}`;
    return rows.map((r) => ({ pid: r.pid, onGate: r.on_gate }));
  }

  const submit = async (
    caller: UserRow,
    gameOutcomes: { username: string; result: 'WIN' | 'LOSS' }[],
  ): Promise<LightMyRequestResponse> => {
    const promise = app.inject({
      method: 'POST',
      url: '/tournaments/babyfoot/games',
      headers: await authHeadersFor(app, caller.id),
      payload: { outcomes: gameOutcomes },
    });
    pending.push(promise);
    return promise;
  };

  it('reversed participant order: both submissions return 201 and both games are applied', async () => {
    const tournament = await createTournament(app.db, { name: 'babyfoot' });
    const [first, second] = [
      await createUser(app.db, { username: 'alice' }),
      await createUser(app.db, { username: 'bob' }),
    ].sort((a, b) => (a.id < b.id ? -1 : 1)) as [UserRow, UserRow];

    const gatePid = await closeGate();

    // A lists users in ascending id order, B in descending order.
    const requestA = submit(first, [
      { username: first.username, result: 'LOSS' },
      { username: second.username, result: 'WIN' },
    ]);
    await waitUntil('request A is parked on the gate after its first stats insert', async () => {
      const waiters = await lockWaiters(gatePid);
      return waiters.length === 1 && waiters.every((w) => w.onGate);
    });
    const [rowsSoFar] = await control<{ n: number }[]>`select count(*)::int as n from stats`;
    expect(rowsSoFar?.n).toBe(0);

    const requestB = submit(second, [
      { username: second.username, result: 'LOSS' },
      { username: first.username, result: 'WIN' },
    ]);
    await waitUntil(
      'request B is blocked on a lock as well',
      async () => (await lockWaiters(gatePid)).length === 2,
    );

    await openGate();
    const [resA, resB] = await Promise.all([requestA, requestB]);

    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);

    const [g] = await app.db.select({ n: count() }).from(games);
    const [o] = await app.db.select({ n: count() }).from(outcomes);
    expect(g?.n).toBe(2);
    expect(o?.n).toBe(4);

    // A commits first (B waits on A's uncommitted stats row), so B is rated from A's result.
    const d1 = eloDelta(1000, 1000);
    const d2 = eloDelta(1000 - d1, 1000 + d1);
    const statRows = await app.db
      .select()
      .from(stats)
      .where(eq(stats.tournamentId, tournament.id))
      .orderBy(asc(stats.userId));
    expect(statRows).toHaveLength(2);
    const [firstStats, secondStats] = statRows;
    expect(firstStats).toMatchObject({
      userId: first.id,
      gameCount: 2,
      winCount: 1,
      loseCount: 1,
      winStreak: 1,
      loseStreak: 0,
      longuestWinStreak: 1,
      longuestLoseStreak: 1,
    });
    expect(secondStats).toMatchObject({
      userId: second.id,
      gameCount: 2,
      winCount: 1,
      loseCount: 1,
      winStreak: 0,
      loseStreak: 1,
      longuestWinStreak: 1,
      longuestLoseStreak: 1,
    });
    expect(firstStats!.score).toBeCloseTo(1000 - d1 + d2, 9);
    expect(secondStats!.score).toBeCloseTo(1000 + d1 - d2, 9);
    expect(firstStats!.worstScore).toBeCloseTo(1000 - d1, 9);
    expect(secondStats!.bestScore).toBeCloseTo(1000 + d1, 9);

    const rivalryOf = async (userId: string, rivalId: string) => {
      const [row] = await app.db
        .select()
        .from(rivalryStats)
        .where(and(eq(rivalryStats.userId, userId), eq(rivalryStats.rivalId, rivalId)));
      return row;
    };
    const forward = await rivalryOf(first.id, second.id);
    const reverse = await rivalryOf(second.id, first.id);
    const [r] = await app.db.select({ n: count() }).from(rivalryStats);
    expect(r?.n).toBe(2);
    expect(forward?.gameCount).toBe(2);
    expect(reverse?.gameCount).toBe(2);
    expect(forward!.score).toBeCloseTo(-d1 + d2, 9);
    expect(reverse!.score).toBeCloseTo(-forward!.score, 9);
  });
});
