import type { FastifyInstance } from 'fastify';
import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../src/db/client.js';
import {
  games,
  notificationPreferences,
  notifications,
  outcomes,
  pushDevices,
  stats,
  userAchievements,
} from '../src/db/schema.js';
import {
  authHeadersFor,
  buildTestApp,
  createLogCapture,
  createPushDevice,
  createTournament,
  createUser,
  expoTokenOf,
  truncateAll,
} from './helpers.js';
import { startPushCollector, type PushCollector, type PushMessage } from './push-collector.js';
import { TEST_DATABASE_URL } from './test-env.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;

async function submit(
  app: FastifyInstance,
  caller: UserRow,
  winners: UserRow[],
  losers: UserRow[],
) {
  return app.inject({
    method: 'POST',
    url: '/tournaments/babyfoot/games',
    headers: await authHeadersFor(app, caller.id),
    payload: {
      outcomes: [
        ...winners.map((u) => ({ username: u.username, result: 'WIN' })),
        ...losers.map((u) => ({ username: u.username, result: 'LOSS' })),
      ],
    },
  });
}

// Winners also get achievement_unlocked rows and pushes (first_win); those are covered by the
// achievements tests, so these cases look at game_recorded only.
const inboxOf = (db: Database, userId: string) =>
  db
    .select()
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, userId), eq(notifications.type, 'game_recorded')));

const gameRecordedRows = (db: Database) =>
  db.select().from(notifications).where(eq(notifications.type, 'game_recorded'));

const gameMessages = (collector: PushCollector) =>
  collector
    .messages()
    .filter((m) => (m.data as { target?: { type?: string } }).target?.type === 'game');

