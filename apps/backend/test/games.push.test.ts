import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { games, stats } from '../src/db/schema.js';
import {
  authHeadersFor,
  buildTestApp,
  createTournament,
  createUser,
  truncateAll,
} from './helpers.js';
import { startPushCollector, type PushCollector } from './push-collector.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;

const tokenOf = (name: string) => `ExponentPushToken[${name}]`;

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

describe('VAL-GAME-009: postgame push', () => {
  let collector: PushCollector;
  let app: FastifyInstance;
  let alice: UserRow;
  let bob: UserRow;
  let carol: UserRow;
  let dave: UserRow;

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
    alice = await createUser(app.db, { username: 'alice', pushToken: tokenOf('alice') });
    bob = await createUser(app.db, { username: 'bob', pushToken: tokenOf('bob') });
    carol = await createUser(app.db, { username: 'carol', pushToken: tokenOf('carol') });
    dave = await createUser(app.db, { username: 'dave', pushToken: null });
  });

  it('sends "Well done Champ !" to the winner, naming the loser and the integer delta', async () => {
    const res = await submit(app, alice, [bob], [alice]);

    expect(res.statusCode).toBe(201);
    expect(collector.received).toHaveLength(1);
    const [push] = collector.received;
    expect(push?.method).toBe('POST');
    expect(push?.body).toEqual({
      to: tokenOf('bob'),
      title: 'Well done Champ !',
      body: 'You just got 16 points from alice',
      sound: 'default',
      data: {
        title: 'Well done Champ !',
        message: 'You just got 16 points from alice',
        payload: { type: 'postgame', gameId: res.json().id, tournamentName: 'babyfoot' },
      },
    });
  });

  it('truncates a fractional delta to its integer part', async () => {
    // After a first game bob is 1016 and alice 984, so the next delta is fractional.
    await submit(app, alice, [bob], [alice]);
    collector.reset();

    const res = await submit(app, alice, [bob], [alice]);

    expect(res.statusCode).toBe(201);
    const winnerScore = res
      .json()
      .outcomes.find((o: { user: { username: string } }) => o.user.username === 'bob')
      .scoreValue as number;
    expect(Number.isInteger(winnerScore)).toBe(false);
    expect(collector.received[0]?.body).toMatchObject({
      body: `You just got ${Math.trunc(winnerScore)} points from alice`,
    });
  });

  it('notifies every winner with a token in a 2v2 and names both losers', async () => {
    const res = await submit(app, alice, [carol, dave], [alice, bob]);

    expect(res.statusCode).toBe(201);
    expect(collector.received).toHaveLength(1);
    expect(collector.received[0]?.body).toMatchObject({
      to: tokenOf('carol'),
      title: 'Well done Champ !',
      body: 'You just got 16 points from alice, bob',
    });
  });

  it('sends one push per winner holding a token', async () => {
    const eve = await createUser(app.db, { username: 'eve', pushToken: tokenOf('eve') });

    const res = await submit(app, alice, [carol, eve], [alice, bob]);

    expect(res.statusCode).toBe(201);
    const recipients = collector.received.map((p) => (p.body as { to: string }).to).sort();
    expect(recipients).toEqual([tokenOf('carol'), tokenOf('eve')]);
  });

  it('never notifies losers', async () => {
    await submit(app, alice, [dave], [alice]);
    expect(collector.received).toHaveLength(0);
  });

  it('does not push when a submission is rejected', async () => {
    const res = await submit(app, bob, [bob], [alice]);
    expect(res.statusCode).toBe(403);
    expect(collector.received).toHaveLength(0);
  });

  it('still returns 201 and persists stats when the push API answers 500', async () => {
    collector.respondWith(500);

    const res = await submit(app, alice, [bob], [alice]);

    expect(res.statusCode).toBe(201);
    expect(collector.received).toHaveLength(1);
    const [row] = await app.db.select().from(stats).where(eq(stats.userId, bob.id));
    expect(row?.score).toBeCloseTo(1016, 9);
  });
});

describe('VAL-GAME-009: postgame push with an unreachable PUSH_URL', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ env: { PUSH_URL: 'http://127.0.0.1:1/push' } });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
  });

  it('does not fail the game: 201, game and stats persisted', async () => {
    await createTournament(app.db, { name: 'babyfoot', displayName: 'Baby Foot' });
    const alice = await createUser(app.db, { username: 'alice', pushToken: tokenOf('alice') });
    const bob = await createUser(app.db, { username: 'bob', pushToken: tokenOf('bob') });

    const res = await submit(app, alice, [bob], [alice]);

    expect(res.statusCode).toBe(201);
    const persisted = await app.db.select().from(games).where(eq(games.id, res.json().id));
    expect(persisted).toHaveLength(1);
    const rows = await app.db.select().from(stats);
    const scoreOf = (id: string) => rows.find((r) => r.userId === id)?.score;
    expect(scoreOf(bob.id)).toBeCloseTo(1016, 9);
    expect(scoreOf(alice.id)).toBeCloseTo(984, 9);
  });
});
