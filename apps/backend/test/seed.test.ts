import { createHash } from 'node:crypto';
import { and, count, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, type Database } from '../src/db/client.js';
import {
  appInvites,
  challenges,
  gameShares,
  games,
  groupInvites,
  groupMembers,
  groupPlayers,
  groups,
  notificationPreferences,
  notifications,
  outcomes,
  playerClaims,
  pushDevices,
  rivalryStats,
  sports,
  stats,
  tournaments,
  userAchievements,
  users,
} from '../src/db/schema.js';
import {
  DEMO_CHALLENGES,
  DEMO_GROUP,
  DEMO_PLACEHOLDERS,
  DEMO_TOURNAMENTS,
  DEMO_USERS,
  fixtureLinkStates,
  runSeed,
  seedLinkLines,
  seedPublicWebUrl,
} from '../src/db/seed.js';
import { truncateAll } from './helpers.js';
import { TEST_DATABASE_URL } from './test-env.js';

const tables = {
  users,
  sports,
  tournaments,
  games,
  outcomes,
  stats,
  rivalryStats,
  playerClaims,
  notifications,
  userAchievements,
  groups,
  groupMembers,
  groupInvites,
  groupPlayers,
  challenges,
  pushDevices,
  notificationPreferences,
  appInvites,
  gameShares,
};