describe('game_recorded fan-out (VAL-NOTIF-006, VAL-NOTIF-012, VAL-NOTIF-013)', () => {
  let collector: PushCollector;
  let app: FastifyInstance;
  let observer: Database;
  let alice: UserRow;
  let bob: UserRow;
  let carol: UserRow;
  let dave: UserRow;
  let eve: UserRow;

  beforeAll(async () => {
    collector = await startPushCollector();
    app = await buildTestApp({ env: { PUSH_URL: collector.url } });
    observer = createDb(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    await app.close();
    await collector.close();
    await observer.$client.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    collector.reset();
    await createTournament(app.db, { name: 'babyfoot', displayName: 'Baby Foot' });
    alice = await createUser(app.db, { username: 'alice' });
    bob = await createUser(app.db, { username: 'bob' });
    carol = await createUser(app.db, { username: 'carol' });
    dave = await createUser(app.db, { username: 'dave' });
    eve = await createUser(app.db, { username: 'eve' });
    await createPushDevice(app.db, { userId: alice.id, expoToken: expoTokenOf('alice-phone') });
    await createPushDevice(app.db, { userId: bob.id, expoToken: expoTokenOf('bob-phone') });
    await createPushDevice(app.db, { userId: bob.id, expoToken: expoTokenOf('bob-tablet') });
    await createPushDevice(app.db, {
      userId: bob.id,
      expoToken: expoTokenOf('bob-old'),
      disabledAt: new Date(),
    });
    await createPushDevice(app.db, { userId: carol.id, expoToken: expoTokenOf('carol-phone') });
    await createPushDevice(app.db, { userId: eve.id, expoToken: expoTokenOf('eve-phone') });
  });

  it('creates exactly one inbox row per participant, the losing submitter included', async () => {
    const res = await submit(app, alice, [carol, dave], [alice, bob]);
    await app.push.drain();

    expect(res.statusCode).toBe(201);
    const gameId = res.json().id as string;
    for (const user of [alice, bob, carol, dave]) {
      const rows = await inboxOf(app.db, user.id);
      expect(rows, user.username).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: 'game_recorded',
        category: 'games',
        gameId,
        actorUserId: alice.id,
        readAt: null,
      });
    }
    expect(await inboxOf(app.db, eve.id)).toHaveLength(0);

    const inbox = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: await authHeadersFor(app, carol.id),
    });
    expect(inbox.json().filter((n: { type: string }) => n.type === 'game_recorded')).toEqual([
      expect.objectContaining({
        type: 'game_recorded',
        title: 'You won in Baby Foot',
        body: 'You and dave beat alice and bob (+16 Elo)',
        target: { type: 'game', gameId },
        actor: expect.objectContaining({ username: 'alice' }),
      }),
    ]);
    const loserView = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: await authHeadersFor(app, alice.id),
    });
    expect(loserView.json()[0]).toMatchObject({
      title: 'You lost in Baby Foot',
      body: 'carol and dave beat you and bob (-16 Elo)',
    });
  });

  it('pushes the exact typed payload once to every enabled device of every participant', async () => {
    const res = await submit(app, alice, [carol, dave], [alice, bob]);
    await app.push.drain();

    const gameId = res.json().id as string;
    const idOf = async (user: UserRow) => (await inboxOf(app.db, user.id))[0]!.id;
    const messages = gameMessages(collector);
    const byToken = new Map(messages.map((m) => [m.to, m]));
    expect(messages.map((m) => m.to).sort()).toEqual(
      [
        expoTokenOf('alice-phone'),
        expoTokenOf('bob-phone'),
        expoTokenOf('bob-tablet'),
        expoTokenOf('carol-phone'),
      ].sort(),
    );
    const expected = async (user: UserRow, title: string, body: string): Promise<PushMessage> => ({
      to: expect.any(String) as unknown as string,
      title,
      body,
      sound: 'default',
      data: { notificationId: await idOf(user), target: { type: 'game', gameId } },
    });
    expect(byToken.get(expoTokenOf('carol-phone'))).toEqual(
      await expected(carol, 'You won in Baby Foot', 'You and dave beat alice and bob (+16 Elo)'),
    );
    expect(byToken.get(expoTokenOf('bob-tablet'))).toEqual(
      await expected(bob, 'You lost in Baby Foot', 'carol and dave beat you and alice (-16 Elo)'),
    );
    for (const message of messages) {
      expect(Object.keys(message.data ?? {}).sort()).toEqual(['notificationId', 'target']);
      const { to, ...rest } = message;
      expect(JSON.stringify(rest)).not.toContain('ExponentPushToken');
      expect(JSON.stringify(rest)).not.toMatch(/https?:\/\//);
      expect(to).toMatch(/^ExponentPushToken\[/);
    }
    expect(collector.received).toHaveLength(1);
    expect(collector.received[0]?.headers['content-type']).toContain('application/json');
  });

  it('sends only after the game transaction committed', async () => {
    const seen: { games: number; notifications: number }[] = [];
    collector.onRequest(async () => {
      const [g] = await observer.select({ n: count() }).from(games);
      const [n] = await observer.select({ n: count() }).from(notifications);
      seen.push({ games: g?.n ?? 0, notifications: n?.n ?? 0 });
    });

    const res = await submit(app, alice, [bob], [alice]);
    await app.push.drain();

    expect(res.statusCode).toBe(201);
    // Two game_recorded rows plus bob's first_win unlock.
    expect(seen).toEqual([{ games: 1, notifications: 3 }]);
  });

  it('keeps inbox rows but sends no push for a disabled games category', async () => {
    await app.db.insert(notificationPreferences).values({ userId: bob.id, gamesEnabled: false });

    const res = await submit(app, alice, [bob], [alice]);
    await app.push.drain();

    expect(res.statusCode).toBe(201);
    expect(await inboxOf(app.db, bob.id)).toHaveLength(1);
    expect(gameMessages(collector).map((m) => m.to)).toEqual([expoTokenOf('alice-phone')]);
  });

  it('pushes again once the category is re-enabled through the API', async () => {
    const headers = await authHeadersFor(app, bob.id);
    const url = '/users/me/notification-preferences';
    await app.inject({ method: 'PUT', url, headers, payload: { games: false } });
    await submit(app, alice, [bob], [alice]);
    await app.push.drain();
    expect(gameMessages(collector).map((m) => m.to)).not.toContain(expoTokenOf('bob-phone'));

    collector.reset();
    await app.inject({ method: 'PUT', url, headers, payload: { games: true } });
    await submit(app, alice, [bob], [alice]);
    await app.push.drain();
    expect(collector.messages().map((m) => m.to)).toEqual(
      expect.arrayContaining([expoTokenOf('bob-phone'), expoTokenOf('bob-tablet')]),
    );
  });

  it('a disabled category for one user leaves the other categories and users unaffected', async () => {
    await app.db.insert(notificationPreferences).values({ userId: bob.id, claimsEnabled: false });

    await submit(app, alice, [bob], [alice]);
    await app.push.drain();

    expect(collector.messages().map((m) => m.to)).toEqual(
      expect.arrayContaining([expoTokenOf('bob-phone'), expoTokenOf('bob-tablet')]),
    );
  });

  it('does not push or record anything when a submission is rejected', async () => {
    const res = await submit(app, bob, [bob], [alice]);
    await app.push.drain();

    expect(res.statusCode).toBe(403);
    expect(await app.db.select().from(notifications)).toHaveLength(0);
    expect(collector.received).toHaveLength(0);
  });

  it('device-less participants still get their inbox row', async () => {
    const res = await submit(app, dave, [eve], [dave]);
    await app.push.drain();

    expect(res.statusCode).toBe(201);
    expect(await inboxOf(app.db, dave.id)).toHaveLength(1);
    expect(gameMessages(collector).map((m) => m.to)).toEqual([expoTokenOf('eve-phone')]);
  });
});

