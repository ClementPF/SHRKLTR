import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  challenges,
  games,
  notifications,
  outcomes,
  rivalryStats,
  stats,
  userAchievements,
} from '../src/db/schema.js';
import { sweepChallenges, type SweepResult } from '../src/services/challenge.service.js';
import { createMaintenance, MAINTENANCE_INTERVAL_MS } from '../src/services/maintenance.service.js';
import {
  authHeadersFor,
  buildTestApp,
  createChallengeRow,
  createGroup,
  createPushDevice,
  createTournament,
  createUser,
  expoTokenOf,
  truncateAll,
} from './helpers.js';
import { startPushCollector, type PushCollector } from './push-collector.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;
type TournamentRow = Awaited<ReturnType<typeof createTournament>>;
type NotificationType = (typeof notifications.$inferSelect)['type'];

const T0 = new Date('2026-06-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('challenge sweep', () => {
  let collector: PushCollector;
  let app: FastifyInstance;
  let now: Date;
  let alice: UserRow;
  let bob: UserRow;
  let carol: UserRow;
  let cup: TournamentRow;

  beforeAll(async () => {
    collector = await startPushCollector();
    app = await buildTestApp({ env: { PUSH_URL: collector.url }, clock: () => now });
  });

  afterAll(async () => {
    await app.close();
    await collector.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    collector.reset();
    now = T0;
    alice = await createUser(app.db, { username: 'alice' });
    bob = await createUser(app.db, { username: 'bob' });
    carol = await createUser(app.db, { username: 'carol' });
    cup = await createTournament(app.db, { name: 'cup', displayName: 'Cup' });
  });

  afterEach(async () => {
    await app.push.drain();
  });

  /** A challenge created a day before T0 (so short deadlines stay valid) in the given state. */
  const challengeRow = (
    challenger: UserRow,
    opponent: UserRow,
    deadlineAt: Date,
    status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED' | 'EXPIRED' = 'PENDING',
    tournament: TournamentRow = cup,
  ) =>
    createChallengeRow(app.db, {
      tournamentId: tournament.id,
      challengerUserId: challenger.id,
      opponentUserId: opponent.id,
      createdAt: at(-DAY),
      deadlineAt,
      status,
      ...(status === 'COMPLETED' ? { winnerUserId: challenger.id } : {}),
    });

  const row = async (id: string) => {
    const [found] = await app.db.select().from(challenges).where(eq(challenges.id, id));
    if (!found) throw new Error('challenge missing');
    return found;
  };

  const events = (type: NotificationType) =>
    app.db.select().from(notifications).where(eq(notifications.type, type));

  const recipientsOf = async (type: NotificationType, challengeId: string) =>
    (
      await app.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.type, type), eq(notifications.challengeId, challengeId)))
    )
      .map((n) => n.recipientUserId)
      .sort();

  describe('expiry (VAL-CHAL-019)', () => {
    it('expires PENDING and ACCEPTED challenges at their deadline without rating effects', async () => {
      // Real history so the Elo/stat snapshot has rows to compare.
      const played = await app.inject({
        method: 'POST',
        url: '/tournaments/cup/games',
        headers: await authHeadersFor(app, bob.id),
        payload: {
          outcomes: [
            { username: 'alice', result: 'WIN' },
            { username: 'bob', result: 'LOSS' },
          ],
        },
      });
      expect(played.statusCode).toBe(201);
      const deadline = at(2 * HOUR);
      const pending = await challengeRow(alice, bob, deadline, 'PENDING');
      const accepted = await challengeRow(carol, alice, deadline, 'ACCEPTED');
      const later = await challengeRow(bob, carol, new Date(deadline.getTime() + 1), 'ACCEPTED');
      const snapshot = async () => ({
        games: await app.db.select().from(games),
        outcomes: await app.db.select().from(outcomes),
        stats: await app.db.select().from(stats),
        rivalries: await app.db.select().from(rivalryStats),
        badges: await app.db.select().from(userAchievements),
      });
      const before = await snapshot();

      const result = await sweepChallenges(app.db, deadline);

      expect(result).toMatchObject({ expired: 2 });
      for (const c of [pending, accepted]) {
        expect(await row(c.id)).toMatchObject({
          status: 'EXPIRED',
          resolvedAt: deadline,
          winnerUserId: null,
          gameId: null,
        });
      }
      expect((await row(later.id)).status).toBe('ACCEPTED');
      expect(await recipientsOf('challenge_expired', pending.id)).toEqual(
        [alice.id, bob.id].sort(),
      );
      expect(await recipientsOf('challenge_expired', accepted.id)).toEqual(
        [alice.id, carol.id].sort(),
      );
      expect(await snapshot()).toEqual(before);

      const again = await sweepChallenges(app.db, at(3 * HOUR));
      expect(again.expired).toBe(1);
      expect(await events('challenge_expired')).toHaveLength(6);
      const third = await sweepChallenges(app.db, at(4 * HOUR));
      expect(third).toEqual({ expired: 0, reminded: 0, notificationIds: [] });
      expect(await snapshot()).toEqual(before);

      const detail = await app.inject({
        method: 'GET',
        url: `/challenges/${pending.id}`,
        headers: await authHeadersFor(app, bob.id),
      });
      expect(detail.json()).toMatchObject({
        status: 'EXPIRED',
        resolvedAt: deadline.toISOString(),
        winner: null,
        gameId: null,
      });
    });

    it('leaves final challenges untouched (VAL-CHAL-022)', async () => {
      const finals = [
        await challengeRow(alice, bob, at(HOUR), 'DECLINED'),
        await challengeRow(alice, carol, at(HOUR), 'COMPLETED'),
        await challengeRow(bob, carol, at(HOUR), 'EXPIRED'),
      ];
      const ids = finals.map((c) => c.id);
      const before = await app.db.select().from(challenges).where(inArray(challenges.id, ids));

      const result = await sweepChallenges(app.db, at(2 * HOUR));

      expect(result).toEqual({ expired: 0, reminded: 0, notificationIds: [] });
      expect(await app.db.select().from(challenges).where(inArray(challenges.id, ids))).toEqual(
        before,
      );
      expect(await app.db.select().from(notifications)).toHaveLength(0);
    });

    it('processes every due challenge across batches', async () => {
      const users = [alice, bob, carol];
      for (let i = 0; i < 5; i += 1) users.push(await createUser(app.db));
      for (let i = 1; i < users.length; i += 1) {
        await challengeRow(users[0]!, users[i]!, at(HOUR));
      }
      const result = await sweepChallenges(app.db, at(HOUR), 2);
      expect(result.expired).toBe(7);
      expect(await events('challenge_expired')).toHaveLength(14);
    });
  });

  describe('24-hour reminder (VAL-CHAL-020)', () => {
    it('reminds at exactly 24 hours once per player, not before', async () => {
      const edge = await challengeRow(alice, bob, at(DAY), 'PENDING');
      const outside = await challengeRow(alice, carol, at(DAY + 1), 'ACCEPTED');

      const first = await sweepChallenges(app.db, T0);

      expect(first).toMatchObject({ expired: 0, reminded: 1 });
      expect(await recipientsOf('challenge_expiring', edge.id)).toEqual([alice.id, bob.id].sort());
      expect((await row(edge.id)).expiringNotifiedAt).toEqual(T0);
      expect(await recipientsOf('challenge_expiring', outside.id)).toEqual([]);
      expect((await row(outside.id)).expiringNotifiedAt).toBeNull();

      const second = await sweepChallenges(app.db, at(1));
      expect(second.reminded).toBe(1);
      expect(await recipientsOf('challenge_expiring', outside.id)).toEqual(
        [alice.id, carol.id].sort(),
      );
      await sweepChallenges(app.db, at(HOUR));
      await sweepChallenges(app.db, at(2 * HOUR));
      expect(await events('challenge_expiring')).toHaveLength(4);
    });

    it('reminds a short-deadline challenge on the next sweep', async () => {
      const short = await challengeRow(alice, bob, at(HOUR));
      const result = await sweepChallenges(app.db, T0);
      expect(result.reminded).toBe(1);
      expect(await recipientsOf('challenge_expiring', short.id)).toHaveLength(2);
    });

    it('sends no reminder to final challenges or to an overdue one being expired', async () => {
      await challengeRow(alice, bob, at(HOUR), 'DECLINED');
      await challengeRow(alice, carol, at(HOUR), 'COMPLETED');
      await challengeRow(bob, carol, at(HOUR), 'EXPIRED');
      const overdue = await challengeRow(
        bob,
        alice,
        at(-1),
        'ACCEPTED',
        await createTournament(app.db),
      );

      const result = await sweepChallenges(app.db, T0);

      expect(result).toMatchObject({ expired: 1, reminded: 0 });
      expect((await row(overdue.id)).status).toBe('EXPIRED');
      expect(await events('challenge_expiring')).toHaveLength(0);
    });

    it('concurrent sweeps send one reminder and one expiry per player', async () => {
      const dueSoon = await challengeRow(alice, bob, at(HOUR));
      const overdue = await challengeRow(alice, carol, at(-1));
      const results = await Promise.all(
        Array.from({ length: 4 }, () => sweepChallenges(app.db, T0)),
      );
      expect(results.reduce((n, r) => n + r.reminded, 0)).toBe(1);
      expect(results.reduce((n, r) => n + r.expired, 0)).toBe(1);
      expect(await recipientsOf('challenge_expiring', dueSoon.id)).toHaveLength(2);
      expect(await recipientsOf('challenge_expired', overdue.id)).toHaveLength(2);
    });
  });

  describe('push delivery', () => {
    beforeEach(async () => {
      await createPushDevice(app.db, { userId: alice.id, expoToken: expoTokenOf('alice') });
      await createPushDevice(app.db, { userId: bob.id, expoToken: expoTokenOf('bob') });
    });

    const challengePushes = () =>
      collector
        .messages()
        .filter((m) => (m.data as { target?: { type?: string } }).target?.type === 'challenge')
        .map((m) => [m.to, m.title])
        .sort();

    it('pushes expiry and reminders to both players after the sweep', async () => {
      await challengeRow(alice, bob, at(-1));
      await challengeRow(bob, alice, at(HOUR), 'PENDING', await createTournament(app.db));

      await app.maintenance.runOnce();
      await app.push.drain();

      expect(challengePushes()).toEqual(
        [
          [expoTokenOf('alice'), 'Challenge expired'],
          [expoTokenOf('bob'), 'Challenge expired'],
          [expoTokenOf('alice'), 'Challenge expiring soon'],
          [expoTokenOf('bob'), 'Challenge expiring soon'],
        ].sort(),
      );
    });

    it('rechecks visibility, so a former group member gets no private reminder (VAL-CHAL-023)', async () => {
      const group = await createGroup(app.db, {
        ownerId: alice.id,
        members: { [bob.id]: 'MEMBER' },
      });
      const secret = await createTournament(app.db, {
        name: 'secret',
        displayName: 'Secret Cup',
        groupId: group.id,
        ownerUserId: alice.id,
      });
      await challengeRow(alice, bob, at(HOUR), 'ACCEPTED', secret);
      const left = await app.inject({
        method: 'POST',
        url: `/groups/${group.id}/leave`,
        headers: await authHeadersFor(app, bob.id),
      });
      expect(left.statusCode).toBe(204);
      await app.push.drain();
      collector.reset();

      await app.maintenance.runOnce();
      await app.push.drain();

      expect(challengePushes()).toEqual([[expoTokenOf('alice'), 'Challenge expiring soon']]);
      const inbox = await app.inject({
        method: 'GET',
        url: '/notifications',
        headers: await authHeadersFor(app, bob.id),
      });
      expect(inbox.body).not.toContain('Secret');
      expect(inbox.json()).toEqual([]);
    });
  });
});

