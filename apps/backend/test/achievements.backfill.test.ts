import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { outcomes, userAchievements, users } from '../src/db/schema.js';
import {
  BACKFILL_CODES,
  parseBackfillArgs,
  runAchievementsBackfill,
  type BackfillCode,
} from '../src/scripts/achievements-backfill.js';
import {
  achievementCodesOf,
  authHeadersFor,
  buildTestApp,
  createClaim,
  createPushDevice,
  createStatsRow,
  createTournament,
  createUser,
  playHistory,
  truncateAll,
} from './helpers.js';
import { startPushCollector, type PushCollector } from './push-collector.js';
import { TEST_DATABASE_URL } from './test-env.js';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-11-05T12:00:00.000Z');
const at = (iso: string) => new Date(iso);

const HISTORY_TABLES = [
  'users',
  'games',
  'outcomes',
  'stats',
  'rivalry_stats',
  'notifications',
  'player_claims',
] as const;

type UserRow = Awaited<ReturnType<typeof createUser>>;

describe('achievements backfill', () => {
  let app: FastifyInstance;
  let collector: PushCollector;
  let u: Record<string, UserRow>;
  let gamesOf: Record<string, { id: string; date: Date }[]>;
  let erinOldBadge: Date;

  beforeAll(async () => {
    collector = await startPushCollector();
    app = await buildTestApp({ env: { PUSH_URL: collector.url } });
  });

  afterAll(async () => {
    await app.close();
    await collector.close();
  });

  const snapshot = async (table: string) =>
    (
      await app.db.execute<{ row: string }>(
        sql.raw(`select to_jsonb(t)::text as row from "${table}" t order by 1`),
      )
    ).map((r) => r.row);

  const snapshotHistory = async () =>
    Object.fromEntries(
      await Promise.all(HISTORY_TABLES.map(async (t) => [t, await snapshot(t)] as const)),
    );

  const allBadges = async () =>
    (
      await app.db
        .select({ username: users.username, code: userAchievements.achievementCode })
        .from(userAchievements)
        .innerJoin(users, eq(userAchievements.userId, users.id))
    )
      .map((r) => `${r.username}:${r.code}`)
      .sort();

  const badge = async (user: UserRow, code: string) =>
    (
      await app.db
        .select()
        .from(userAchievements)
        .where(sql`${userAchievements.userId} = ${user.id} and achievement_code = ${code}`)
    )[0];

  beforeEach(async () => {
    await truncateAll(app.db);
    collector.reset();
    const names = [
      'alice',
      'opp1',
      'opp2',
      'carol',
      'opp3',
      'dave',
      'opp4',
      'erin',
      'opp5',
      'frank',
      'gina',
    ];
    u = {};
    for (const username of names) u[username] = await createUser(app.db, { username });
    for (const user of Object.values(u)) await createPushDevice(app.db, { userId: user.id });

    const t1 = await createTournament(app.db, { ownerUserId: u.alice!.id });
    const t2 = await createTournament(app.db, { ownerUserId: u.alice!.id });
    const t3 = await createTournament(app.db, { ownerUserId: u.alice!.id });
    const t4 = await createTournament(app.db, { ownerUserId: u.alice!.id });
    const t5 = await createTournament(app.db, { ownerUserId: u.alice!.id });
    const t1b = await createTournament(app.db, { ownerUserId: u.alice!.id, sportId: t1.sportId });

    const hist = (
      t: { id: string },
      user: string,
      opponent: string,
      results: ('WIN' | 'LOSS')[],
      start: string,
    ) =>
      playHistory(app.db, {
        tournamentId: t.id,
        userId: u[user]!.id,
        opponentId: u[opponent]!.id,
        results,
        start: at(start),
      });
    const times = (n: number, r: 'WIN' | 'LOSS') => Array.from({ length: n }, () => r);

    gamesOf = {};
    gamesOf.aliceT1 = await hist(
      t1,
      'alice',
      'opp1',
      ['LOSS', 'WIN', 'WIN', ...times(7, 'LOSS')],
      '2026-01-01T00:00:00Z',
    );
    gamesOf.aliceT2 = await hist(t2, 'alice', 'opp2', ['LOSS'], '2026-02-01T00:00:00Z');
    gamesOf.aliceT3 = await hist(t3, 'alice', 'opp2', ['LOSS'], '2026-03-01T00:00:00Z');
    await createStatsRow(app.db, {
      userId: u.alice!.id,
      tournamentId: t1.id,
      winStreak: 0,
      longuestWinStreak: 5,
    });

    gamesOf.carol = await hist(t4, 'carol', 'opp3', times(10, 'WIN'), '2026-01-05T00:00:00Z');
    await createStatsRow(app.db, {
      userId: u.carol!.id,
      tournamentId: t4.id,
      winStreak: 10,
      longuestWinStreak: 10,
    });

    gamesOf.dave = await hist(t5, 'dave', 'opp4', times(100, 'LOSS'), '2026-01-06T00:00:00Z');

    gamesOf.erin = [];
    const erinDays = [t1, t2, t3, t4, t5, t1b];
    for (const [i, t] of erinDays.entries()) {
      gamesOf.erin.push(
        ...(await hist(t, 'erin', 'opp5', ['LOSS'], `2026-04-0${i + 1}T00:00:00Z`)),
      );
    }
    erinOldBadge = at('2025-06-01T00:00:00Z');
    await app.db.insert(userAchievements).values({
      userId: u.erin!.id,
      achievementCode: 'explorer_3',
      sourceType: 'GAME',
      unlockedAt: erinOldBadge,
    });

    // A big pre-game gap that only stats know about; historical outcomes have no ratings.
    await hist(t2, 'frank', 'gina', ['WIN'], '2026-05-01T00:00:00Z');
    await createStatsRow(app.db, { userId: u.frank!.id, tournamentId: t2.id, score: 800 });
    await createStatsRow(app.db, { userId: u.gina!.id, tournamentId: t2.id, score: 1300 });

    // A placeholder alice added that was claimed before badges existed.
    const hank = await createUser(app.db, {
      username: 'hank',
      createdByUserId: u.alice!.id,
      claimedAt: at('2026-06-01T00:00:00Z'),
    });
    await createClaim(app.db, {
      placeholderUserId: hank.id,
      creatorUserId: u.alice!.id,
      consumedAt: at('2026-06-01T00:00:00Z'),
    });
  });

  const EXPECTED_NEW = [
    'alice:explorer_3',
    'alice:first_win',
    'alice:games_10',
    'alice:win_streak_3',
    'alice:win_streak_5',
    'carol:first_win',
    'carol:games_10',
    'carol:win_streak_10',
    'carol:win_streak_3',
    'carol:win_streak_5',
    'dave:games_10',
    'dave:games_100',
    'dave:games_50',
    'erin:explorer_5',
    'frank:first_win',
    'opp1:first_win',
    'opp1:games_10',
    'opp2:first_win',
    'opp3:games_10',
    'opp4:first_win',
    'opp4:games_10',
    'opp4:games_100',
    'opp4:games_50',
    'opp5:explorer_3',
    'opp5:explorer_5',
    'opp5:first_win',
  ];

  const expectedCounts = () => {
    const counts = Object.fromEntries(BACKFILL_CODES.map((c) => [c, 0])) as Record<
      BackfillCode,
      number
    >;
    for (const entry of EXPECTED_NEW) counts[entry.split(':')[1] as BackfillCode] += 1;
    return counts;
  };

  it('dry run reports the proposed awards and writes or sends nothing (VAL-ACH-012)', async () => {
    const before = await snapshotHistory();
    const badgesBefore = await snapshot('user_achievements');

    const report = await runAchievementsBackfill(app.db, { dryRun: true, now: NOW });
    await app.push.drain();

    expect(report).toMatchObject({ dryRun: true, usersScanned: 12, batches: 1 });
    expect(report.awards).toEqual(expectedCounts());
    expect(report.awards).toEqual({
      first_win: 7,
      win_streak_3: 2,
      win_streak_5: 2,
      win_streak_10: 1,
      games_10: 6,
      games_50: 2,
      games_100: 2,
      explorer_3: 2,
      explorer_5: 2,
    });
    expect(await snapshotHistory()).toEqual(before);
    expect(await snapshot('user_achievements')).toEqual(badgesBefore);
    expect(collector.received).toHaveLength(0);
  });

  it('apply awards exactly the eligible badges with historical dates, silently (VAL-ACH-013)', async () => {
    const before = await snapshotHistory();

    const report = await runAchievementsBackfill(app.db, { dryRun: false, now: NOW, batchSize: 3 });
    await app.push.drain();

    expect(report.dryRun).toBe(false);
    expect(report.batches).toBe(4);
    expect(report.awards).toEqual(expectedCounts());
    expect(await allBadges()).toEqual([...EXPECTED_NEW, 'erin:explorer_3'].sort());

    // Unlock dates come from the qualifying game where it is known, else the backfill time.
    const aliceGames = gamesOf.aliceT1!;
    expect(await badge(u.alice!, 'first_win')).toMatchObject({
      unlockedAt: aliceGames[1]!.date,
      sourceGameId: aliceGames[1]!.id,
      sourceType: 'BACKFILL',
    });
    expect((await badge(u.alice!, 'games_10'))?.unlockedAt).toEqual(aliceGames[9]!.date);
    expect((await badge(u.alice!, 'explorer_3'))?.unlockedAt).toEqual(gamesOf.aliceT3![0]!.date);
    expect(await badge(u.alice!, 'win_streak_5')).toMatchObject({
      unlockedAt: NOW,
      sourceGameId: null,
    });
    expect((await badge(u.dave!, 'games_50'))?.unlockedAt).toEqual(gamesOf.dave![49]!.date);
    expect((await badge(u.dave!, 'games_100'))?.unlockedAt).toEqual(gamesOf.dave![99]!.date);
    expect((await badge(u.erin!, 'explorer_5'))?.unlockedAt).toEqual(gamesOf.erin![4]!.date);
    expect((await badge(u.opp5!, 'explorer_3'))?.unlockedAt).toEqual(gamesOf.erin![2]!.date);
    expect(await badge(u.erin!, 'explorer_3')).toMatchObject({
      unlockedAt: erinOldBadge,
      sourceType: 'GAME',
    });

    expect(await snapshotHistory()).toEqual(before);
    expect(collector.received).toHaveLength(0);

    const afterFirst = await snapshot('user_achievements');
    const again = await runAchievementsBackfill(app.db, {
      dryRun: false,
      now: new Date(NOW.getTime() + 86_400_000),
    });
    await app.push.drain();
    expect(Object.values(again.awards).every((n) => n === 0)).toBe(true);
    expect(await snapshot('user_achievements')).toEqual(afterFirst);
    expect(await snapshotHistory()).toEqual(before);
    expect(collector.received).toHaveLength(0);

    const dryAfter = await runAchievementsBackfill(app.db, { dryRun: true, now: NOW });
    expect(Object.values(dryAfter.awards).every((n) => n === 0)).toBe(true);
  });

  it('never reconstructs ratings or invents giant_killer and event badges (VAL-ACH-014)', async () => {
    await runAchievementsBackfill(app.db, { dryRun: false, now: NOW });

    const excluded = await app.db
      .select()
      .from(userAchievements)
      .where(
        sql`achievement_code in ('giant_killer', 'invited_player_claimed', 'first_challenge_won', 'first_group_joined')`,
      );
    expect(excluded).toEqual([]);
    expect(await achievementCodesOf(app.db, u.frank!.id)).toEqual(['first_win']);
    const ratings = await app.db.select({ r: outcomes.ratingBefore }).from(outcomes);
    expect(ratings.length).toBeGreaterThan(0);
    expect(ratings.every((row) => row.r === null)).toBe(true);
    expect((await badge(u.erin!, 'explorer_3'))?.unlockedAt).toEqual(erinOldBadge);

    // Online evaluation still awards giant_killer from the pre-game ratings of a new game.
    const [t2] = await app.db.execute<{ name: string }>(
      sql`select t.name from tournaments t join stats s on s.tournament_id = t.id
          where s.user_id = ${u.frank!.id}`,
    );
    const res = await app.inject({
      method: 'POST',
      url: `/tournaments/${t2!.name}/games`,
      headers: await authHeadersFor(app, u.gina!.id),
      payload: {
        outcomes: [
          { username: 'frank', result: 'WIN' },
          { username: 'gina', result: 'LOSS' },
        ],
      },
    });
    await app.push.drain();
    expect(res.statusCode).toBe(201);
    expect(await achievementCodesOf(app.db, u.frank!.id)).toEqual(['first_win', 'giant_killer']);
  });

  it('runs from the command line in dry-run mode without writing', async () => {
    const before = await snapshot('user_achievements');
    const { stdout } = await promisify(execFile)(
      'npx',
      ['tsx', 'src/scripts/achievements-backfill.ts', '--dry-run', '--batch-size=5'],
      { cwd: backendDir, env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } },
    );
    expect(stdout).toContain('DRY RUN, nothing written');
    expect(stdout).toContain('12 users in 3 batch(es)');
    expect(stdout).toContain('first_win: would award 7');
    expect(stdout).toContain('games_100: would award 2');
    expect(await snapshot('user_achievements')).toEqual(before);
  });
});

describe('parseBackfillArgs', () => {
  it('defaults to apply with bounded batches', () => {
    expect(parseBackfillArgs([])).toEqual({ dryRun: false, batchSize: 500 });
    expect(parseBackfillArgs(['--dry-run', '--batch-size=50'])).toEqual({
      dryRun: true,
      batchSize: 50,
    });
  });

  it('rejects unknown arguments and invalid batch sizes', () => {
    expect(() => parseBackfillArgs(['--dryrun'])).toThrow(/Unknown argument/);
    expect(() => parseBackfillArgs(['--batch-size=0'])).toThrow(/batch-size/);
    expect(() => parseBackfillArgs(['--batch-size=abc'])).toThrow(/batch-size/);
  });
});