describe('DeviceNotRegistered handling (VAL-NOTIF-014)', () => {
  let collector: PushCollector;
  let app: FastifyInstance;
  let alice: UserRow;
  let bob: UserRow;

  beforeAll(async () => {
    collector = await startPushCollector();
    app = await buildTestApp({ env: { PUSH_URL: collector.url } });
  });

  afterAll(async () => {
    await app.close();
    await collector.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    collector.reset();
    await createTournament(app.db, { name: 'babyfoot', displayName: 'Baby Foot' });
    alice = await createUser(app.db, { username: 'alice' });
    bob = await createUser(app.db, { username: 'bob' });
  });

  const deadTicket = (token: string) => ({
    status: 'error',
    message: `"${token}" is not a registered push notification recipient`,
    details: { error: 'DeviceNotRegistered', expoPushToken: token },
  });

  const deviceByToken = async (token: string) =>
    (await app.db.select().from(pushDevices).where(eq(pushDevices.expoToken, token)))[0];

  it('disables exactly the device whose ticket says DeviceNotRegistered', async () => {
    const dead = expoTokenOf('bob-dead');
    await createPushDevice(app.db, { userId: alice.id, expoToken: expoTokenOf('alice') });
    await createPushDevice(app.db, { userId: bob.id, expoToken: dead });
    await createPushDevice(app.db, { userId: bob.id, expoToken: expoTokenOf('bob-live') });
    collector.respondWithTickets((messages) =>
      messages.map((m, i) =>
        m.to === dead
          ? deadTicket(m.to)
          : i % 2 === 0
            ? { status: 'ok', id: `t${i}` }
            : { status: 'error', message: 'rate', details: { error: 'MessageRateExceeded' } },
      ),
    );

    await submit(app, alice, [bob], [alice]);
    await app.push.drain();

    expect((await deviceByToken(dead))?.disabledAt).toBeInstanceOf(Date);
    expect((await deviceByToken(expoTokenOf('bob-live')))?.disabledAt).toBeNull();
    expect((await deviceByToken(expoTokenOf('alice')))?.disabledAt).toBeNull();

    collector.reset();
    await submit(app, alice, [bob], [alice]);
    await app.push.drain();
    const recipients = collector.messages().map((m) => m.to);
    expect(recipients).toContain(expoTokenOf('bob-live'));
    expect(recipients).not.toContain(dead);
  });

  it('a late ticket for a token that has since rotated does not disable the new token', async () => {
    const old = expoTokenOf('bob-old');
    const rotated = expoTokenOf('bob-rotated');
    const device = await createPushDevice(app.db, {
      userId: bob.id,
      installationId: 'bob-phone',
      expoToken: old,
    });
    collector.onRequest(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/users/me/push-devices',
        headers: await authHeadersFor(app, bob.id),
        payload: { installationId: 'bob-phone', expoToken: rotated, platform: 'IOS' },
      });
      expect(res.statusCode).toBe(204);
    });
    collector.respondWithTickets((messages) => messages.map((m) => deadTicket(m.to)));

    await submit(app, alice, [bob], [alice]);
    await app.push.drain();

    expect(gameMessages(collector).map((m) => m.to)).toEqual([old]);
    const [row] = await app.db.select().from(pushDevices).where(eq(pushDevices.id, device.id));
    expect(row).toMatchObject({ expoToken: rotated, disabledAt: null });
  });

  it('chunks more than 100 messages and maps tickets back in order', async () => {
    const devices = [];
    for (let i = 0; i < 105; i++) {
      devices.push(
        await createPushDevice(app.db, { userId: bob.id, expoToken: expoTokenOf(`b${i}`) }),
      );
    }
    // Already unlocked, so the game sends exactly one message per device.
    await app.db
      .insert(userAchievements)
      .values({ userId: bob.id, achievementCode: 'first_win', sourceType: 'BACKFILL' });
    const dead = new Set([expoTokenOf('b3'), expoTokenOf('b102')]);
    collector.respondWithTickets((messages) =>
      messages.map((m, i) => (dead.has(m.to) ? deadTicket(m.to) : { status: 'ok', id: `${i}` })),
    );

    await submit(app, alice, [bob], [alice]);
    await app.push.drain();

    expect(collector.received.map((r) => (r.body as unknown[]).length)).toEqual([100, 5]);
    const disabled = await app.db
      .select({ token: pushDevices.expoToken })
      .from(pushDevices)
      .where(and(eq(pushDevices.userId, bob.id), sql`${pushDevices.disabledAt} is not null`));
    expect(disabled.map((d) => d.token).sort()).toEqual([...dead].sort());
  });
});