/** Every fixture row that a rerun must leave exactly as it was (identity, state and history). */
async function fixtureSnapshot(db: Database) {
  return {
    users: await db.select().from(users).orderBy(users.id),
    games: await db.select().from(games).orderBy(games.id),
    outcomes: await db.select().from(outcomes).orderBy(outcomes.id),
    stats: await db.select().from(stats).orderBy(stats.id),
    rivalryStats: await db.select().from(rivalryStats).orderBy(rivalryStats.id),
    groups: await db.select().from(groups).orderBy(groups.id),
    groupMembers: await db
      .select()
      .from(groupMembers)
      .orderBy(groupMembers.groupId, groupMembers.userId),
    groupInvites: await db.select().from(groupInvites).orderBy(groupInvites.id),
    groupPlayers: await db.select().from(groupPlayers).orderBy(groupPlayers.placeholderUserId),
    playerClaims: await db.select().from(playerClaims).orderBy(playerClaims.id),
    challenges: await db.select().from(challenges).orderBy(challenges.id),
    notifications: await db.select().from(notifications).orderBy(notifications.id),
    userAchievements: await db
      .select()
      .from(userAchievements)
      .orderBy(userAchievements.userId, userAchievements.achievementCode),
  };
}

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
    const expectedGames =
      DEMO_TOURNAMENTS.reduce((n, t) => n + t.games.length, 0) +
      DEMO_GROUP.tournament.games.length +
      DEMO_PLACEHOLDERS.filter((p) => p.game).length;
    expect(first.users).toBe(DEMO_USERS.length + DEMO_PLACEHOLDERS.length);
    expect(first.playerClaims).toBe(DEMO_PLACEHOLDERS.length);
    expect(first.tournaments).toBe(DEMO_TOURNAMENTS.length + 1);
    expect(first.groups).toBe(1);
    expect(first.groupMembers).toBe(1 + DEMO_GROUP.members.length);
    expect(first.groupInvites).toBe(1);
    expect(first.groupPlayers).toBe(DEMO_PLACEHOLDERS.filter((p) => p.rostered).length);
    expect(first.sports).toBeGreaterThan(0);
    expect(first.games).toBe(expectedGames);
    expect(first.stats).toBeGreaterThan(0);
    expect(first.rivalryStats).toBeGreaterThan(0);
    expect(first.challenges).toBe(DEMO_CHALLENGES.length);

    const claimsBefore = await db.select().from(playerClaims).orderBy(playerClaims.id);
    const second = await runSeed(db);
    expect(second.tournamentsWithNewGames).toBe(0);
    expect(second.placeholderGamesAdded).toBe(0);
    expect(first.userAchievements).toBeGreaterThan(0);
    expect(second.achievementsAwarded).toBe(0);
    expect(await rowCounts(db)).toEqual(first);
    expect(await db.select().from(playerClaims).orderBy(playerClaims.id)).toEqual(claimsBefore);
  });

  it('creates dev-alex’s invited players in every claim state with hashed local tokens', async () => {
    const [alex] = await db.select().from(users).where(eq(users.username, 'dev-alex'));
    const now = Date.now();
    for (const fixture of DEMO_PLACEHOLDERS) {
      const [user] = await db.select().from(users).where(eq(users.username, fixture.username));
      const [claim] = await db
        .select()
        .from(playerClaims)
        .where(eq(playerClaims.placeholderUserId, user!.id));
      expect(user?.createdByUserId).toBe(alex?.id);
      expect(claim?.creatorUserId).toBe(alex?.id);
      expect(claim?.tokenHash).toBe(createHash('sha256').update(fixture.claimToken).digest('hex'));
      expect(user?.accountType).toBe(fixture.state === 'CLAIMED' ? 'REGISTERED' : 'PLACEHOLDER');
      expect(claim?.consumedAt !== null).toBe(fixture.state === 'CLAIMED');
      expect(claim?.revokedAt !== null).toBe(fixture.state === 'REVOKED');
      expect(claim!.expiresAt.getTime() < now).toBe(fixture.state === 'EXPIRED');
      const [played] = await db
        .select({ n: count() })
        .from(outcomes)
        .where(eq(outcomes.userId, user!.id));
      expect(played?.n).toBe(fixture.game ? 1 : 0);
    }
  });

  it('creates the Shark Tank group with roles, a private tournament, roster and local invite', async () => {
    const idOf = async (username: string) =>
      (await db.select().from(users).where(eq(users.username, username)))[0]!.id;
    const [group] = await db.select().from(groups).where(eq(groups.id, DEMO_GROUP.id));
    expect(group).toMatchObject({ name: 'Shark Tank', createdByUserId: await idOf('dev-alex') });

    const members = await db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, DEMO_GROUP.id));
    expect(Object.fromEntries(members.map((m) => [m.userId, m.role]))).toEqual({
      [await idOf('dev-alex')]: 'OWNER',
      [await idOf('dev-sam')]: 'ADMIN',
      [await idOf('dev-jordan')]: 'MEMBER',
    });

    const [cup] = await db.select().from(tournaments).where(eq(tournaments.name, 'sharktankcup'));
    expect(cup?.groupId).toBe(DEMO_GROUP.id);
    const [cupGames] = await db
      .select({ n: count() })
      .from(games)
      .where(eq(games.tournamentId, cup!.id));
    expect(cupGames?.n).toBe(DEMO_GROUP.tournament.games.length + 1);

    const robin = await idOf('guest-robin');
    const roster = await db.select().from(groupPlayers);
    expect(roster).toEqual([
      expect.objectContaining({ groupId: DEMO_GROUP.id, placeholderUserId: robin }),
    ]);
    const robinGames = await db
      .select({ tournamentId: games.tournamentId })
      .from(outcomes)
      .innerJoin(games, eq(outcomes.gameId, games.id))
      .where(eq(outcomes.userId, robin));
    expect(robinGames).toEqual([{ tournamentId: cup!.id }]);

    const [invite] = await db.select().from(groupInvites);
    const sha = (value: string) => createHash('sha256').update(value).digest('hex');
    expect(invite).toMatchObject({
      groupId: DEMO_GROUP.id,
      tokenHash: sha(DEMO_GROUP.inviteToken),
      codeHash: sha(DEMO_GROUP.inviteCode),
      expiresAt: null,
      revokedAt: null,
    });
  });

  it('seeds read and unread inbox rows: one game_recorded per participant, no duplicates', async () => {
    const [outcomeCount] = await db.select({ n: count() }).from(outcomes);
    const rows = await db.select().from(notifications);
    const gameRows = rows.filter((r) => r.type === 'game_recorded');
    expect(gameRows).toHaveLength(outcomeCount!.n);
    expect(rows.filter((r) => r.type === 'placeholder_claimed')).toHaveLength(1);
    const [alex] = await db.select().from(users).where(eq(users.username, 'dev-alex'));
    const alexRows = rows.filter((r) => r.recipientUserId === alex!.id);
    expect(alexRows.some((r) => r.readAt === null)).toBe(true);
    expect(alexRows.some((r) => r.readAt !== null)).toBe(true);
    for (const row of gameRows) expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('backfills historical badges silently, without event or giant-killer badges', async () => {
    const [alex] = await db.select().from(users).where(eq(users.username, 'dev-alex'));
    const [riley] = await db.select().from(users).where(eq(users.username, 'guest-riley'));
    const codesOf = async (userId: string) =>
      (
        await db
          .select({ code: userAchievements.achievementCode })
          .from(userAchievements)
          .where(eq(userAchievements.userId, userId))
      )
        .map((r) => r.code)
        .sort();
    expect(await codesOf(alex!.id)).toEqual(
      expect.arrayContaining(['explorer_3', 'first_win', 'games_10']),
    );
    expect(await codesOf(riley!.id)).toEqual(['first_win']);
    const rows = await db.select().from(userAchievements);
    expect(rows.every((r) => r.sourceType === 'BACKFILL')).toBe(true);
    expect(
      rows.filter((r) =>
        [
          'giant_killer',
          'invited_player_claimed',
          'first_challenge_won',
          'first_group_joined',
        ].includes(r.achievementCode),
      ),
    ).toEqual([]);
    expect(
      await db.select().from(notifications).where(eq(notifications.type, 'achievement_unlocked')),
    ).toEqual([]);
  });

  it('seeds challenges in every state, the completed one linked to its eligible game', async () => {
    const rows = await db.select().from(challenges);
    expect(new Set(rows.map((r) => r.status))).toEqual(
      new Set(['PENDING', 'ACCEPTED', 'DECLINED', 'COMPLETED', 'EXPIRED']),
    );
    const now = Date.now();
    for (const row of rows) {
      // Active fixtures stay outside the 24-hour reminder window of a fresh seed.
      if (row.status === 'PENDING' || row.status === 'ACCEPTED') {
        expect(row.deadlineAt.getTime() - now).toBeGreaterThan(24 * 3_600_000);
      }
      if (row.status === 'EXPIRED') expect(row.deadlineAt.getTime()).toBeLessThan(now);
    }

    const completed = rows.find((r) => r.status === 'COMPLETED')!;
    const [game] = await db.select().from(games).where(eq(games.id, completed.gameId!));
    expect(game?.tournamentId).toBe(completed.tournamentId);
    const results = await db.select().from(outcomes).where(eq(outcomes.gameId, game!.id));
    const resultOf = (userId: string) => results.find((o) => o.userId === userId)?.result;
    expect(resultOf(completed.winnerUserId!)).toBe('WIN');
    const loser =
      completed.winnerUserId === completed.challengerUserId
        ? completed.opponentUserId
        : completed.challengerUserId;
    expect(resultOf(loser)).toBe('LOSS');
    expect(completed.acceptedAt!.getTime()).toBeLessThanOrEqual(game!.date.getTime());
    expect(game!.date.getTime()).toBeLessThan(completed.deadlineAt.getTime());

    const [sharkCup] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.name, 'sharktankcup'));
    expect(rows.some((r) => r.tournamentId === sharkCup!.id)).toBe(true);

    const events = await db.select().from(notifications);
    for (const row of rows) {
      expect(
        events.filter((n) => n.challengeId === row.id && n.type === 'challenge_received'),
      ).toEqual([expect.objectContaining({ recipientUserId: row.opponentUserId })]);
    }
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
  it('reruns at a later time keep every fixture identity, history, inbox row and badge', async () => {
    const before = await fixtureSnapshot(db);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const rerun = await runSeed(db, new Date(Date.now() + 3 * 24 * 3_600_000));
      expect(rerun).toMatchObject({
        tournamentsWithNewGames: 0,
        placeholderGamesAdded: 0,
        achievementsAwarded: 0,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
    expect(await fixtureSnapshot(db)).toEqual(before);
  });

  it('never registers push devices or sends push', async () => {
    const counts = await rowCounts(db);
    expect(counts.pushDevices).toBe(0);
    expect(counts.gameShares).toBe(0);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await runSeed(db);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
    expect((await rowCounts(db)).pushDevices).toBe(0);
  });

  it('prints LOCAL ONLY claim and group invite links on the configured web origin', async () => {
    const states = await fixtureLinkStates(db, new Date());
    expect(Object.fromEntries(states.claims)).toEqual(
      Object.fromEntries(DEMO_PLACEHOLDERS.map((p) => [p.username, p.state])),
    );
    expect(states.inviteState).toBe('ACTIVE');
    const lines = seedLinkLines('https://web.example.test', states);
    expect(lines[0]).toMatch(/^LOCAL ONLY claim links created by dev-alex/);
    for (const p of DEMO_PLACEHOLDERS) {
      expect(lines).toContain(
        `  [${p.state}] ${p.username}: https://web.example.test/invite/claim/${p.claimToken}`,
      );
    }
    expect(lines).toContain(`  link: https://web.example.test/join/${DEMO_GROUP.inviteToken}`);
    expect(lines).toContain(`  code: ${DEMO_GROUP.inviteCode}`);
    expect(lines.filter((l) => l.startsWith('LOCAL ONLY'))).toHaveLength(2);
  });

  it('takes the printed web origin from the shell, then the root .env, then the default', () => {
    const rootEnv =
      'DATABASE_URL=postgres://u:p@db:5432/x\nPUBLIC_WEB_URL=http://localhost:9999/\n';
    expect(seedPublicWebUrl({}, rootEnv)).toBe('http://localhost:9999');
    expect(seedPublicWebUrl({ PUBLIC_WEB_URL: 'https://shell.example.test' }, rootEnv)).toBe(
      'https://shell.example.test',
    );
    expect(seedPublicWebUrl({}, 'PORT=3100\n')).toBe('http://localhost:8083');
    expect(seedPublicWebUrl({}, undefined)).toBe('http://localhost:8083');
    expect(() => seedPublicWebUrl({}, 'PUBLIC_WEB_URL=not a url')).toThrow();
  });

  it('reruns keep a consumed fixture claim bound to its claimant and user progress', async () => {
    const [riley] = await db.select().from(users).where(eq(users.username, 'guest-riley'));
    const [rileyClaim] = await db
      .select()
      .from(playerClaims)
      .where(eq(playerClaims.placeholderUserId, riley!.id));
    const claimedAt = new Date();
    await db
      .update(users)
      .set({
        accountType: 'REGISTERED',
        googleSub: 'google|riley-claimant',
        email: 'riley@example.test',
        claimedAt,
      })
      .where(eq(users.id, riley!.id));
    await db
      .update(playerClaims)
      .set({ consumedAt: claimedAt })
      .where(eq(playerClaims.id, rileyClaim!.id));
    const pending = DEMO_CHALLENGES.find((c) => c.state === 'PENDING')!;
    await db
      .update(challenges)
      .set({ status: 'ACCEPTED', acceptedAt: claimedAt, updatedAt: claimedAt })
      .where(eq(challenges.id, pending.id));
    const [unread] = await db
      .select()
      .from(notifications)
      .where(isNull(notifications.readAt))
      .limit(1);
    await db
      .update(notifications)
      .set({ readAt: claimedAt })
      .where(eq(notifications.id, unread!.id));
    const before = await fixtureSnapshot(db);

    await runSeed(db);

    expect(await fixtureSnapshot(db)).toEqual(before);
    const [after] = await db.select().from(users).where(eq(users.id, riley!.id));
    expect(after).toMatchObject({ accountType: 'REGISTERED', googleSub: 'google|riley-claimant' });
    const rileyClaims = await db
      .select()
      .from(playerClaims)
      .where(eq(playerClaims.placeholderUserId, riley!.id));
    expect(rileyClaims).toEqual([
      expect.objectContaining({
        id: rileyClaim!.id,
        tokenHash: rileyClaim!.tokenHash,
        consumedAt: claimedAt,
      }),
    ]);
    expect((await fixtureLinkStates(db, new Date())).claims.get('guest-riley')).toBe('CLAIMED');
  });

  it('reruns keep roles changed and invites revoked while testing', async () => {
    const [jordan] = await db.select().from(users).where(eq(users.username, 'dev-jordan'));
    await db
      .update(groupMembers)
      .set({ role: 'ADMIN' })
      .where(and(eq(groupMembers.groupId, DEMO_GROUP.id), eq(groupMembers.userId, jordan!.id)));
    await db.update(groupInvites).set({ revokedAt: new Date() });
    const before = await rowCounts(db);

    await runSeed(db);

    expect(await rowCounts(db)).toEqual(before);
    const [membership] = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, DEMO_GROUP.id), eq(groupMembers.userId, jordan!.id)));
    expect(membership?.role).toBe('ADMIN');
    const [invite] = await db.select().from(groupInvites);
    expect(invite?.revokedAt).not.toBeNull();
    expect((await fixtureLinkStates(db, new Date())).inviteState).toBe('REVOKED');
  });
});
