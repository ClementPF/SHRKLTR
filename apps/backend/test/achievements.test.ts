import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACHIEVEMENT_CODES } from '../src/achievements/catalog.js';
import { games, notifications, outcomes, stats, userAchievements } from '../src/db/schema.js';
import { awardAchievements } from '../src/services/achievement.service.js';
import {
  achievementCodesOf,
  authHeadersFor,
  buildTestApp,
  createPlaceholderUser,
  createPushDevice,
  createStatsRow,
  createTournament,
  createUser,
  expoTokenOf,
  playHistory,
  truncateAll,
} from './helpers.js';
import { startPushCollector, type PushCollector } from './push-collector.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;
type TournamentRow = Awaited<ReturnType<typeof createTournament>>;

describe('game achievements', () => {
  let app: FastifyInstance;
  let collector: PushCollector;

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
  });

  async function play(
    tournament: TournamentRow,
    winners: UserRow[],
    losers: UserRow[],
    caller: UserRow = losers[0]!,
  ) {
    const res = await app.inject({
      method: 'POST',
      url: `/tournaments/${tournament.name}/games`,
      headers: await authHeadersFor(app, caller.id),
      payload: {
        outcomes: [
          ...winners.map((u) => ({ username: u.username, result: 'WIN' })),
          ...losers.map((u) => ({ username: u.username, result: 'LOSS' })),
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { id: string };
  }

  const codes = (user: { id: string }) => achievementCodesOf(app.db, user.id);

  const unlockNotifications = (user: { id: string }) =>
    app.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, user.id),
          eq(notifications.type, 'achievement_unlocked'),
        ),
      );

  describe('first_win (VAL-ACH-001)', () => {
    it('unlocks for the winner of a first game, not for the loser', async () => {
      const t = await createTournament(app.db);
      const alice = await createUser(app.db);
      const bob = await createUser(app.db);

      const game = await play(t, [bob], [alice]);

      expect(await codes(bob)).toEqual(['first_win']);
      expect(await codes(alice)).toEqual([]);
      const [row] = await app.db
        .select()
        .from(userAchievements)
        .where(eq(userAchievements.userId, bob.id));
      expect(row).toMatchObject({ sourceType: 'GAME', sourceGameId: game.id });
    });

    it('a loss alone never unlocks it', async () => {
      const t = await createTournament(app.db);
      const alice = await createUser(app.db);
      const bob = await createUser(app.db);
      await play(t, [bob], [alice]);
      await play(t, [bob], [alice]);
      expect(await codes(alice)).toEqual([]);
    });

    it('every winning teammate, placeholders included, earns it; losing teammates do not', async () => {
      const t = await createTournament(app.db);
      const [alice, bob, carol] = [
        await createUser(app.db),
        await createUser(app.db),
        await createUser(app.db),
      ];
      const guest = await createPlaceholderUser(app.db, { createdByUserId: alice.id });

      await play(t, [carol, guest], [alice, bob]);

      expect(await codes(carol)).toEqual(['first_win']);
      expect(await codes(guest)).toEqual(['first_win']);
      expect(await codes(alice)).toEqual([]);
      expect(await codes(bob)).toEqual([]);
      expect(await unlockNotifications(guest)).toHaveLength(1);
    });
  });

  describe('win streaks (VAL-ACH-002)', () => {
    it('unlocks win_streak_3/5/10 exactly when the current streak reaches 3, 5 and 10', async () => {
      const t = await createTournament(app.db);
      const loser = await createUser(app.db);
      const winner = await createUser(app.db);
      const streakCodes = async () =>
        (await codes(winner)).filter((c) => c.startsWith('win_streak_'));

      const expected: Record<number, string[]> = {
        2: [],
        3: ['win_streak_3'],
        4: ['win_streak_3'],
        5: ['win_streak_3', 'win_streak_5'],
        9: ['win_streak_3', 'win_streak_5'],
        10: ['win_streak_10', 'win_streak_3', 'win_streak_5'],
      };
      for (let wins = 1; wins <= 10; wins++) {
        await play(t, [winner], [loser]);
        if (expected[wins])
          expect(await streakCodes(), `after ${wins} wins`).toEqual(expected[wins]);
      }
    });

    it('a loss resets the current run', async () => {
      const t = await createTournament(app.db);
      const alice = await createUser(app.db);
      const bob = await createUser(app.db);
      await play(t, [bob], [alice]);
      await play(t, [bob], [alice]);
      await play(t, [alice], [bob]);
      await play(t, [bob], [alice]);
      await play(t, [bob], [alice]);
      expect(await codes(bob)).toEqual(['first_win']);

      await play(t, [bob], [alice]);
      expect(await codes(bob)).toEqual(['first_win', 'win_streak_3']);
    });

    it('uses the current streak, never the historical longest streak', async () => {
      const t = await createTournament(app.db);
      const alice = await createUser(app.db);
      const bob = await createUser(app.db);
      await createStatsRow(app.db, {
        userId: bob.id,
        tournamentId: t.id,
        winStreak: 0,
        loseStreak: 1,
        longuestWinStreak: 12,
      });

      await play(t, [bob], [alice]);
      expect(await codes(bob)).toEqual(['first_win']);
    });

    it('a run that jumps past several thresholds awards each crossed one', async () => {
      const t = await createTournament(app.db);
      const alice = await createUser(app.db);
      const bob = await createUser(app.db);
      await createStatsRow(app.db, {
        userId: bob.id,
        tournamentId: t.id,
        winStreak: 9,
        longuestWinStreak: 9,
      });

      await play(t, [bob], [alice]);
      expect(await codes(bob)).toEqual([
        'first_win',
        'win_streak_10',
        'win_streak_3',
        'win_streak_5',
      ]);
      expect(await unlockNotifications(bob)).toHaveLength(4);
    });
  });

  describe('tournament-local streaks (VAL-ACH-003)', () => {
    it('two wins in A plus one in B do not make a streak of 3; a third win in A does', async () => {
      const a = await createTournament(app.db);
      const b = await createTournament(app.db);
      const alice = await createUser(app.db);
      const bob = await createUser(app.db);

      await play(a, [bob], [alice]);
      await play(a, [bob], [alice]);
      await play(b, [bob], [alice]);
      expect(await codes(bob)).toEqual(['first_win']);

      // A loss in B neither breaks nor extends A's run.
      await play(b, [alice], [bob], bob);
      await play(a, [bob], [alice]);
      expect(await codes(bob)).toEqual(['first_win', 'win_streak_3']);
    });

    it('interleaved tournaments cannot combine runs to reach 5 or 10', async () => {
      const a = await createTournament(app.db);
      const b = await createTournament(app.db);
      const alice = await createUser(app.db);
      const bob = await createUser(app.db);

      for (let i = 0; i < 4; i++) {
        await play(a, [bob], [alice]);
        await play(b, [bob], [alice]);
      }
      expect(await codes(bob)).toEqual(['first_win', 'win_streak_3']);

      await play(a, [bob], [alice]);
      expect(await codes(bob)).toEqual(['first_win', 'win_streak_3', 'win_streak_5']);
    });
  });

  describe('distinct games played (VAL-ACH-004)', () => {
    async function gamesThresholdCase(threshold: number, code: string) {
      const a = await createTournament(app.db);
      const b = await createTournament(app.db);
      const me = await createUser(app.db);
      const rival = await createUser(app.db);
      // Wins and losses, split across two tournaments.
      const before = threshold - 2;
      const half = Math.floor(before / 2);
      await playHistory(app.db, {
        tournamentId: a.id,
        userId: me.id,
        opponentId: rival.id,
        results: Array.from({ length: half }, (_, i) => (i % 2 === 0 ? 'WIN' : 'LOSS')),
      });
      await playHistory(app.db, {
        tournamentId: b.id,
        userId: me.id,
        opponentId: rival.id,
        results: Array.from({ length: before - half }, () => 'LOSS'),
      });

      await play(a, [rival], [me]);
      expect(await codes(me), `after ${threshold - 1} games`).not.toContain(code);
      await play(b, [rival], [me]);
      expect(await codes(me), `after ${threshold} games`).toContain(code);
    }

    it('games_10 is locked at 9 games and unlocks at 10', () => gamesThresholdCase(10, 'games_10'));
    it('games_50 is locked at 49 games and unlocks at 50', () =>
      gamesThresholdCase(50, 'games_50'));
    it('games_100 is locked at 99 games and unlocks at 100', () =>
      gamesThresholdCase(100, 'games_100'));

    it('a team game with several opponents counts as one game', async () => {
      const t = await createTournament(app.db);
      const [me, mate, x, y] = [
        await createUser(app.db),
        await createUser(app.db),
        await createUser(app.db),
        await createUser(app.db),
      ];
      await playHistory(app.db, {
        tournamentId: t.id,
        userId: me.id,
        opponentId: x.id,
        results: Array.from({ length: 8 }, () => 'LOSS'),
      });

      await play(t, [x, y], [me, mate]);
      expect(await codes(me)).not.toContain('games_10');
      await play(t, [x, y], [me, mate]);
      expect(await codes(me)).toContain('games_10');
      expect(await codes(mate)).not.toContain('games_10');
    });
  });

  describe('giant killer (VAL-ACH-005)', () => {
    async function teamGame(loserRatings: [number, number]) {
      const t = await createTournament(app.db);
      const [w1, w2, l1, l2] = [
        await createUser(app.db),
        await createUser(app.db),
        await createUser(app.db),
        await createUser(app.db),
      ];
      const ratings: [UserRow, number][] = [
        [w1, 900],
        [w2, 1000],
        [l1, loserRatings[0]],
        [l2, loserRatings[1]],
      ];
      for (const [user, score] of ratings) {
        await createStatsRow(app.db, {
          userId: user.id,
          tournamentId: t.id,
          score,
          bestScore: score,
          worstScore: score,
        });
      }
      const game = await play(t, [w1, w2], [l1, l2]);
      const saved = await app.db.select().from(outcomes).where(eq(outcomes.gameId, game.id));
      const before = new Map(saved.map((o) => [o.userId, o.ratingBefore]));
      expect(before.get(w1.id)).toBe(900);
      expect(before.get(l2.id)).toBe(loserRatings[1]);
      return { w1, w2, l1, l2 };
    }

    it('a 199 team-average gap does not unlock, even with a 298 individual gap', async () => {
      // Winners average 950, losers average 1149.
      const { w1, w2 } = await teamGame([1100, 1198]);
      expect(await codes(w1)).not.toContain('giant_killer');
      expect(await codes(w2)).not.toContain('giant_killer');
    });

    it('a 199.99 team-average gap does not unlock', async () => {
      const { w1, w2 } = await teamGame([1100, 1199.98]);
      expect(await codes(w1)).not.toContain('giant_killer');
      expect(await codes(w2)).not.toContain('giant_killer');
    });

    it('a 200 team-average gap unlocks for every winner, never for losers', async () => {
      const { w1, w2, l1, l2 } = await teamGame([1100, 1200]);
      expect(await codes(w1)).toContain('giant_killer');
      expect(await codes(w2)).toContain('giant_killer');
      expect(await codes(l1)).not.toContain('giant_killer');
      expect(await codes(l2)).not.toContain('giant_killer');
    });

    it('uses pre-game ratings: the post-game gap of a 200 upset is below 200', async () => {
      const t = await createTournament(app.db);
      const underdog = await createUser(app.db);
      const favourite = await createUser(app.db);
      await createStatsRow(app.db, { userId: underdog.id, tournamentId: t.id, score: 1000 });
      await createStatsRow(app.db, { userId: favourite.id, tournamentId: t.id, score: 1200 });

      await play(t, [underdog], [favourite]);

      const rows = await app.db.select().from(stats);
      const after = new Map(rows.map((r) => [r.userId, r.score]));
      expect(after.get(favourite.id)! - after.get(underdog.id)!).toBeLessThan(200);
      expect(await codes(underdog)).toContain('giant_killer');
    });
  });

  describe('explorer (VAL-ACH-006)', () => {
    it('counts distinct sports, losses included, ignoring repeat sports', async () => {
      const me = await createUser(app.db);
      const rival = await createUser(app.db);
      const sportTournaments = [];
      for (let i = 0; i < 5; i++) sportTournaments.push(await createTournament(app.db));
      const [s1, s2, s3, s4, s5] = sportTournaments as [
        TournamentRow,
        TournamentRow,
        TournamentRow,
        TournamentRow,
        TournamentRow,
      ];
      const s2Again = await createTournament(app.db, { sportId: s2.sportId });
      const explorer = async () => (await codes(me)).filter((c) => c.startsWith('explorer_'));

      await play(s1, [rival], [me]);
      await play(s2, [rival], [me]);
      await play(s2Again, [rival], [me]);
      await play(s1, [rival], [me]);
      expect(await explorer()).toEqual([]);

      await play(s3, [rival], [me]);
      expect(await explorer()).toEqual(['explorer_3']);

      await play(s4, [rival], [me]);
      await play(s2Again, [rival], [me]);
      expect(await explorer()).toEqual(['explorer_3']);

      await play(s5, [rival], [me]);
      expect(await explorer()).toEqual(['explorer_3', 'explorer_5']);
    });
  });

  describe('insert-once unlocks and notifications (VAL-ACH-008)', () => {
    it('repeated qualification keeps one row, one notification and the first unlock date', async () => {
      const t = await createTournament(app.db);
      const loser = await createUser(app.db);
      const winner = await createUser(app.db, { username: 'winner' });
      await createPushDevice(app.db, { userId: winner.id, expoToken: expoTokenOf('winner') });

      await play(t, [winner], [loser]);
      const [first] = await app.db
        .select()
        .from(userAchievements)
        .where(eq(userAchievements.userId, winner.id));

      for (let i = 0; i < 11; i++) await play(t, [winner], [loser]);
      await app.push.drain();

      const rows = await app.db
        .select()
        .from(userAchievements)
        .where(eq(userAchievements.userId, winner.id));
      expect(rows.map((r) => r.achievementCode).sort()).toEqual([
        'first_win',
        'games_10',
        'win_streak_10',
        'win_streak_3',
        'win_streak_5',
      ]);
      expect(rows.find((r) => r.achievementCode === 'first_win')?.unlockedAt).toEqual(
        first!.unlockedAt,
      );

      const unlocks = await unlockNotifications(winner);
      expect(unlocks.map((n) => n.achievementCode).sort()).toEqual(
        rows.map((r) => r.achievementCode).sort(),
      );
      for (const n of unlocks) {
        expect(n).toMatchObject({
          category: 'achievements',
          dedupeKey: `achievement_unlocked:${n.achievementCode}`,
        });
      }
      // The loser also played 12 games, but never won.
      expect((await unlockNotifications(loser)).map((n) => n.achievementCode)).toEqual([
        'games_10',
      ]);

      const inbox = await app.inject({
        method: 'GET',
        url: '/notifications?pageSize=100',
        headers: await authHeadersFor(app, winner.id),
      });
      const badgeRows = inbox
        .json()
        .filter((n: { type: string }) => n.type === 'achievement_unlocked');
      expect(badgeRows).toHaveLength(5);
      expect(badgeRows).toContainEqual(
        expect.objectContaining({
          category: 'achievements',
          title: 'Achievement unlocked: Hat trick',
          body: 'Win 3 games in a row in one tournament.',
          target: { type: 'achievements', username: 'winner' },
        }),
      );

      const pushed = collector
        .messages()
        .filter((m) => (m.data as { target?: { type?: string } }).target?.type === 'achievements');
      expect(pushed).toHaveLength(5);
      expect(pushed.map((m) => m.to)).toEqual(Array(5).fill(expoTokenOf('winner')));
      expect(pushed[0]!.data).toEqual({
        notificationId: expect.any(String),
        target: { type: 'achievements', username: 'winner' },
      });
    });

    it('giant_killer and explorer badges are not re-awarded by a later qualifying game', async () => {
      const t = await createTournament(app.db);
      const underdog = await createUser(app.db);
      const favourite = await createUser(app.db);
      await createStatsRow(app.db, { userId: underdog.id, tournamentId: t.id, score: 600 });
      await createStatsRow(app.db, { userId: favourite.id, tournamentId: t.id, score: 1400 });
      await play(t, [underdog], [favourite]);
      await play(t, [underdog], [favourite]);
      const rows = await app.db
        .select()
        .from(userAchievements)
        .where(
          and(
            eq(userAchievements.userId, underdog.id),
            eq(userAchievements.achievementCode, 'giant_killer'),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(
        (await unlockNotifications(underdog)).filter((n) => n.achievementCode === 'giant_killer'),
      ).toHaveLength(1);
    });

    it('concurrent qualifying games cannot duplicate a badge or its notification', async () => {
      const first = await createTournament(app.db);
      const tournaments = [first];
      for (let i = 0; i < 3; i++) {
        tournaments.push(await createTournament(app.db, { sportId: first.sportId }));
      }
      const winner = await createUser(app.db);
      const losers: Awaited<ReturnType<typeof createUser>>[] = [];
      for (let i = 0; i < 4; i++) losers.push(await createUser(app.db));
      // 9 earlier games: every concurrent game below would be the 10th on its own.
      await playHistory(app.db, {
        tournamentId: tournaments[0]!.id,
        userId: winner.id,
        opponentId: losers[0]!.id,
        results: Array.from({ length: 9 }, () => 'LOSS'),
      });

      await Promise.all(tournaments.map((t, i) => play(t, [winner], [losers[i]!])));

      expect(await codes(winner)).toEqual(['first_win', 'games_10']);
      const unlocks = await unlockNotifications(winner);
      expect(unlocks.map((n) => n.achievementCode).sort()).toEqual(['first_win', 'games_10']);
    });

    it('concurrent games that only reach a threshold together still unlock it', async () => {
      const first = await createTournament(app.db);
      const second = await createTournament(app.db, { sportId: first.sportId });
      const winner = await createUser(app.db);
      const [l1, l2] = [await createUser(app.db), await createUser(app.db)];
      await playHistory(app.db, {
        tournamentId: first.id,
        userId: winner.id,
        opponentId: l1.id,
        results: Array.from({ length: 8 }, () => 'LOSS'),
      });

      await Promise.all([play(first, [winner], [l1]), play(second, [winner], [l2])]);

      expect(await codes(winner)).toEqual(['first_win', 'games_10']);
    });

    it('concurrent awards of the same badge insert one row and one notification', async () => {
      const user = await createUser(app.db);
      const award = () =>
        app.db.transaction((tx) =>
          awardAchievements(tx, [{ userId: user.id, code: 'giant_killer', sourceType: 'GAME' }]),
        );
      const results = await Promise.all([award(), award(), award()]);

      expect(results.map((r) => r.notificationIds.length).sort()).toEqual([0, 0, 1]);
      expect(await codes(user)).toEqual(['giant_killer']);
      expect(await unlockNotifications(user)).toHaveLength(1);
    });
  });

  describe('transaction', () => {
    afterEach(async () => {
      await app.db.execute(sql`drop trigger if exists test_fail_at_commit on user_achievements`);
      await app.db.execute(sql`drop function if exists test_fail_at_commit()`);
    });

    it('a failure at commit rolls back the game, badges and inbox rows together', async () => {
      const t = await createTournament(app.db);
      const alice = await createUser(app.db);
      const bob = await createUser(app.db);
      await app.db.execute(
        sql.raw(`create function test_fail_at_commit() returns trigger language plpgsql as $$
          begin raise exception 'injected failure at commit'; end $$`),
      );
      await app.db.execute(
        sql.raw(`create constraint trigger test_fail_at_commit after insert on user_achievements
          deferrable initially deferred for each row execute function test_fail_at_commit()`),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/tournaments/${t.name}/games`,
        headers: await authHeadersFor(app, alice.id),
        payload: {
          outcomes: [
            { username: bob.username, result: 'WIN' },
            { username: alice.username, result: 'LOSS' },
          ],
        },
      });
      await app.push.drain();

      expect(res.statusCode).toBe(500);
      expect(await app.db.select().from(games)).toHaveLength(0);
      expect(await app.db.select().from(userAchievements)).toHaveLength(0);
      expect(await app.db.select().from(notifications)).toHaveLength(0);
      expect(collector.received).toHaveLength(0);
    });
  });
});

describe('achievements API', () => {
  let app: FastifyInstance;
  let alice: UserRow;
  let bob: UserRow;
  let t: TournamentRow;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    t = await createTournament(app.db);
    alice = await createUser(app.db, { username: 'alice' });
    bob = await createUser(app.db, { username: 'bob' });
  });

  const get = async (url: string, viewer: UserRow = alice) =>
    app.inject({ method: 'GET', url, headers: await authHeadersFor(app, viewer.id) });

  const win = async (winner: UserRow, loser: UserRow) => {
    const res = await app.inject({
      method: 'POST',
      url: `/tournaments/${t.name}/games`,
      headers: await authHeadersFor(app, loser.id),
      payload: {
        outcomes: [
          { username: winner.username, result: 'WIN' },
          { username: loser.username, result: 'LOSS' },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  };

  it('GET /achievements lists the whole catalog in order', async () => {
    const res = await get('/achievements');
    expect(res.statusCode).toBe(200);
    expect(res.json().map((a: { code: string }) => a.code)).toEqual([...ACHIEVEMENT_CODES]);
    expect(res.json()[0]).toEqual({
      code: 'first_win',
      title: 'First win',
      description: 'Win a game.',
    });
  });

  it('requires authentication', async () => {
    for (const url of ['/achievements', '/achievements/recent', '/users/alice/achievements']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    }
  });

  it('GET /users/:username/achievements returns locked and unlocked entries with dates', async () => {
    const game = await win(bob, alice);
    const [row] = await app.db
      .select()
      .from(userAchievements)
      .where(eq(userAchievements.userId, bob.id));

    const res = await get('/users/bob/achievements');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { code: string; unlocked: boolean }[];
    expect(body.map((a) => a.code)).toEqual([...ACHIEVEMENT_CODES]);
    expect(body[0]).toEqual({
      code: 'first_win',
      title: 'First win',
      description: 'Win a game.',
      unlocked: true,
      unlockedAt: row!.unlockedAt.toISOString(),
      source: { type: 'GAME', gameId: game.id, groupId: null },
    });
    for (const entry of body.slice(1)) {
      expect(entry).toMatchObject({ unlocked: false, unlockedAt: null, source: null });
    }

    const own = await get('/users/alice/achievements');
    expect(own.json().every((a: { unlocked: boolean }) => !a.unlocked)).toBe(true);
  });

  it('a deleted source game leaves the badge with a null source link', async () => {
    const game = await win(bob, alice);
    await app.db.delete(games).where(eq(games.id, game.id));
    const res = await get('/users/bob/achievements');
    expect(res.json()[0]).toMatchObject({
      code: 'first_win',
      unlocked: true,
      source: { type: 'GAME', gameId: null },
    });
  });

  it('works for placeholders and answers 404 USER_NOT_FOUND for unknown users', async () => {
    const guest = await createPlaceholderUser(app.db, { username: 'guest' });
    await win(guest, alice);
    const res = await get('/users/guest/achievements');
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ code: 'first_win', unlocked: true });

    const missing = await get('/users/nobody/achievements');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('USER_NOT_FOUND');
  });

  it('GET /achievements/recent lists only the viewer’s own unlocks, newest first', async () => {
    await app.db.insert(userAchievements).values([
      {
        userId: alice.id,
        achievementCode: 'games_10',
        sourceType: 'BACKFILL',
        unlockedAt: new Date('2026-10-01T00:00:00Z'),
      },
      {
        userId: alice.id,
        achievementCode: 'first_win',
        sourceType: 'BACKFILL',
        unlockedAt: new Date('2026-10-03T00:00:00Z'),
      },
      {
        userId: alice.id,
        achievementCode: 'explorer_3',
        sourceType: 'BACKFILL',
        unlockedAt: new Date('2026-10-02T00:00:00Z'),
      },
      {
        userId: bob.id,
        achievementCode: 'first_win',
        sourceType: 'BACKFILL',
        unlockedAt: new Date('2026-10-04T00:00:00Z'),
      },
    ]);

    const res = await get('/achievements/recent');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        user: expect.objectContaining({ username: 'alice' }),
        achievement: { code: 'first_win', title: 'First win', description: 'Win a game.' },
        unlockedAt: '2026-10-03T00:00:00.000Z',
        source: { type: 'BACKFILL', gameId: null, groupId: null },
      },
      expect.objectContaining({ achievement: expect.objectContaining({ code: 'explorer_3' }) }),
      expect.objectContaining({ achievement: expect.objectContaining({ code: 'games_10' }) }),
    ]);

    const paged = await get('/achievements/recent?pageSize=1&page=1');
    expect(paged.json().map((u: { achievement: { code: string } }) => u.achievement.code)).toEqual([
      'explorer_3',
    ]);
    const invalid = await get('/achievements/recent?pageSize=0');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');
  });
});