describe('maintenance lifecycle (VAL-CHAL-024)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const empty: SweepResult = { expired: 0, reminded: 0, notificationIds: [] };
  const log = { info: vi.fn(), error: vi.fn() } as unknown as Parameters<
    typeof createMaintenance
  >[0]['log'];

  function harness() {
    const calls: Date[] = [];
    const gates: (() => void)[] = [];
    let blocking = false;
    const dispatch = vi.fn();
    let clockMs = T0.getTime();
    const maintenance = createMaintenance({
      db: {} as Parameters<typeof createMaintenance>[0]['db'],
      push: { dispatch },
      clock: () => new Date(clockMs),
      log,
      sweep: async (_db, sweepNow) => {
        calls.push(sweepNow);
        if (blocking) await new Promise<void>((resolve) => gates.push(resolve));
        return { ...empty, notificationIds: [`n-${calls.length}`] };
      },
    });
    return {
      maintenance,
      calls,
      dispatch,
      block: (value: boolean) => {
        blocking = value;
      },
      release: () => gates.splice(0).forEach((open) => open()),
      advanceClock: (ms: number) => {
        clockMs += ms;
      },
    };
  }

  it('sweeps at start, then every 60 seconds at the injected clock', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.maintenance.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).toEqual([T0]);
    expect(h.dispatch).toHaveBeenCalledWith(['n-1']);

    h.advanceClock(MAINTENANCE_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS - 1);
    expect(h.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls).toEqual([T0, at(MAINTENANCE_INTERVAL_MS)]);
    await vi.advanceTimersByTimeAsync(2 * MAINTENANCE_INTERVAL_MS);
    expect(h.calls).toHaveLength(4);

    h.maintenance.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).toHaveLength(4);
    await h.maintenance.stop();
  });

  it('never overlaps a sweep that is still running', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.block(true);
    h.maintenance.start();
    await vi.advanceTimersByTimeAsync(3 * MAINTENANCE_INTERVAL_MS);
    expect(h.calls).toHaveLength(1);
    const manual = h.maintenance.runOnce();
    expect(h.calls).toHaveLength(1);

    h.block(false);
    h.release();
    await manual;
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS);
    expect(h.calls).toHaveLength(2);
    await h.maintenance.stop();
  });

  it('stop clears the interval and waits for the running sweep', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.block(true);
    h.maintenance.start();
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    const stopping = h.maintenance.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    h.release();
    await stopping;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MAINTENANCE_INTERVAL_MS);
    expect(h.calls).toHaveLength(1);
    h.maintenance.start();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs and survives a failing sweep', async () => {
    const failing = createMaintenance({
      db: {} as Parameters<typeof createMaintenance>[0]['db'],
      push: { dispatch: vi.fn() },
      clock: () => T0,
      log,
      sweep: () => Promise.reject(new Error('boom')),
    });
    await expect(failing.runOnce()).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });

  describe('in the API', () => {
    let app: FastifyInstance | null = null;

    afterEach(async () => {
      await app?.close();
      app = null;
    });

    async function overdueChallenge(db: FastifyInstance['db']) {
      await truncateAll(db);
      const a = await createUser(db);
      const b = await createUser(db);
      const t = await createTournament(db);
      return createChallengeRow(db, {
        tournamentId: t.id,
        challengerUserId: a.id,
        opponentUserId: b.id,
        createdAt: at(-DAY),
        deadlineAt: at(-1),
      });
    }

    const statusOf = async (db: FastifyInstance['db'], id: string) =>
      (await db.select().from(challenges).where(eq(challenges.id, id)))[0]?.status;

    /** Polls without triggering a sweep, so only the scheduled work can satisfy it. */
    async function waitForStatus(db: FastifyInstance['db'], id: string, status: string) {
      const deadline = Date.now() + 5_000;
      while ((await statusOf(db, id)) !== status) {
        if (Date.now() > deadline) throw new Error(`challenge never became ${status}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    it('MAINTENANCE_ENABLED runs a startup sweep and a 60-second interval until close', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      let now = T0;
      app = await buildTestApp({ env: { MAINTENANCE_ENABLED: 'true' }, clock: () => now });
      const startup = await overdueChallenge(app.db);

      await app.ready();
      await waitForStatus(app.db, startup.id, 'EXPIRED');
      expect(vi.getTimerCount()).toBe(1);

      const t = await createTournament(app.db);
      const [a, b] = [await createUser(app.db), await createUser(app.db)];
      const next = await createChallengeRow(app.db, {
        tournamentId: t.id,
        challengerUserId: a.id,
        opponentUserId: b.id,
        createdAt: at(-DAY),
        deadlineAt: at(30_000),
      });
      now = at(MAINTENANCE_INTERVAL_MS);
      vi.advanceTimersByTime(MAINTENANCE_INTERVAL_MS - 1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await statusOf(app.db, next.id)).toBe('PENDING');
      vi.advanceTimersByTime(1);
      await waitForStatus(app.db, next.id, 'EXPIRED');

      await app.close();
      app = null;
      expect(vi.getTimerCount()).toBe(0);
    });

    it('disabled configuration starts neither the startup sweep nor the interval', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      app = await buildTestApp({ clock: () => T0 });
      const overdue = await overdueChallenge(app.db);

      await app.ready();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(5 * MAINTENANCE_INTERVAL_MS);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await statusOf(app.db, overdue.id)).toBe('PENDING');
    });
  });
});
