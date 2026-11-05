import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { challenges, notifications } from '../src/db/schema.js';
import {
  addGroupMember,
  authHeadersFor,
  buildTestApp,
  createChallengeRow,
  createGroup,
  createPlaceholderUser,
  createPushDevice,
  createTournament,
  createUser,
  expoTokenOf,
  truncateAll,
} from './helpers.js';
import { startPushCollector, type PushCollector } from './push-collector.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;
type TournamentRow = Awaited<ReturnType<typeof createTournament>>;

interface ChallengeDto {
  id: string;
  status: string;
  deadlineAt: string;
  createdAt: string;
  acceptedAt: string | null;
  resolvedAt: string | null;
  tournament: { name: string };
  challenger: { username: string };
  opponent: { username: string };
  winner: { username: string } | null;
  gameId: string | null;
}

const T0 = new Date('2026-06-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('challenges API', () => {
  let collector: PushCollector;
  let app: FastifyInstance;
  let now: Date;
  let alice: UserRow;
  let bob: UserRow;
  let carol: UserRow;
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
    alice = await createUser(app.db, { username: 'alice', firstName: 'Alice' });
    bob = await createUser(app.db, { username: 'bob', firstName: 'Bob' });
    carol = await createUser(app.db, { username: 'carol', firstName: 'Carol' });
    cup = await createTournament(app.db, { name: 'cup', displayName: 'Cup' });
    other = await createTournament(app.db, { name: 'other', displayName: 'Other Cup' });
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

  const create = (caller: UserRow, body: object) => api(caller, 'POST', '/challenges', body);

  const createOk = async (
    caller: UserRow,
    opponent: UserRow,
    tournament: TournamentRow = cup,
    extra: object = {},
  ) => {
    const res = await create(caller, {
      tournamentName: tournament.name,
      opponentUsername: opponent.username,
      ...extra,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<ChallengeDto>();
  };

  const respond = (caller: UserRow, id: string, response: 'ACCEPT' | 'DECLINE') =>
    api(caller, 'PUT', `/challenges/${id}/response`, { response });

  const rowsOfType = (type: (typeof notifications.$inferSelect)['type']) =>
    app.db.select().from(notifications).where(eq(notifications.type, type));

  const challengeNotifications = () =>
    app.db
      .select()
      .from(notifications)
      .where(sql`${notifications.type}::text like 'challenge\\_%'`);

  const challengeRow = async (id: string) => {
    const [row] = await app.db.select().from(challenges).where(eq(challenges.id, id));
    return row;
  };

  describe('creation', () => {
    it('creates a PENDING challenge with a seven-day default deadline from the injected clock', async () => {
      const dto = await createOk(alice, bob);

      expect(dto).toMatchObject({
        status: 'PENDING',
        createdAt: T0.toISOString(),
        deadlineAt: at(7 * DAY).toISOString(),
        acceptedAt: null,
        resolvedAt: null,
        winner: null,
        gameId: null,
        tournament: { name: 'cup' },
        challenger: { username: 'alice' },
        opponent: { username: 'bob' },
      });
      const detail = await api(bob, 'GET', `/challenges/${dto.id}`);
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toEqual(dto);
    });

    it('accepts deadlines exactly 1 hour and exactly 30 days ahead', async () => {
      const short = await createOk(alice, bob, cup, { deadlineAt: at(HOUR).toISOString() });
      const long = await createOk(alice, carol, cup, { deadlineAt: at(30 * DAY).toISOString() });
      expect(short.deadlineAt).toBe(at(HOUR).toISOString());
      expect(long.deadlineAt).toBe(at(30 * DAY).toISOString());
    });

    it('accepts an explicit offset deadline and stores the same instant', async () => {
      const dto = await createOk(alice, bob, cup, { deadlineAt: '2026-06-03T14:00:00+02:00' });
      expect(dto.deadlineAt).toBe('2026-06-03T12:00:00.000Z');
    });

    it.each([
      ['less than 1 hour ahead', at(HOUR - 1).toISOString(), 'INVALID_DEADLINE'],
      ['more than 30 days ahead', at(30 * DAY + 1).toISOString(), 'INVALID_DEADLINE'],
      ['now', T0.toISOString(), 'INVALID_DEADLINE'],
      ['in the past', at(-DAY).toISOString(), 'INVALID_DEADLINE'],
      ['malformed', 'next tuesday', 'VALIDATION_ERROR'],
      ['a date without time', '2026-06-05', 'VALIDATION_ERROR'],
    ])('rejects a deadline %s without writing anything', async (_label, deadlineAt, code) => {
      const res = await create(alice, {
        tournamentName: 'cup',
        opponentUsername: 'bob',
        deadlineAt,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe(code);
      expect(res.json().error.message).toBeTruthy();
      expect(await app.db.select().from(challenges)).toHaveLength(0);
      expect(await challengeNotifications()).toHaveLength(0);
    });

    it('rejects challenging yourself with SELF_CHALLENGE', async () => {
      const res = await create(alice, { tournamentName: 'cup', opponentUsername: 'alice' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('SELF_CHALLENGE');
      expect(await app.db.select().from(challenges)).toHaveLength(0);
    });

    it('rejects a placeholder opponent with OPPONENT_NOT_REGISTERED', async () => {
      await createPlaceholderUser(app.db, { username: 'guest', createdByUserId: alice.id });
      const res = await create(alice, { tournamentName: 'cup', opponentUsername: 'guest' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('OPPONENT_NOT_REGISTERED');
      expect(await app.db.select().from(challenges)).toHaveLength(0);
      expect(await challengeNotifications()).toHaveLength(0);
    });

    it('does not let a placeholder identity create a challenge', async () => {
      const guest = await createPlaceholderUser(app.db, { createdByUserId: alice.id });
      const res = await create(guest, { tournamentName: 'cup', opponentUsername: 'bob' });
      expect(res.statusCode).toBe(401);
      expect(await app.db.select().from(challenges)).toHaveLength(0);
    });

    it('answers 404 for an unknown opponent or tournament and 400 for unknown fields', async () => {
      const noUser = await create(alice, { tournamentName: 'cup', opponentUsername: 'nobody' });
      expect(noUser.statusCode).toBe(404);
      expect(noUser.json().error.code).toBe('USER_NOT_FOUND');
      const noCup = await create(alice, { tournamentName: 'nope', opponentUsername: 'bob' });
      expect(noCup.statusCode).toBe(404);
      expect(noCup.json().error.code).toBe('TOURNAMENT_NOT_FOUND');
      const extra = await create(alice, {
        tournamentName: 'cup',
        opponentUsername: 'bob',
        message: 'hi',
      });
      expect(extra.statusCode).toBe(400);
      expect(await app.db.select().from(challenges)).toHaveLength(0);
    });

    it('requires authentication', async () => {
      const res = await app.inject({ method: 'POST', url: '/challenges', payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('private tournaments (VAL-CHAL-005)', () => {
    let secret: TournamentRow;
    let groupId: string;

    beforeEach(async () => {
      const group = await createGroup(app.db, {
        ownerId: alice.id,
        name: 'Secret Society',
        members: { [bob.id]: 'MEMBER' },
      });
      groupId = group.id;
      secret = await createTournament(app.db, {
        name: 'secret',
        displayName: 'Secret Cup',
        ownerUserId: alice.id,
        groupId,
      });
    });

    it('allows two current members', async () => {
      const dto = await createOk(bob, alice, secret);
      expect(dto.tournament.name).toBe('secret');
    });

    it('rejects a nonmember opponent without persisting or notifying', async () => {
      const res = await create(alice, { tournamentName: 'secret', opponentUsername: 'carol' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('PLAYER_NOT_GROUP_MEMBER');
      expect(await app.db.select().from(challenges)).toHaveLength(0);
      expect(await challengeNotifications()).toHaveLength(0);
    });

    it('rejects a former member opponent', async () => {
      const removed = await api(alice, 'DELETE', `/groups/${groupId}/members/${bob.id}`);
      expect(removed.statusCode).toBe(204);
      const res = await create(alice, { tournamentName: 'secret', opponentUsername: 'bob' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('PLAYER_NOT_GROUP_MEMBER');
      expect(await app.db.select().from(challenges)).toHaveLength(0);
    });

    it('answers a nonmember caller with a generic 404 that leaks nothing', async () => {
      const res = await create(carol, { tournamentName: 'secret', opponentUsername: 'alice' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('TOURNAMENT_NOT_FOUND');
      expect(res.body).not.toContain('Secret');
      expect(await app.db.select().from(challenges)).toHaveLength(0);
      expect(await challengeNotifications()).toHaveLength(0);
    });
  });

  describe('active-pair uniqueness (VAL-CHAL-006)', () => {
    it('rejects a second active challenge for the pair in either direction', async () => {
      const first = await createOk(alice, bob);
      for (const [caller, opponent] of [
        [alice, bob],
        [bob, alice],
      ] as const) {
        const res = await create(caller, {
          tournamentName: 'cup',
          opponentUsername: opponent.username,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('ACTIVE_CHALLENGE_EXISTS');
      }
      expect(await respond(bob, first.id, 'ACCEPT')).toHaveProperty('statusCode', 200);
      const whileAccepted = await create(bob, { tournamentName: 'cup', opponentUsername: 'alice' });
      expect(whileAccepted.json().error.code).toBe('ACTIVE_CHALLENGE_EXISTS');
      expect(await app.db.select().from(challenges)).toHaveLength(1);
      expect(await rowsOfType('challenge_received')).toHaveLength(1);
    });

    it('allows the same pair in another tournament and other pairs in the same one', async () => {
      await createOk(alice, bob);
      await createOk(bob, alice, other);
      await createOk(alice, carol);
      expect(await app.db.select().from(challenges)).toHaveLength(3);
    });

    it('allows a replacement after a decline or a final result', async () => {
      const first = await createOk(alice, bob);
      expect((await respond(bob, first.id, 'DECLINE')).statusCode).toBe(200);
      const second = await createOk(bob, alice);
      expect(second.status).toBe('PENDING');
      await app.db
        .update(challenges)
        .set({ status: 'EXPIRED', resolvedAt: T0 })
        .where(eq(challenges.id, second.id));
      await createOk(alice, bob);
    });

    it('expires a stale challenge whose deadline passed before the sweep and allows a new one', async () => {
      const stale = await createOk(alice, bob, cup, { deadlineAt: at(HOUR).toISOString() });
      now = at(HOUR);

      const fresh = await createOk(bob, alice);

      expect(fresh.id).not.toBe(stale.id);
      expect(await challengeRow(stale.id)).toMatchObject({
        status: 'EXPIRED',
        resolvedAt: at(HOUR),
        winnerUserId: null,
        gameId: null,
      });
      const expired = await rowsOfType('challenge_expired');
      expect(expired.map((n) => n.recipientUserId).sort()).toEqual([alice.id, bob.id].sort());
      expect(expired.every((n) => n.challengeId === stale.id)).toBe(true);
    });
  });

  describe('responses', () => {
    it('acceptance by the opponent notifies only the challenger', async () => {
      const dto = await createOk(alice, bob);
      now = at(HOUR);

      const res = await respond(bob, dto.id, 'ACCEPT');

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: dto.id,
        status: 'ACCEPTED',
        acceptedAt: at(HOUR).toISOString(),
        resolvedAt: null,
        deadlineAt: dto.deadlineAt,
      });
      const accepted = await rowsOfType('challenge_accepted');
      expect(accepted).toHaveLength(1);
      expect(accepted[0]).toMatchObject({
        recipientUserId: alice.id,
        actorUserId: bob.id,
        challengeId: dto.id,
        category: 'challenges',
      });
    });

    it('decline by the opponent is final and notifies only the challenger', async () => {
      const dto = await createOk(alice, bob);

      const res = await respond(bob, dto.id, 'DECLINE');

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'DECLINED', resolvedAt: T0.toISOString() });
      const declined = await rowsOfType('challenge_declined');
      expect(declined.map((n) => [n.recipientUserId, n.challengeId])).toEqual([[alice.id, dto.id]]);
    });

    it('only the opponent may answer; others change nothing (VAL-CHAL-008)', async () => {
      const dto = await createOk(alice, bob);
      const before = await challengeNotifications();

      const byChallenger = await respond(alice, dto.id, 'ACCEPT');
      expect(byChallenger.statusCode).toBe(403);
      expect(byChallenger.json().error.code).toBe('NOT_CHALLENGE_OPPONENT');
      const byStranger = await respond(carol, dto.id, 'ACCEPT');
      expect(byStranger.statusCode).toBe(404);
      expect(byStranger.json().error.code).toBe('CHALLENGE_NOT_FOUND');
      expect((await api(carol, 'GET', `/challenges/${dto.id}`)).statusCode).toBe(404);

      expect((await challengeRow(dto.id))?.status).toBe('PENDING');
      expect(await challengeNotifications()).toEqual(before);
    });

    it('repeating the same answer returns the unchanged challenge without new events', async () => {
      const accepted = await createOk(alice, bob);
      const first = await respond(bob, accepted.id, 'ACCEPT');
      now = at(2 * HOUR);
      const again = await respond(bob, accepted.id, 'ACCEPT');
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual(first.json());

      const declined = await createOk(alice, carol);
      const firstDecline = await respond(carol, declined.id, 'DECLINE');
      const decline = await respond(carol, declined.id, 'DECLINE');
      expect(decline.statusCode).toBe(200);
      expect(decline.json()).toEqual(firstDecline.json());

      expect(await rowsOfType('challenge_accepted')).toHaveLength(1);
      expect(await rowsOfType('challenge_declined')).toHaveLength(1);
    });

    it('rejects conflicting answers and answers to final challenges (VAL-CHAL-022)', async () => {
      const accepted = await createOk(alice, bob);
      await respond(bob, accepted.id, 'ACCEPT');
      const declined = await createOk(alice, carol);
      await respond(carol, declined.id, 'DECLINE');
      const completed = await createChallengeRow(app.db, {
        tournamentId: other.id,
        challengerUserId: alice.id,
        opponentUserId: bob.id,
        status: 'COMPLETED',
        winnerUserId: bob.id,
        createdAt: at(-DAY),
      });
      const expired = await createChallengeRow(app.db, {
        tournamentId: other.id,
        challengerUserId: carol.id,
        opponentUserId: bob.id,
        status: 'EXPIRED',
        createdAt: at(-DAY),
      });
      const snapshot = async () => app.db.select().from(challenges).orderBy(challenges.id);
      const before = await snapshot();
      const eventsBefore = (await challengeNotifications()).length;

      const cases = [
        [bob, accepted.id, 'DECLINE', 'CHALLENGE_NOT_PENDING'],
        [carol, declined.id, 'ACCEPT', 'CHALLENGE_NOT_PENDING'],
        [bob, completed.id, 'ACCEPT', 'CHALLENGE_NOT_PENDING'],
        [bob, completed.id, 'DECLINE', 'CHALLENGE_NOT_PENDING'],
        [bob, expired.id, 'ACCEPT', 'CHALLENGE_EXPIRED'],
        [bob, expired.id, 'DECLINE', 'CHALLENGE_EXPIRED'],
      ] as const;
      for (const [caller, id, response, code] of cases) {
        const res = await respond(caller, id, response);
        expect(res.statusCode, `${response} ${id}`).toBe(400);
        expect(res.json().error.code).toBe(code);
      }
      expect(await snapshot()).toEqual(before);
      expect(await challengeNotifications()).toHaveLength(eventsBefore);
    });

    it('expires a challenge answered at its deadline and reports CHALLENGE_EXPIRED', async () => {
      const dto = await createOk(alice, bob, cup, { deadlineAt: at(HOUR).toISOString() });
      now = at(HOUR);

      const res = await respond(bob, dto.id, 'ACCEPT');

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('CHALLENGE_EXPIRED');
      expect(await challengeRow(dto.id)).toMatchObject({
        status: 'EXPIRED',
        acceptedAt: null,
        resolvedAt: at(HOUR),
      });
      expect(await rowsOfType('challenge_accepted')).toHaveLength(0);
      const expired = await rowsOfType('challenge_expired');
      expect(expired.map((n) => n.recipientUserId).sort()).toEqual([alice.id, bob.id].sort());

      const retry = await respond(bob, dto.id, 'ACCEPT');
      expect(retry.json().error.code).toBe('CHALLENGE_EXPIRED');
      expect(await rowsOfType('challenge_expired')).toHaveLength(2);
    });

    it('accepts one millisecond before the deadline', async () => {
      const dto = await createOk(alice, bob, cup, { deadlineAt: at(HOUR).toISOString() });
      now = at(HOUR - 1);
      const res = await respond(bob, dto.id, 'ACCEPT');
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ACCEPTED');
    });

    it('answers 404 for unknown ids and 400 for malformed ones', async () => {
      const unknown = await respond(bob, '00000000-0000-4000-8000-000000000000', 'ACCEPT');
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().error.code).toBe('CHALLENGE_NOT_FOUND');
      expect((await api(bob, 'GET', '/challenges/not-a-uuid')).statusCode).toBe(400);
      const dto = await createOk(alice, bob);
      const bad = await api(bob, 'PUT', `/challenges/${dto.id}/response`, { response: 'MAYBE' });
      expect(bad.statusCode).toBe(400);
    });
  });

  describe('notification fan-out (VAL-CHAL-007)', () => {
    const challengeTargets = () =>
      collector
        .messages()
        .filter((m) => (m.data as { target?: { type?: string } }).target?.type === 'challenge');

    beforeEach(async () => {
      await createPushDevice(app.db, { userId: alice.id, expoToken: expoTokenOf('alice') });
      await createPushDevice(app.db, { userId: bob.id, expoToken: expoTokenOf('bob') });
      await createPushDevice(app.db, {
        userId: bob.id,
        expoToken: expoTokenOf('bob-old'),
        disabledAt: at(-DAY),
      });
      await createPushDevice(app.db, { userId: carol.id, expoToken: expoTokenOf('carol') });
    });

    it('pushes received to the opponent and accepted to the challenger, after commit', async () => {
      const dto = await createOk(alice, bob);
      await app.push.drain();
      expect(challengeTargets()).toEqual([
        expect.objectContaining({
          to: expoTokenOf('bob'),
          title: 'New challenge',
          body: expect.stringMatching(/^Alice .* challenged you in Cup\.$/),
          data: {
            notificationId: expect.any(String),
            target: { type: 'challenge', challengeId: dto.id },
          },
        }),
      ]);

      collector.reset();
      await respond(bob, dto.id, 'ACCEPT');
      await app.push.drain();
      expect(challengeTargets()).toEqual([
        expect.objectContaining({
          to: expoTokenOf('alice'),
          title: 'Challenge accepted',
          data: expect.objectContaining({
            target: { type: 'challenge', challengeId: dto.id },
          }),
        }),
      ]);
    });

    it('pushes declined to the challenger only', async () => {
      const dto = await createOk(alice, bob);
      await app.push.drain();
      collector.reset();
      await respond(bob, dto.id, 'DECLINE');
      await app.push.drain();
      expect(challengeTargets().map((m) => [m.to, m.title])).toEqual([
        [expoTokenOf('alice'), 'Challenge declined'],
      ]);
    });

    it('keeps the inbox row but sends no push when the recipient disabled challenge pushes', async () => {
      const prefs = await api(bob, 'PUT', '/users/me/notification-preferences', {
        challenges: false,
      });
      expect(prefs.statusCode).toBe(200);

      const dto = await createOk(alice, bob);
      await app.push.drain();

      expect(challengeTargets()).toHaveLength(0);
      const inbox = await api(bob, 'GET', '/notifications');
      expect(inbox.json()).toEqual([
        expect.objectContaining({
          type: 'challenge_received',
          title: 'New challenge',
          body: expect.stringMatching(/^Alice .* challenged you in Cup\.$/),
          target: { type: 'challenge', challengeId: dto.id },
        }),
      ]);
    });

    it('sends nothing when the creation rolls back at commit', async () => {
      await app.db.execute(
        sql.raw(`create function test_fail_at_commit() returns trigger language plpgsql as $$
          begin raise exception 'injected failure at commit'; end $$`),
      );
      await app.db.execute(
        sql.raw(`create constraint trigger test_fail_at_commit after insert on challenges
          deferrable initially deferred for each row execute function test_fail_at_commit()`),
      );
      try {
        const res = await create(alice, { tournamentName: 'cup', opponentUsername: 'bob' });
        await app.push.drain();
        expect(res.statusCode).toBe(500);
        expect(await app.db.select().from(challenges)).toHaveLength(0);
        expect(await challengeNotifications()).toHaveLength(0);
        expect(collector.received).toHaveLength(0);
      } finally {
        await app.db.execute(sql`drop trigger if exists test_fail_at_commit on challenges`);
        await app.db.execute(sql`drop function if exists test_fail_at_commit()`);
      }
    });
  });

  describe('reads (VAL-CHAL-023)', () => {
    it('lists only the viewer’s challenges, newest first, with a status filter', async () => {
      const a = await createOk(alice, bob);
      now = at(1000);
      const b = await createOk(carol, alice);
      now = at(2000);
      const c = await createOk(bob, carol);
      await respond(alice, b.id, 'ACCEPT');

      const list = await api(alice, 'GET', '/challenges');
      expect(list.statusCode).toBe(200);
      expect(list.json<ChallengeDto[]>().map((x) => x.id)).toEqual([b.id, a.id]);
      const pending = await api(alice, 'GET', '/challenges?status=PENDING');
      expect(pending.json<ChallengeDto[]>().map((x) => x.id)).toEqual([a.id]);
      const both = await api(alice, 'GET', '/challenges?status=PENDING,ACCEPTED');
      expect(both.json<ChallengeDto[]>()).toHaveLength(2);
      const none = await api(alice, 'GET', '/challenges?status=DECLINED');
      expect(none.json()).toEqual([]);
      expect((await api(alice, 'GET', '/challenges?status=OPEN')).statusCode).toBe(400);

      expect((await api(alice, 'GET', `/challenges/${c.id}`)).statusCode).toBe(404);
      expect((await api(carol, 'GET', `/challenges/${c.id}`)).statusCode).toBe(200);
    });

    describe('after losing access to a private group', () => {
      let groupId: string;
      let ids: { id: string; private: boolean }[];

      beforeEach(async () => {
        const group = await createGroup(app.db, {
          ownerId: alice.id,
          name: 'Secret Society',
          members: { [bob.id]: 'MEMBER' },
        });
        groupId = group.id;
        const secret = await createTournament(app.db, {
          name: 'secret',
          displayName: 'Secret Cup',
          ownerUserId: alice.id,
          groupId,
        });
        const secret2 = await createTournament(app.db, {
          name: 'secret2',
          displayName: 'Secret Two',
          ownerUserId: alice.id,
          groupId,
        });
        const extra = await createTournament(app.db, { name: 'extra', displayName: 'Extra' });
        ids = [];
        // Private and open challenges alternate so private rows sit between open ones.
        const plan: [TournamentRow, boolean][] = [
          [cup, false],
          [secret, true],
          [other, false],
          [secret2, true],
          [extra, false],
        ];
        for (const [i, [tournament, isPrivate]] of plan.entries()) {
          now = at(i * 1000);
          const dto = await createOk(alice, bob, tournament);
          ids.push({ id: dto.id, private: isPrivate });
        }
      });

      const openIds = () =>
        ids
          .filter((c) => !c.private)
          .map((c) => c.id)
          .reverse();

      it('hides private challenges, their detail and inbox rows; rejoining restores them', async () => {
        const privateId = ids[1]!.id;
        expect((await api(bob, 'GET', '/challenges')).json()).toHaveLength(5);
        const unreadBefore = (await api(bob, 'GET', '/notifications/unread-count')).json();
        expect(unreadBefore.count).toBe(5);

        const removed = await api(alice, 'DELETE', `/groups/${groupId}/members/${bob.id}`);
        expect(removed.statusCode).toBe(204);

        const list = await api(bob, 'GET', '/challenges');
        expect(list.json<ChallengeDto[]>().map((c) => c.id)).toEqual(openIds());
        const detail = await api(bob, 'GET', `/challenges/${privateId}`);
        expect(detail.statusCode).toBe(404);
        expect(detail.body).not.toContain('Secret');
        const answer = await respond(bob, privateId, 'ACCEPT');
        expect(answer.statusCode).toBe(404);
        expect((await challengeRow(privateId))?.status).toBe('PENDING');
        const inbox = await api(bob, 'GET', '/notifications');
        expect(inbox.body).not.toContain('Secret');
        expect(inbox.json()).toHaveLength(3);
        expect((await api(bob, 'GET', '/notifications/unread-count')).json().count).toBe(3);
        expect((await api(alice, 'GET', '/challenges')).json()).toHaveLength(5);

        await addGroupMember(app.db, groupId, bob.id);
        expect((await api(bob, 'GET', '/challenges')).json()).toHaveLength(5);
        expect((await api(bob, 'GET', `/challenges/${privateId}`)).statusCode).toBe(200);
      });

      it('pages over visible rows only, without holes', async () => {
        await api(alice, 'DELETE', `/groups/${groupId}/members/${bob.id}`);
        const pages: string[][] = [];
        for (let page = 0; page < 3; page += 1) {
          const res = await api(bob, 'GET', `/challenges?page=${page}&pageSize=1`);
          pages.push(res.json<ChallengeDto[]>().map((c) => c.id));
        }
        expect(pages).toEqual(openIds().map((id) => [id]));
        const past = await api(bob, 'GET', '/challenges?page=3&pageSize=1');
        expect(past.json()).toEqual([]);
        const two = await api(bob, 'GET', '/challenges?page=1&pageSize=2');
        expect(two.json<ChallengeDto[]>().map((c) => c.id)).toEqual(openIds().slice(2));
      });

      it('never shows a stranger any of the pair’s challenges', async () => {
        expect((await api(carol, 'GET', '/challenges')).json()).toEqual([]);
        for (const { id } of ids) {
          expect((await api(carol, 'GET', `/challenges/${id}`)).statusCode).toBe(404);
        }
      });
    });
  });

  it('removes the legacy push-only challenge route', async () => {
    const res = await api(alice, 'POST', '/users/bob/challenge', {});
    expect(res.statusCode).toBe(404);
    expect(collector.received).toHaveLength(0);
    expect(
      await app.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.recipientUserId, bob.id))),
    ).toHaveLength(0);
  });
});