describe('Expo transport failures never fail a saved game (VAL-NOTIF-015)', () => {
  let collector: PushCollector;
  let app: FastifyInstance;
  const capture = createLogCapture();

  beforeAll(async () => {
    collector = await startPushCollector();
    app = await buildTestApp({
      env: { PUSH_URL: collector.url, PUSH_TIMEOUT_MS: '200', EXPO_ACCESS_TOKEN: 'expo-test-key' },
      logger: capture,
    });
  });

  afterAll(async () => {
    await app.close();
    await collector.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    collector.reset();
    capture.lines.length = 0;
  });

  async function playAndAssertCommitted() {
    await createTournament(app.db, { name: 'babyfoot', displayName: 'Baby Foot' });
    const alice = await createUser(app.db, { username: 'alice' });
    const bob = await createUser(app.db, { username: 'bob' });
    await createPushDevice(app.db, { userId: bob.id, expoToken: expoTokenOf('bob') });

    const started = Date.now();
    const res = await submit(app, alice, [bob], [alice]);
    await app.push.drain();
    const elapsed = Date.now() - started;

    expect(res.statusCode).toBe(201);
    const gameId = res.json().id as string;
    expect(await app.db.select().from(games).where(eq(games.id, gameId))).toHaveLength(1);
    expect(await app.db.select().from(outcomes).where(eq(outcomes.gameId, gameId))).toHaveLength(2);
    const rows = await app.db.select().from(stats);
    expect(rows.find((r) => r.userId === bob.id)?.score).toBeCloseTo(1016, 9);
    expect(await gameRecordedRows(app.db)).toHaveLength(2);
    const [device] = await app.db.select().from(pushDevices);
    expect(device?.disabledAt).toBeNull();
    expect(capture.text()).not.toContain(expoTokenOf('bob'));
    return { elapsed };
  }

  it('survives an HTTP 500 from Expo', async () => {
    collector.respondWith(500);
    await playAndAssertCommitted();
    expect(collector.received).toHaveLength(1);
    expect(capture.text()).toContain('push chunk failed');
  });

  it('survives a non-JSON body', async () => {
    collector.respondRaw(200, '<html>bad gateway</html>');
    await playAndAssertCommitted();
    expect(capture.text()).toContain('push chunk failed');
  });

  it('survives a ticket list that does not match the batch', async () => {
    collector.respondWith(200, { data: [] });
    await playAndAssertCommitted();
    expect(capture.text()).toContain('malformed tickets');
  });

  it('survives a slow endpoint by aborting after PUSH_TIMEOUT_MS', async () => {
    collector.delay(3000);
    const { elapsed } = await playAndAssertCommitted();
    expect(elapsed).toBeLessThan(2500);
    expect(capture.text()).toContain('push chunk failed');
  });

  it('sends the optional EXPO_ACCESS_TOKEN as a bearer header', async () => {
    await playAndAssertCommitted();
    expect(collector.received[0]?.headers.authorization).toBe('Bearer expo-test-key');
  });

  it('a user without push devices saves normally and sends nothing', async () => {
    await createTournament(app.db, { name: 'babyfoot', displayName: 'Baby Foot' });
    const alice = await createUser(app.db, { username: 'alice' });
    const bob = await createUser(app.db, { username: 'bob' });

    const res = await submit(app, alice, [bob], [alice]);
    await app.push.drain();

    expect(res.statusCode).toBe(201);
    expect(await gameRecordedRows(app.db)).toHaveLength(2);
    expect(collector.received).toHaveLength(0);
  });
});

