import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  challenges,
  games,
  notifications,
  outcomes,
  rivalryStats,
  stats,
  userAchievements,
} from '../src/db/schema.js';
import {
  achievementCodesOf,
  authHeadersFor,
  buildTestApp,
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

const T0 = new Date('2026-06-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('challenge completion by games', () => {
  let collector: PushCollector;
  let app: FastifyInstance;
  let now: Date;
  let alice: UserRow;
  let bob: UserRow;
  let carol: UserRow;
  let dave: UserRow;
  let cup: TournamentRow;
  let other: TournamentRow;

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
    dave = await createUser(app.db, { username: 'dave' });
    cup = await createTournament(app.db, { name: 'cup', displayName: 'Cup' });
    other = await createTournament(app.db, { name: 'other', displayName: 'Other' });
  });

  afterEach(async () => {
    await app.push.drain();
  });

  const api = async (user: UserRow, method: string, url: string, payload?: object) =>
    app.inject({
      method: method as 'GET',
      url,
      headers: await authHeadersFor(app, user.id),
      ...(payload === undefined ? {} : { payload }),
    });

  const challenge = async (
    challenger: UserRow,
    opponent: UserRow,
    opts: { tournament?: TournamentRow; accept?: boolean; deadlineAt?: Date } = {},
  ): Promise<string> => {
    const res = await api(challenger, 'POST', '/challenges', {
      tournamentName: (opts.tournament ?? cup).name,
      opponentUsername: opponent.username,
      ...(opts.deadlineAt ? { deadlineAt: opts.deadlineAt.toISOString() } : {}),
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json<{ id: string }>().id;
    if (opts.accept ?? true) {
      const accepted = await api(opponent, 'PUT', `/challenges/${id}/response`, {
        response: 'ACCEPT',
      });
      expect(accepted.statusCode, accepted.body).toBe(200);
    }
    return id;
  };

  const play = async (
    winners: UserRow[],
    losers: UserRow[],
    tournament: TournamentRow = cup,
  ): Promise<string> => {
    const res = await api(losers[0]!, 'POST', `/tournaments/${tournament.name}/games`, {
      outcomes: [
        ...winners.map((u) => ({ username: u.username, result: 'WIN' })),
        ...losers.map((u) => ({ username: u.username, result: 'LOSS' })),
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
  };

  const row = async (id: string) => {
    const [found] = await app.db.select().from(challenges).where(eq(challenges.id, id));
    if (!found) throw new Error('challenge missing');
    return found;
  };

  const challengeBadgeNotifications = () =>
    app.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.type, 'achievement_unlocked'),
          eq(notifications.achievementCode, 'first_challenge_won'),
        ),
      );

  describe('eligibility (VAL-CHAL-013, VAL-CHAL-015)', () => {
    it('a game during PENDING completes nothing and is not attached after acceptance', async () => {
      const id = await challenge(alice, bob, { accept: false });
      now = at(HOUR);
      await play([alice], [bob]);
      expect((await row(id)).status).toBe('PENDING');

      now = at(2 * HOUR);
      const accepted = await api(bob, 'PUT', `/challenges/${id}/response`, { response: 'ACCEPT' });
      expect(accepted.json()).toMatchObject({ status: 'ACCEPTED', gameId: null, winner: null });
      expect(await achievementCodesOf(app.db, alice.id)).not.toContain('first_challenge_won');
      expect(await challengeBadgeNotifications()).toHaveLength(0);
    });

    it('a game whose operation clock precedes the acceptance cannot complete it', async () => {
      now = at(2 * HOUR);
      const id = await challenge(alice, bob);
      now = at(HOUR);
      await play([alice], [bob]);
      expect(await row(id)).toMatchObject({ status: 'ACCEPTED', gameId: null });
    });

    it('the next qualifying game completes it with the winner and game link for both players', async () => {
      const id = await challenge(alice, bob);
      now = at(HOUR);
      const gameId = await play([bob], [alice]);

      expect(await row(id)).toMatchObject({
        status: 'COMPLETED',
        winnerUserId: bob.id,
        gameId,
        resolvedAt: at(HOUR),
      });
      for (const viewer of [alice, bob]) {
        const detail = await api(viewer, 'GET', `/challenges/${id}`);
        expect(detail.json()).toMatchObject({
          status: 'COMPLETED',
          winner: { username: 'bob' },
          gameId,
          resolvedAt: at(HOUR).toISOString(),
        });
        const list = await api(viewer, 'GET', '/challenges?status=COMPLETED');
        expect(list.json()).toEqual([expect.objectContaining({ id, gameId })]);
      }

      now = at(2 * HOUR);
      await play([alice], [bob]);
      expect(await row(id)).toMatchObject({ status: 'COMPLETED', winnerUserId: bob.id, gameId });
    });

    it('ignores same-team games, other tournaments and games missing a player', async () => {
      const id = await challenge(alice, bob);
      await play([alice, bob], [carol, dave]);
      await play([alice], [bob], other);
      await play([alice], [carol]);
      await play([dave], [bob]);
      expect(await row(id)).toMatchObject({ status: 'ACCEPTED', gameId: null, winnerUserId: null });
      expect(await challengeBadgeNotifications()).toHaveLength(0);
    });

    it('completes strictly before the deadline but not at it', async () => {
      const deadline = at(2 * HOUR);
      const early = await challenge(alice, bob, { deadlineAt: deadline });
      const late = await challenge(carol, dave, { deadlineAt: deadline });

      now = new Date(deadline.getTime() - 1);
      const gameId = await play([alice], [bob]);
      now = deadline;
      await play([carol], [dave]);

      expect(await row(early)).toMatchObject({ status: 'COMPLETED', gameId });
      expect(await row(late)).toMatchObject({ status: 'ACCEPTED', gameId: null });
      expect(await achievementCodesOf(app.db, carol.id)).not.toContain('first_challenge_won');
    });

    it('leaves final challenges untouched by later games (VAL-CHAL-022)', async () => {
      const declined = await challenge(alice, bob, { accept: false });
      await api(bob, 'PUT', `/challenges/${declined}/response`, { response: 'DECLINE' });
      const before = await row(declined);
      await play([alice], [bob]);
      expect(await row(declined)).toEqual(before);
    });
  });

  it('one team game completes every eligible opposing pair (VAL-CHAL-016)', async () => {
    const aliceCarol = await challenge(carol, alice);
    const bobDave = await challenge(dave, bob);
    const aliceDavePending = await challenge(alice, dave, { accept: false });
    const sameTeam = await challenge(alice, bob);
    const otherCup = await challenge(alice, carol, { tournament: other });
    now = at(HOUR);

    const gameId = await play([alice, bob], [carol, dave]);

    expect(await row(aliceCarol)).toMatchObject({
      status: 'COMPLETED',
      winnerUserId: alice.id,
      gameId,
    });
    expect(await row(bobDave)).toMatchObject({ status: 'COMPLETED', winnerUserId: bob.id, gameId });
    expect(await row(aliceDavePending)).toMatchObject({ status: 'PENDING', gameId: null });
    expect(await row(sameTeam)).toMatchObject({ status: 'ACCEPTED', gameId: null });
    expect(await row(otherCup)).toMatchObject({ status: 'ACCEPTED', gameId: null });
    expect(await achievementCodesOf(app.db, carol.id)).not.toContain('first_challenge_won');
    expect(await achievementCodesOf(app.db, dave.id)).not.toContain('first_challenge_won');
  });

  describe('first_challenge_won (VAL-CHAL-017)', () => {
    it('goes once to the winning challenged player, not the loser or teammates', async () => {
      const id = await challenge(alice, carol);
      now = at(HOUR);
      const gameId = await play([carol, bob], [alice, dave]);

      const badges = await app.db
        .select()
        .from(userAchievements)
        .where(eq(userAchievements.achievementCode, 'first_challenge_won'));
      expect(badges).toEqual([
        expect.objectContaining({
          userId: carol.id,
          sourceType: 'CHALLENGE',
          sourceChallengeId: id,
          sourceGameId: gameId,
        }),
      ]);
      expect((await challengeBadgeNotifications()).map((n) => n.recipientUserId)).toEqual([
        carol.id,
      ]);

      // dave played in the game but not in the challenge, so only the game source is his to see.
      const profile = await api(dave, 'GET', '/users/carol/achievements');
      expect(profile.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'first_challenge_won',
            unlocked: true,
            source: { type: 'CHALLENGE', gameId, groupId: null, challengeId: null },
          }),
        ]),
      );
      const own = await api(carol, 'GET', '/users/carol/achievements');
      expect(own.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'first_challenge_won',
            source: expect.objectContaining({ challengeId: id }),
          }),
        ]),
      );

      const again = await challenge(carol, bob, { tournament: other });
      now = at(2 * HOUR);
      await play([carol], [bob], other);
      expect((await row(again)).status).toBe('COMPLETED');
      expect(
        await app.db
          .select()
          .from(userAchievements)
          .where(eq(userAchievements.achievementCode, 'first_challenge_won')),
      ).toHaveLength(1);
      expect(await challengeBadgeNotifications()).toHaveLength(1);
    });

    it('keeps the badge but hides the private source after the winner leaves the group (VAL-CHAL-023)', async () => {
      const group = await createGroup(app.db, {
        ownerId: alice.id,
        members: { [bob.id]: 'MEMBER' },
      });
      const secret = await createTournament(app.db, {
        name: 'secret',
        displayName: 'Secret Cup',
        ownerUserId: alice.id,
        groupId: group.id,
      });
      const id = await challenge(alice, bob, { tournament: secret });
      now = at(HOUR);
      const gameId = await play([bob], [alice], secret);
      const before = await api(bob, 'GET', '/users/bob/achievements');
      expect(before.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'first_challenge_won',
            source: { type: 'CHALLENGE', gameId, groupId: null, challengeId: id },
          }),
        ]),
      );

      const left = await api(bob, 'POST', `/groups/${group.id}/leave`);
      expect(left.statusCode).toBe(204);

      for (const url of ['/users/bob/achievements', '/achievements/recent']) {
        const res = await api(bob, 'GET', url);
        expect(res.statusCode).toBe(200);
        expect(res.body).not.toContain(id);
        expect(res.body).not.toContain(gameId);
        expect(res.body).not.toContain('Secret');
      }
      expect(await achievementCodesOf(app.db, bob.id)).toContain('first_challenge_won');
      expect((await api(bob, 'GET', '/users/bob/achievements')).json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'first_challenge_won',
            unlocked: true,
            source: { type: 'CHALLENGE', gameId: null, groupId: null, challengeId: null },
          }),
        ]),
      );
    });
  });

  describe('atomicity (VAL-CHAL-018)', () => {
    afterEach(async () => {
      await app.db.execute(sql`drop trigger if exists test_fail_at_commit on challenges`);
      await app.db.execute(sql`drop function if exists test_fail_at_commit()`);
    });

    it('a failure before commit leaves no game, rating, completion, badge, inbox or push', async () => {
      await createPushDevice(app.db, { userId: alice.id, expoToken: expoTokenOf('alice') });
      await createPushDevice(app.db, { userId: bob.id, expoToken: expoTokenOf('bob') });
      const id = await challenge(alice, bob);
      await play([alice], [bob]);
      await app.push.drain();
      collector.reset();
      const snapshot = async () => ({
        games: await app.db.select().from(games),
        outcomes: await app.db.select().from(outcomes),
        stats: await app.db.select().from(stats),
        rivalries: await app.db.select().from(rivalryStats),
        badges: await app.db.select().from(userAchievements),
        notifications: await app.db.select().from(notifications),
      });
      // That first game completed the challenge; start a fresh accepted one.
      const second = await challenge(bob, alice);
      const before = await snapshot();
      await app.db.execute(
        sql.raw(`create function test_fail_at_commit() returns trigger language plpgsql as $$
          begin raise exception 'injected failure at commit'; end $$`),
      );
      await app.db.execute(
        sql.raw(`create constraint trigger test_fail_at_commit after update on challenges
          deferrable initially deferred for each row
          when (new.status = 'COMPLETED') execute function test_fail_at_commit()`),
      );
      await app.push.drain();
      collector.reset();
      now = at(HOUR);

      const res = await api(alice, 'POST', '/tournaments/cup/games', {
        outcomes: [
          { username: 'bob', result: 'WIN' },
          { username: 'alice', result: 'LOSS' },
        ],
      });
      await app.push.drain();

      expect(res.statusCode).toBe(500);
      expect(await snapshot()).toEqual(before);
      expect(await row(second)).toMatchObject({ status: 'ACCEPTED', gameId: null });
      expect((await row(id)).status).toBe('COMPLETED');
      expect(collector.received).toHaveLength(0);
    });

    it('a failing push API does not undo the game or the completion', async () => {
      await createPushDevice(app.db, { userId: alice.id, expoToken: expoTokenOf('alice') });
      await createPushDevice(app.db, { userId: bob.id, expoToken: expoTokenOf('bob') });
      const id = await challenge(alice, bob);
      collector.respondWith(500);
      now = at(HOUR);

      const gameId = await play([alice], [bob]);
      await app.push.drain();

      expect(collector.received.length).toBeGreaterThan(0);
      expect(await row(id)).toMatchObject({ status: 'COMPLETED', gameId });
      expect(await achievementCodesOf(app.db, alice.id)).toContain('first_challenge_won');
    });
  });
});
