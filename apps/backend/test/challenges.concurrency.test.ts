import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { challenges, notifications, userAchievements } from '../src/db/schema.js';
import { sweepChallenges, type SweepResult } from '../src/services/challenge.service.js';
import {
  authHeadersFor,
  buildTestApp,
  createChallengeRow,
  createGroup,
  createTournament,
  createUser,
  truncateAll,
} from './helpers.js';
import { TEST_DATABASE_URL } from './test-env.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;
type TournamentRow = Awaited<ReturnType<typeof createTournament>>;
type NotificationType = (typeof notifications.$inferSelect)['type'];
type Outcome = LightMyRequestResponse | SweepResult;

const T0 = new Date('2026-06-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(T0.getTime() + ms);

/**
 * Interleavings are forced like the group concurrency tests: an external transaction holds the
 * row lock the operations need, they are started one by one and observed waiting in
 * pg_stat_activity, then the holder is released. Postgres grants queued row locks in arrival
 * order. Clocks are fixed per operation, so "at the deadline" is exact.
 */
describe('challenge concurrency (VAL-CHAL-006, VAL-CHAL-013, VAL-CHAL-020, VAL-CHAL-021)', () => {
  let app: FastifyInstance;
  let control: postgres.Sql;
  let holder: postgres.ReservedSql | null = null;
  let pending: Promise<unknown>[] = [];
  let now: Date;
  let alice: UserRow;
  let bob: UserRow;
  let cup: TournamentRow;

  beforeAll(async () => {
    app = await buildTestApp({ clock: () => now });
    await app.ready();
    control = postgres(TEST_DATABASE_URL, { max: 2, onnotice: () => {} });
  });

  afterAll(async () => {
    await control.end({ timeout: 5 });
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    now = T0;
    alice = await createUser(app.db, { username: 'alice' });
    bob = await createUser(app.db, { username: 'bob' });
    cup = await createTournament(app.db, { name: 'cup', displayName: 'Cup' });
  });

  afterEach(async () => {
    await releaseHolder();
    await Promise.allSettled(pending);
    pending = [];
    await app.push.drain();
  });

  const call = (user: UserRow, method: string, url: string, payload?: object) => {
    const promise = (async () =>
      app.inject({
        method: method as 'GET',
        url,
        headers: await authHeadersFor(app, user.id),
        ...(payload === undefined ? {} : { payload }),
      }))();
    pending.push(promise);
    return promise;
  };

  async function hold(statement: (conn: postgres.ReservedSql) => Promise<unknown>) {
    const conn = await control.reserve();
    holder = conn;
    await conn`begin`;
    await statement(conn);
    const [row] = await conn<{ pid: number }[]>`select pg_backend_pid() as pid`;
    if (!row) throw new Error('no backend pid');
    return row.pid;
  }

  async function releaseHolder(): Promise<void> {
    if (!holder) return;
    const conn = holder;
    holder = null;
    await conn`rollback`;
    conn.release();
  }

  async function waitForLockWaiters(holderPid: number, n: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const [row] = await control<{ waiting: number }[]>`
        select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and pid <> ${holderPid}`;
      if ((row?.waiting ?? 0) >= n) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} lock waiters`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Starts each operation in order, each parked behind the held lock, then releases it. */
  async function race(holderPid: number, operations: (() => Promise<Outcome>)[]) {
    const started: Promise<Outcome>[] = [];
    for (const [i, start] of operations.entries()) {
      const promise = start();
      pending.push(promise);
      started.push(promise);
      await waitForLockWaiters(holderPid, i + 1);
    }
    await releaseHolder();
    return Promise.all(started);
  }

  const holdChallenge = (id: string) =>
    hold((conn) => conn`select id from challenges where id = ${id} for update`);

  /** Runs with the app clock set to `clockAt` (read by the request once it reaches its locks). */
  const withClock = (clockAt: Date, start: () => Promise<Outcome>) => () => {
    now = clockAt;
    return start();
  };

  const accept = (id: string) => () =>
    call(bob, 'PUT', `/challenges/${id}/response`, { response: 'ACCEPT' });
  const sweep = (sweepNow: Date) => () => sweepChallenges(app.db, sweepNow);
  const game = () => () =>
    call(bob, 'POST', '/tournaments/cup/games', {
      outcomes: [
        { username: 'alice', result: 'WIN' },
        { username: 'bob', result: 'LOSS' },
      ],
    });

  const row = async (id: string) => {
    const [found] = await app.db.select().from(challenges).where(eq(challenges.id, id));
    if (!found) throw new Error('challenge missing');
    return found;
  };
  const count = async (type: NotificationType, challengeId?: string) =>
    (
      await app.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.type, type),
            challengeId ? eq(notifications.challengeId, challengeId) : undefined,
          ),
        )
    ).length;
  const challengeBadges = () =>
    app.db
      .select()
      .from(userAchievements)
      .where(eq(userAchievements.achievementCode, 'first_challenge_won'));
  const status = (outcome: Outcome | undefined) =>
    outcome && 'statusCode' in outcome ? outcome.statusCode : null;

  const challenge = (status: 'PENDING' | 'ACCEPTED', deadlineAt: Date) =>
    createChallengeRow(app.db, {
      tournamentId: cup.id,
      challengerUserId: alice.id,
      opponentUserId: bob.id,
      createdAt: at(-DAY),
      deadlineAt,
      status,
    });

  it('opposite-direction creations leave one active challenge and one received event', async () => {
    const pid = await hold(
      (conn) => conn`select id from tournaments where id = ${cup.id} for update`,
    );
    const results = await race(pid, [
      () => call(alice, 'POST', '/challenges', { tournamentName: 'cup', opponentUsername: 'bob' }),
      () => call(bob, 'POST', '/challenges', { tournamentName: 'cup', opponentUsername: 'alice' }),
    ]);
    expect(results.map(status).sort()).toEqual([201, 400]);
    const rejected = results.find((r) => status(r) === 400) as LightMyRequestResponse;
    expect(rejected.json().error.code).toBe('ACTIVE_CHALLENGE_EXISTS');
    expect(await app.db.select().from(challenges)).toHaveLength(1);
    expect(await count('challenge_received')).toBe(1);
  });

  it('a removal committed first makes a concurrent private creation fail', async () => {
    const group = await createGroup(app.db, {
      ownerId: alice.id,
      members: { [bob.id]: 'MEMBER' },
    });
    await createTournament(app.db, { name: 'secret', ownerUserId: alice.id, groupId: group.id });
    const pid = await hold((conn) => conn`select id from groups where id = ${group.id} for update`);
    const results = await race(pid, [
      () => call(alice, 'DELETE', `/groups/${group.id}/members/${bob.id}`),
      () =>
        call(alice, 'POST', '/challenges', { tournamentName: 'secret', opponentUsername: 'bob' }),
    ]);
    expect(results.map(status)).toEqual([204, 400]);
    expect((results[1] as LightMyRequestResponse).json().error.code).toBe(
      'PLAYER_NOT_GROUP_MEMBER',
    );
    expect(await app.db.select().from(challenges)).toHaveLength(0);
  });

  describe('acceptance against expiry', () => {
    const deadline = at(2 * HOUR);

    it('accepted just before the deadline, then expired by the sweep at it', async () => {
      const c = await challenge('PENDING', deadline);
      const results = await race(await holdChallenge(c.id), [
        withClock(new Date(deadline.getTime() - 1), accept(c.id)),
        sweep(deadline),
      ]);
      expect(status(results[0])).toBe(200);
      expect(await row(c.id)).toMatchObject({ status: 'EXPIRED', winnerUserId: null });
      expect(await count('challenge_accepted', c.id)).toBe(1);
      expect(await count('challenge_expired', c.id)).toBe(2);
    });

    it('expired by the sweep first: the acceptance fails with CHALLENGE_EXPIRED', async () => {
      const c = await challenge('PENDING', deadline);
      const results = await race(await holdChallenge(c.id), [
        sweep(deadline),
        withClock(new Date(deadline.getTime() - 1), accept(c.id)),
      ]);
      expect(status(results[1])).toBe(400);
      expect((results[1] as LightMyRequestResponse).json().error.code).toBe('CHALLENGE_EXPIRED');
      expect(await row(c.id)).toMatchObject({ status: 'EXPIRED', acceptedAt: null });
      expect(await count('challenge_accepted')).toBe(0);
      expect(await count('challenge_expired', c.id)).toBe(2);
    });

    it('an acceptance that arrives before the deadline but gets the lock at it is expired', async () => {
      const c = await challenge('PENDING', deadline);
      const pid = await holdChallenge(c.id);
      now = new Date(deadline.getTime() - 1);
      const answer = accept(c.id)();
      await waitForLockWaiters(pid, 1);
      now = deadline;
      await releaseHolder();
      const res = await answer;
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('CHALLENGE_EXPIRED');
      expect(await row(c.id)).toMatchObject({ status: 'EXPIRED', acceptedAt: null });
      expect(await count('challenge_accepted')).toBe(0);
    });

    it('acceptance at the deadline racing the sweep expires exactly once', async () => {
      const c = await challenge('PENDING', deadline);
      const results = await race(await holdChallenge(c.id), [
        withClock(deadline, accept(c.id)),
        sweep(deadline),
      ]);
      expect(status(results[0])).toBe(400);
      expect(await row(c.id)).toMatchObject({ status: 'EXPIRED', acceptedAt: null });
      expect((results[1] as SweepResult).expired).toBe(0);
      expect(await count('challenge_accepted')).toBe(0);
      expect(await count('challenge_expired', c.id)).toBe(2);
    });
  });

  describe('completion against expiry', () => {
    const deadline = at(2 * HOUR);

    it('a game just before the deadline completes it; the sweep then leaves it alone', async () => {
      const c = await challenge('ACCEPTED', deadline);
      const results = await race(await holdChallenge(c.id), [
        withClock(new Date(deadline.getTime() - 1), game()),
        sweep(deadline),
      ]);
      expect(status(results[0])).toBe(201);
      const gameId = (results[0] as LightMyRequestResponse).json().id;
      expect(await row(c.id)).toMatchObject({
        status: 'COMPLETED',
        winnerUserId: alice.id,
        gameId,
      });
      expect((results[1] as SweepResult).expired).toBe(0);
      expect(await count('challenge_expired')).toBe(0);
      expect((await challengeBadges()).map((b) => b.userId)).toEqual([alice.id]);
    });

    it('expired first: the game is recorded but completes nothing and awards no badge', async () => {
      const c = await challenge('ACCEPTED', deadline);
      const results = await race(await holdChallenge(c.id), [
        sweep(deadline),
        withClock(new Date(deadline.getTime() - 1), game()),
      ]);
      expect((results[0] as SweepResult).expired).toBe(1);
      expect(status(results[1])).toBe(201);
      expect(await row(c.id)).toMatchObject({
        status: 'EXPIRED',
        gameId: null,
        winnerUserId: null,
      });
      expect(await challengeBadges()).toHaveLength(0);
      expect(await count('challenge_expired', c.id)).toBe(2);
    });
  });

  it('a game that arrived before acceptance but operates after it completes the challenge', async () => {
    const c = await challenge('PENDING', at(DAY));
    // NO KEY UPDATE parks the game on its participant lock without blocking the acceptance's
    // foreign-key checks.
    const pid = await hold(
      (conn) => conn`select id from users where id = ${alice.id} for no key update`,
    );
    now = at(HOUR);
    const played = call(bob, 'POST', '/tournaments/cup/games', {
      outcomes: [
        { username: 'alice', result: 'WIN' },
        { username: 'bob', result: 'LOSS' },
      ],
    });
    await waitForLockWaiters(pid, 1);
    now = at(2 * HOUR);
    const accepted = await call(bob, 'PUT', `/challenges/${c.id}/response`, {
      response: 'ACCEPT',
    });
    expect(accepted.statusCode).toBe(200);
    now = at(3 * HOUR);
    await releaseHolder();
    const res = await played;
    expect(res.statusCode).toBe(201);
    expect(await row(c.id)).toMatchObject({
      status: 'COMPLETED',
      acceptedAt: at(2 * HOUR),
      resolvedAt: at(3 * HOUR),
      gameId: res.json().id,
    });
  });

  it('concurrent sweeps send the reminder once', async () => {
    const c = await challenge('ACCEPTED', at(HOUR));
    const results = (await race(await holdChallenge(c.id), [
      sweep(T0),
      sweep(T0),
    ])) as SweepResult[];
    expect(results.map((r) => r.reminded).sort()).toEqual([0, 1]);
    expect(await count('challenge_expiring', c.id)).toBe(2);
  });
});