describe('unreachable Expo endpoint (VAL-NOTIF-015)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ env: { PUSH_URL: 'http://127.0.0.1:1/push' } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('still returns 201 with the game, stats and inbox rows committed', async () => {
    await truncateAll(app.db);
    await createTournament(app.db, { name: 'babyfoot', displayName: 'Baby Foot' });
    const alice = await createUser(app.db, { username: 'alice' });
    const bob = await createUser(app.db, { username: 'bob' });
    await createPushDevice(app.db, { userId: bob.id });

    const res = await submit(app, alice, [bob], [alice]);
    await app.push.drain();

    expect(res.statusCode).toBe(201);
    expect(await app.db.select().from(games)).toHaveLength(1);
    expect(await gameRecordedRows(app.db)).toHaveLength(2);
    const rows = await app.db.select().from(stats);
    expect(rows.find((r) => r.userId === alice.id)?.score).toBeCloseTo(984, 9);
  });
});

describe('game transaction rollback (VAL-NOTIF-018)', () => {
  let collector: PushCollector;
  let app: FastifyInstance;

  beforeAll(async () => {
    collector = await startPushCollector();
    app = await buildTestApp({ env: { PUSH_URL: collector.url } });
  });

  afterAll(async () => {
    await app.close();
    await collector.close();
  });

  afterEach(async () => {
    await app.db.execute(sql`drop trigger if exists test_fail_at_commit on notifications`);
    await app.db.execute(sql`drop function if exists test_fail_at_commit()`);
  });

  it('a failure at commit, after inbox rows were written, rolls everything back and sends nothing', async () => {
    await truncateAll(app.db);
    collector.reset();
    await createTournament(app.db, { name: 'babyfoot', displayName: 'Baby Foot' });
    const alice = await createUser(app.db, { username: 'alice' });
    const bob = await createUser(app.db, { username: 'bob' });
    await createPushDevice(app.db, { userId: alice.id });
    await createPushDevice(app.db, { userId: bob.id });
    // Deferred, so it fires at COMMIT: after the game, stats and inbox inserts all succeeded.
    await app.db.execute(
      sql.raw(`
      create function test_fail_at_commit() returns trigger language plpgsql as $$
      begin raise exception 'injected failure at commit'; end $$`),
    );
    await app.db.execute(
      sql.raw(`
      create constraint trigger test_fail_at_commit after insert on notifications
      deferrable initially deferred for each row execute function test_fail_at_commit()`),
    );

    const res = await submit(app, alice, [bob], [alice]);
    await app.push.drain();

    expect(res.statusCode).toBe(500);
    expect(await app.db.select().from(games)).toHaveLength(0);
    expect(await app.db.select().from(outcomes)).toHaveLength(0);
    expect(await app.db.select().from(stats)).toHaveLength(0);
    expect(await app.db.select().from(notifications)).toHaveLength(0);
    expect(collector.received).toHaveLength(0);
  });
});
