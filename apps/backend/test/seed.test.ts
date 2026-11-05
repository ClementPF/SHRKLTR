import { createHash } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../src/db/client.js';
import {
  games,
  groupInvites,
  groupMembers,
  groupPlayers,
  groups,
  notifications,
  outcomes,
  playerClaims,
  rivalryStats,
  sports,
  stats,
  tournaments,
  userAchievements,
  users,
} from '../src/db/schema.js';
import {
  DEMO_GROUP,
  DEMO_PLACEHOLDERS,
  DEMO_TOURNAMENTS,
  DEMO_USERS,
  runSeed,
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
};

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
  });
});
