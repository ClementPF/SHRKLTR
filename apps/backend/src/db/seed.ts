import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { envSchema } from '../config.js';
import { hashCapabilityToken } from '../lib/capability-token.js';
import { runAchievementsBackfill } from '../scripts/achievements-backfill.js';
import { recordGame } from '../services/game.service.js';
import { NOTIFICATION_CATEGORY_BY_TYPE } from '../services/notification.service.js';
import { hashInviteCode, joinUrlFor } from '../services/group-invite.service.js';
import { claimUrlFor } from '../services/placeholder.service.js';
import { createDb, type Database, type Transaction } from './client.js';
import {
  challenges,
  games,
  groupInvites,
  groupMembers,
  groupPlayers,
  groups,
  notifications,
  outcomes,
  playerClaims,
  sports,
  tournaments,
  users,
} from './schema.js';

interface DemoUser {
  username: string;
  firstName: string;
  lastName: string;
}

interface DemoGame {
  winners: string[];
  losers: string[];
  hoursAgo: number;
}

interface DemoTournament {
  displayName: string;
  sport: string;
  owner: string;
  games: DemoGame[];
  /** Members-only tournament of this group. */
  groupId?: string;
}

export const DEMO_USERS: readonly DemoUser[] = [
  { username: 'dev-alex', firstName: 'Alex', lastName: 'Martin' },
  { username: 'dev-sam', firstName: 'Sam', lastName: 'Bernard' },
  { username: 'dev-jordan', firstName: 'Jordan', lastName: 'Petit' },
  { username: 'dev-taylor', firstName: 'Taylor', lastName: 'Dubois' },
  { username: 'dev-morgan', firstName: 'Morgan', lastName: 'Leroy' },
];

export const DEMO_SPORTS: readonly string[] = ['babyfoot', 'ping-pong', 'chess', 'darts'];

const game = (winners: string[], losers: string[], hoursAgo: number): DemoGame => ({
  winners,
  losers,
  hoursAgo,
});

// Listed oldest first so ratings evolve in chronological order.
export const DEMO_TOURNAMENTS: readonly DemoTournament[] = [
  {
    displayName: 'Office Babyfoot',
    sport: 'babyfoot',
    owner: 'dev-alex',
    games: [
      game(['dev-alex'], ['dev-sam'], 240),
      game(['dev-sam'], ['dev-jordan'], 200),
      game(['dev-alex', 'dev-taylor'], ['dev-sam', 'dev-jordan'], 170),
      game(['dev-jordan'], ['dev-alex'], 120),
      game(['dev-alex'], ['dev-taylor'], 96),
      game(['dev-sam', 'dev-morgan'], ['dev-alex', 'dev-jordan'], 72),
      game(['dev-alex'], ['dev-sam'], 30),
      game(['dev-taylor'], ['dev-morgan'], 5),
    ],
  },
  {
    displayName: 'Friday Ping Pong',
    sport: 'ping-pong',
    owner: 'dev-sam',
    games: [
      game(['dev-sam'], ['dev-alex'], 190),
      game(['dev-morgan'], ['dev-sam'], 150),
      game(['dev-sam'], ['dev-taylor'], 100),
      game(['dev-alex'], ['dev-morgan'], 50),
      game(['dev-sam'], ['dev-alex'], 26),
      game(['dev-taylor'], ['dev-jordan'], 2),
    ],
  },
  {
    displayName: 'Chess Club',
    sport: 'chess',
    owner: 'dev-jordan',
    games: [
      game(['dev-jordan'], ['dev-taylor'], 160),
      game(['dev-taylor'], ['dev-alex'], 80),
      game(['dev-jordan'], ['dev-alex'], 48),
      game(['dev-morgan'], ['dev-jordan'], 12),
    ],
  },
  {
    // Gives dev-alex more history than one feed page (15) so infinite scroll is exercisable.
    displayName: 'Lunch Darts',
    sport: 'darts',
    owner: 'dev-morgan',
    games: [
      game(['dev-alex'], ['dev-morgan'], 230),
      game(['dev-morgan'], ['dev-alex'], 210),
      game(['dev-alex'], ['dev-jordan'], 180),
      game(['dev-sam'], ['dev-alex'], 140),
      game(['dev-alex', 'dev-morgan'], ['dev-sam', 'dev-taylor'], 110),
      game(['dev-taylor'], ['dev-alex'], 90),
      game(['dev-alex'], ['dev-sam'], 60),
      game(['dev-jordan'], ['dev-alex'], 36),
      game(['dev-alex'], ['dev-taylor'], 20),
    ],
  },
];

interface DemoGroup {
  /** Fixed id so reruns find the group again (group names are not unique). */
  id: string;
  name: string;
  owner: string;
  members: readonly { username: string; role: 'ADMIN' | 'MEMBER' }[];
  /** LOCAL ONLY deterministic invite credentials; only their hashes are stored. */
  inviteToken: string;
  inviteCode: string;
  tournament: DemoTournament;
}

const DEMO_GROUP_ID = '5ea0c0de-0000-4000-8000-000000000001';

export const DEMO_GROUP: DemoGroup = {
  id: DEMO_GROUP_ID,
  name: 'Shark Tank',
  owner: 'dev-alex',
  members: [
    { username: 'dev-sam', role: 'ADMIN' },
    { username: 'dev-jordan', role: 'MEMBER' },
  ],
  inviteToken: 'LOCAL-DEV-ONLY_group_shark-tank_invite',
  inviteCode: 'SHARKTANK2',
  tournament: {
    displayName: 'Shark Tank Cup',
    sport: 'babyfoot',
    owner: 'dev-alex',
    groupId: DEMO_GROUP_ID,
    games: [
      game(['dev-sam'], ['dev-alex'], 100),
      game(['dev-alex'], ['dev-jordan'], 70),
      game(['dev-jordan'], ['dev-sam'], 40),
      game(['dev-alex'], ['dev-sam'], 9),
    ],
  },
};

/** Open tournaments followed by the group's private one, in creation order. */
const ALL_DEMO_TOURNAMENTS: readonly DemoTournament[] = [
  ...DEMO_TOURNAMENTS,
  DEMO_GROUP.tournament,
];

type ClaimFixtureState = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'CLAIMED';

interface DemoPlaceholder {
  username: string;
  firstName: string;
  lastName: string;
  state: ClaimFixtureState;
  /**
   * LOCAL ONLY deterministic claim token, so the printed links stay stable across seed runs.
   * Only its hash is stored; real claim tokens are always random.
   */
  claimToken: string;
  /** One game against the creator in this tournament, recorded once. */
  game?: { tournament: string; placeholderResult: 'WIN' | 'LOSS' };
  /** Listed among the demo group's unclaimed players; claiming it joins the group. */
  rostered?: boolean;
}

const PLACEHOLDER_CREATOR = 'dev-alex';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Players dev-alex added by name, one per claim-link lifecycle state. */
export const DEMO_PLACEHOLDERS: readonly DemoPlaceholder[] = [
  {
    username: 'guest-riley',
    firstName: 'Riley',
    lastName: 'Guest',
    state: 'ACTIVE',
    claimToken: 'LOCAL-DEV-ONLY_claim_guest-riley_active',
    game: { tournament: 'Office Babyfoot', placeholderResult: 'WIN' },
  },
  {
    username: 'guest-casey',
    firstName: 'Casey',
    lastName: 'Guest',
    state: 'EXPIRED',
    claimToken: 'LOCAL-DEV-ONLY_claim_guest-casey_expired',
  },
  {
    username: 'guest-jamie',
    firstName: 'Jamie',
    lastName: 'Guest',
    state: 'REVOKED',
    claimToken: 'LOCAL-DEV-ONLY_claim_guest-jamie_revoked',
  },
  {
    username: 'guest-quinn',
    firstName: 'Quinn',
    lastName: 'Guest',
    state: 'CLAIMED',
    claimToken: 'LOCAL-DEV-ONLY_claim_guest-quinn_claimed',
    game: { tournament: 'Friday Ping Pong', placeholderResult: 'LOSS' },
  },
  {
    username: 'guest-robin',
    firstName: 'Robin',
    lastName: 'Guest',
    state: 'ACTIVE',
    claimToken: 'LOCAL-DEV-ONLY_claim_guest-robin_active',
    game: { tournament: 'Shark Tank Cup', placeholderResult: 'LOSS' },
    rostered: true,
  },
];

export function tournamentSlug(displayName: string): string {
  return displayName.replace(/\s+/g, '').toLowerCase();
}

function requireId(ids: Map<string, string>, key: string): string {
  const id = ids.get(key);
  if (!id) throw new Error(`seed references unknown key "${key}"`);
  return id;
}

/** Replays the demo games of one tournament through the same path as submitted games. */
async function seedTournamentGames(
  tx: Transaction,
  tournamentId: string,
  demoGames: readonly DemoGame[],
  userIds: Map<string, string>,
  now: Date,
): Promise<void> {
  for (const demo of demoGames) {
    await recordGame(tx, {
      tournamentId,
      date: new Date(now.getTime() - demo.hoursAgo * 3_600_000),
      participants: [
        ...demo.winners.map((u) => ({ userId: requireId(userIds, u), result: 'WIN' as const })),
        ...demo.losers.map((u) => ({ userId: requireId(userIds, u), result: 'LOSS' as const })),
      ],
    });
  }
}

/** Demo inbox rows older than this are seeded as already read. */
const READ_AFTER_HOURS = 48;

/**
 * Inbox fixtures: game_recorded for every participant of every demo game, plus dev-alex's
 * placeholder_claimed for the claimed fixture. Keyed by the same dedupe keys as live events, so
 * reruns never duplicate rows or reset read state. Rows are inserted directly; the seed never
 * pushes.
 */
async function seedNotifications(
  tx: Transaction,
  userIds: Map<string, string>,
  now: Date,
): Promise<void> {
  const played = await tx
    .select({ userId: outcomes.userId, gameId: games.id, date: games.date })
    .from(outcomes)
    .innerJoin(games, eq(outcomes.gameId, games.id))
    .innerJoin(tournaments, eq(games.tournamentId, tournaments.id))
    .where(
      inArray(
        tournaments.name,
        ALL_DEMO_TOURNAMENTS.map((t) => tournamentSlug(t.displayName)),
      ),
    );
  const readBefore = now.getTime() - READ_AFTER_HOURS * 3_600_000;
  const gameRows = played.map((p) => ({
    recipientUserId: p.userId,
    type: 'game_recorded' as const,
    category: NOTIFICATION_CATEGORY_BY_TYPE.game_recorded,
    dedupeKey: `game_recorded:${p.gameId}`,
    gameId: p.gameId,
    createdAt: p.date,
    readAt: p.date.getTime() < readBefore ? new Date(p.date.getTime() + 3_600_000) : null,
  }));
  if (gameRows.length > 0) await tx.insert(notifications).values(gameRows).onConflictDoNothing();

  const claimed = DEMO_PLACEHOLDERS.find((p) => p.state === 'CLAIMED');
  if (!claimed) return;
  const [claimedUser] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, claimed.username));
  if (!claimedUser) return;
  await tx
    .insert(notifications)
    .values({
      recipientUserId: requireId(userIds, PLACEHOLDER_CREATOR),
      type: 'placeholder_claimed',
      category: NOTIFICATION_CATEGORY_BY_TYPE.placeholder_claimed,
      dedupeKey: `placeholder_claimed:${claimedUser.id}`,
      actorUserId: claimedUser.id,
      subjectUserId: claimedUser.id,
      createdAt: new Date(now.getTime() - 3 * 3_600_000),
    })
    .onConflictDoNothing();
}

type ChallengeFixtureState = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED' | 'EXPIRED';

interface DemoChallenge {
  /** Fixed id so reruns find the challenge again. */
  id: string;
  state: ChallengeFixtureState;
  tournament: string;
  challenger: string;
  opponent: string;
  /** Creation time relative to the seed clock (ignored for COMPLETED, which follows its game). */
  createdHoursAgo: number;
  /** Deadline relative to creation. */
  durationHours: number;
}

/**
 * One challenge per lifecycle state around dev-alex (sent and received), plus a pending one in
 * the Shark Tank group's private tournament. Active deadlines stay well beyond the 24-hour
 * reminder window of a fresh seed.
 */
export const DEMO_CHALLENGES: readonly DemoChallenge[] = [
  {
    id: '5ea0c0de-0000-4000-8000-000000000101',
    state: 'PENDING',
    tournament: 'Office Babyfoot',
    challenger: 'dev-morgan',
    opponent: 'dev-alex',
    createdHoursAgo: 2,
    durationHours: 5 * 24,
  },
  {
    id: '5ea0c0de-0000-4000-8000-000000000102',
    state: 'ACCEPTED',
    tournament: 'Chess Club',
    challenger: 'dev-alex',
    opponent: 'dev-jordan',
    createdHoursAgo: 24,
    durationHours: 7 * 24,
  },
  {
    id: '5ea0c0de-0000-4000-8000-000000000103',
    state: 'DECLINED',
    tournament: 'Lunch Darts',
    challenger: 'dev-alex',
    opponent: 'dev-morgan',
    createdHoursAgo: 72,
    durationHours: 7 * 24,
  },
  {
    id: '5ea0c0de-0000-4000-8000-000000000104',
    state: 'COMPLETED',
    tournament: 'Office Babyfoot',
    challenger: 'dev-sam',
    opponent: 'dev-alex',
    createdHoursAgo: 0,
    durationHours: 7 * 24,
  },
  {
    id: '5ea0c0de-0000-4000-8000-000000000105',
    state: 'EXPIRED',
    tournament: 'Friday Ping Pong',
    challenger: 'dev-taylor',
    opponent: 'dev-alex',
    createdHoursAgo: 10 * 24,
    durationHours: 3 * 24,
  },
  {
    id: '5ea0c0de-0000-4000-8000-000000000106',
    state: 'PENDING',
    tournament: 'Shark Tank Cup',
    challenger: 'dev-alex',
    opponent: 'dev-sam',
    createdHoursAgo: 1,
    durationHours: 3 * 24,
  },
];

/**
 * Demo challenges with their inbox events, inserted directly (no push, no badge). The COMPLETED
 * fixture is linked to the latest demo game its players played on opposite teams, with the
 * challenge created and accepted shortly before that game. Rows that already exist, or would
 * collide with an active challenge created while testing, are left alone.
 */
async function seedChallenges(
  tx: Transaction,
  userIds: Map<string, string>,
  now: Date,
): Promise<void> {
  const hoursBefore = (base: Date, hours: number) => new Date(base.getTime() - hours * 3_600_000);
  const rows: (typeof challenges.$inferInsert)[] = [];
  for (const demo of DEMO_CHALLENGES) {
    const challengerUserId = requireId(userIds, demo.challenger);
    const opponentUserId = requireId(userIds, demo.opponent);
    const [tournament] = await tx
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(eq(tournaments.name, tournamentSlug(demo.tournament)));
    if (!tournament) throw new Error(`tournament ${demo.tournament} missing`);
    const [pairLowUserId, pairHighUserId] = [challengerUserId, opponentUserId].sort() as [
      string,
      string,
    ];
    const base = { id: demo.id, tournamentId: tournament.id, challengerUserId, opponentUserId };
    if (demo.state === 'COMPLETED') {
      const winners = await tx
        .select({ gameId: outcomes.gameId, userId: outcomes.userId, date: games.date })
        .from(outcomes)
        .innerJoin(games, eq(outcomes.gameId, games.id))
        .where(
          and(
            eq(games.tournamentId, tournament.id),
            eq(outcomes.result, 'WIN'),
            inArray(outcomes.userId, [challengerUserId, opponentUserId]),
          ),
        )
        .orderBy(desc(games.date));
      let linked: { gameId: string; userId: string; date: Date } | undefined;
      for (const win of winners) {
        const otherId = win.userId === challengerUserId ? opponentUserId : challengerUserId;
        const [lost] = await tx
          .select({ n: count() })
          .from(outcomes)
          .where(
            and(
              eq(outcomes.gameId, win.gameId),
              eq(outcomes.userId, otherId),
              eq(outcomes.result, 'LOSS'),
            ),
          );
        if ((lost?.n ?? 0) > 0) {
          linked = win;
          break;
        }
      }
      if (!linked) continue;
      const createdAt = hoursBefore(linked.date, 10);
      rows.push({
        ...base,
        pairLowUserId,
        pairHighUserId,
        status: 'COMPLETED',
        createdAt,
        updatedAt: linked.date,
        acceptedAt: hoursBefore(linked.date, 8),
        deadlineAt: new Date(createdAt.getTime() + demo.durationHours * 3_600_000),
        resolvedAt: linked.date,
        gameId: linked.gameId,
        winnerUserId: linked.userId,
      });
      continue;
    }
    const createdAt = hoursBefore(now, demo.createdHoursAgo);
    const deadlineAt = new Date(createdAt.getTime() + demo.durationHours * 3_600_000);
    const answeredAt = new Date(createdAt.getTime() + 3_600_000);
    rows.push({
      ...base,
      pairLowUserId,
      pairHighUserId,
      status: demo.state,
      createdAt,
      updatedAt: createdAt,
      deadlineAt,
      acceptedAt: demo.state === 'ACCEPTED' ? answeredAt : null,
      resolvedAt:
        demo.state === 'DECLINED' ? answeredAt : demo.state === 'EXPIRED' ? deadlineAt : null,
    });
  }
  if (rows.length === 0) return;
  const inserted = await tx.insert(challenges).values(rows).onConflictDoNothing().returning();

  const readBefore = now.getTime() - READ_AFTER_HOURS * 3_600_000;
  const event = (
    challenge: (typeof inserted)[number],
    type: 'challenge_received' | 'challenge_accepted' | 'challenge_declined' | 'challenge_expired',
    recipientUserId: string,
    createdAt: Date,
  ) => {
    const other =
      recipientUserId === challenge.challengerUserId
        ? challenge.opponentUserId
        : challenge.challengerUserId;
    return {
      recipientUserId,
      type,
      category: NOTIFICATION_CATEGORY_BY_TYPE[type],
      dedupeKey: `${type}:${challenge.id}`,
      actorUserId: type === 'challenge_expired' ? null : other,
      subjectUserId: other,
      challengeId: challenge.id,
      createdAt,
      readAt: createdAt.getTime() < readBefore ? new Date(createdAt.getTime() + 3_600_000) : null,
    };
  };
  const events = inserted.flatMap((c) => {
    const list = [event(c, 'challenge_received', c.opponentUserId, c.createdAt)];
    if (c.acceptedAt) list.push(event(c, 'challenge_accepted', c.challengerUserId, c.acceptedAt));
    if (c.status === 'DECLINED' && c.resolvedAt) {
      list.push(event(c, 'challenge_declined', c.challengerUserId, c.resolvedAt));
    }
    if (c.status === 'EXPIRED' && c.resolvedAt) {
      list.push(event(c, 'challenge_expired', c.challengerUserId, c.resolvedAt));
      list.push(event(c, 'challenge_expired', c.opponentUserId, c.resolvedAt));
    }
    return list;
  });
  if (events.length > 0) await tx.insert(notifications).values(events).onConflictDoNothing();
}

export interface SeedSummary {
  users: number;
  sports: number;
  tournaments: number;
  tournamentsWithNewGames: number;
  placeholders: number;
  placeholderGamesAdded: number;
  achievementsAwarded: number;
}

/**
 * Placeholder fixtures created by dev-alex with their claim links. Existing rows are never
 * updated, so a claimed or revoked fixture is not reset and no link silently rotates.
 */
async function seedPlaceholders(
  tx: Transaction,
  userIds: Map<string, string>,
  now: Date,
): Promise<{ placeholders: number; gamesAdded: number }> {
  const creatorId = requireId(userIds, PLACEHOLDER_CREATOR);
  await tx
    .insert(users)
    .values(
      DEMO_PLACEHOLDERS.map((p) => ({
        username: p.username,
        firstName: p.firstName,
        lastName: p.lastName,
        createdByUserId: creatorId,
        ...(p.state === 'CLAIMED'
          ? {
              accountType: 'REGISTERED' as const,
              googleSub: `dev|${p.username}`,
              claimedAt: now,
            }
          : { accountType: 'PLACEHOLDER' as const }),
      })),
    )
    .onConflictDoNothing();
  const rows = await tx
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(
      inArray(
        users.username,
        DEMO_PLACEHOLDERS.map((p) => p.username),
      ),
    );
  const placeholderIds = new Map(rows.map((r) => [r.username, r.id]));

  const rostered = DEMO_PLACEHOLDERS.filter((p) => p.rostered);
  if (rostered.length > 0) {
    await tx
      .insert(groupPlayers)
      .values(
        rostered.map((p) => ({
          groupId: DEMO_GROUP.id,
          placeholderUserId: requireId(placeholderIds, p.username),
          addedByUserId: creatorId,
        })),
      )
      .onConflictDoNothing();
  }

  await tx
    .insert(playerClaims)
    .values(
      DEMO_PLACEHOLDERS.map((p) => ({
        placeholderUserId: requireId(placeholderIds, p.username),
        creatorUserId: creatorId,
        tokenHash: hashCapabilityToken(p.claimToken),
        // Long-lived so the local fixture link stays usable; real links use CLAIM_TTL_DAYS.
        expiresAt: new Date(now.getTime() + (p.state === 'EXPIRED' ? -1 : 365) * DAY_MS),
        consumedAt: p.state === 'CLAIMED' ? now : null,
        revokedAt: p.state === 'REVOKED' ? now : null,
      })),
    )
    .onConflictDoNothing();

  let gamesAdded = 0;
  for (const p of DEMO_PLACEHOLDERS) {
    if (!p.game) continue;
    const placeholderId = requireId(placeholderIds, p.username);
    const [played] = await tx
      .select({ n: count() })
      .from(outcomes)
      .where(eq(outcomes.userId, placeholderId));
    if ((played?.n ?? 0) > 0) continue;
    const [tournament] = await tx
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(eq(tournaments.name, tournamentSlug(p.game.tournament)));
    if (!tournament) throw new Error(`tournament ${p.game.tournament} missing`);
    const creatorResult = p.game.placeholderResult === 'WIN' ? 'LOSS' : 'WIN';
    await recordGame(tx, {
      tournamentId: tournament.id,
      date: new Date(now.getTime() - 60 * 60 * 1000),
      participants: [
        { userId: placeholderId, result: p.game.placeholderResult },
        { userId: creatorId, result: creatorResult },
      ],
    });
    gamesAdded += 1;
  }
  return { placeholders: placeholderIds.size, gamesAdded };
}

/**
 * The demo group and its reusable invite. Members are inserted only when the group itself is
 * created, so reruns never reset roles changed while testing, and a revoked fixture invite stays
 * revoked. Seeded memberships award no badges and send no join events.
 */
async function seedGroup(tx: Transaction, userIds: Map<string, string>): Promise<void> {
  const ownerId = requireId(userIds, DEMO_GROUP.owner);
  const [created] = await tx
    .insert(groups)
    .values({ id: DEMO_GROUP.id, name: DEMO_GROUP.name, createdByUserId: ownerId })
    .onConflictDoNothing()
    .returning({ id: groups.id });
  if (created) {
    await tx.insert(groupMembers).values([
      { groupId: created.id, userId: ownerId, role: 'OWNER' as const },
      ...DEMO_GROUP.members.map((m) => ({
        groupId: created.id,
        userId: requireId(userIds, m.username),
        role: m.role,
      })),
    ]);
  }
  await tx
    .insert(groupInvites)
    .values({
      groupId: DEMO_GROUP.id,
      createdByUserId: ownerId,
      tokenHash: hashCapabilityToken(DEMO_GROUP.inviteToken),
      codeHash: hashInviteCode(DEMO_GROUP.inviteCode),
      // Never expires so the printed local link keeps working; real invites default to 30 days.
      expiresAt: null,
    })
    .onConflictDoNothing();
}

/**
 * Idempotent: rows are keyed by their unique natural keys (username, sport name, tournament
 * slug), and a tournament only receives demo games while it has none. Badges earned by the
 * demo history come from the silent achievements backfill (no inbox rows, no push).
 */
export async function runSeed(db: Database, now: Date = new Date()): Promise<SeedSummary> {
  const summary = await seedFixtures(db, now);
  const backfill = await runAchievementsBackfill(db, { dryRun: false, now });
  const achievementsAwarded = Object.values(backfill.awards).reduce((n, v) => n + v, 0);
  return { ...summary, achievementsAwarded };
}

function seedFixtures(db: Database, now: Date): Promise<Omit<SeedSummary, 'achievementsAwarded'>> {
  return db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values(
        DEMO_USERS.map((u) => ({
          googleSub: `dev|${u.username}`,
          username: u.username,
          email: `${u.username}@sharkulator.dev`,
          emailVerified: true,
          firstName: u.firstName,
          lastName: u.lastName,
          locale: 'en',
        })),
      )
      .onConflictDoNothing();
    const userRows = await tx
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(
        inArray(
          users.username,
          DEMO_USERS.map((u) => u.username),
        ),
      );
    const userIds = new Map(userRows.map((u) => [u.username, u.id]));

    await tx
      .insert(sports)
      .values(DEMO_SPORTS.map((name) => ({ name })))
      .onConflictDoNothing();
    const sportRows = await tx
      .select({ id: sports.id, name: sports.name })
      .from(sports)
      .where(inArray(sports.name, [...DEMO_SPORTS]));
    const sportIds = new Map(sportRows.map((s) => [s.name, s.id]));

    await seedGroup(tx, userIds);

    await tx
      .insert(tournaments)
      .values(
        ALL_DEMO_TOURNAMENTS.map((t) => ({
          name: tournamentSlug(t.displayName),
          displayName: t.displayName,
          sportId: requireId(sportIds, t.sport),
          ownerUserId: requireId(userIds, t.owner),
          groupId: t.groupId ?? null,
        })),
      )
      .onConflictDoNothing();

    let tournamentsWithNewGames = 0;
    for (const demo of ALL_DEMO_TOURNAMENTS) {
      const [tournament] = await tx
        .select({ id: tournaments.id })
        .from(tournaments)
        .where(eq(tournaments.name, tournamentSlug(demo.displayName)));
      if (!tournament) throw new Error(`tournament ${demo.displayName} missing after insert`);

      const [existing] = await tx
        .select({ n: count() })
        .from(games)
        .where(eq(games.tournamentId, tournament.id));
      if ((existing?.n ?? 0) > 0) continue;

      await seedTournamentGames(tx, tournament.id, demo.games, userIds, now);
      tournamentsWithNewGames += 1;
    }

    const placeholders = await seedPlaceholders(tx, userIds, now);
    await seedNotifications(tx, userIds, now);
    await seedChallenges(tx, userIds, now);

    return {
      users: userRows.length,
      sports: sportRows.length,
      tournaments: ALL_DEMO_TOURNAMENTS.length,
      tournamentsWithNewGames,
      placeholders: placeholders.placeholders,
      placeholderGamesAdded: placeholders.gamesAdded,
    };
  });
}

/**
 * Web origin for the printed fixture links, so they match the links the api issues: the shell's
 * PUBLIC_WEB_URL, else the one in the repo-root .env (the api container's env_file), else the
 * config default. Only PUBLIC_WEB_URL is taken from the file: its DATABASE_URL targets the
 * compose-internal host `db`, which the host cannot reach.
 */
export function seedPublicWebUrl(
  env: Record<string, string | undefined>,
  rootEnvText: string | undefined,
): string {
  const fromFile = rootEnvText === undefined ? undefined : parseEnv(rootEnvText).PUBLIC_WEB_URL;
  return envSchema.shape.PUBLIC_WEB_URL.parse(env.PUBLIC_WEB_URL || fromFile || undefined);
}

function readRootEnv(): string | undefined {
  try {
    return readFileSync(fileURLToPath(new URL('../../../../.env', import.meta.url)), 'utf8');
  } catch {
    // Inside the api container only apps/backend is mounted; compose passes .env as env vars.
    return undefined;
  }
}

/** REPLACED: the link was reissued in the app, so the fixture token no longer matches. */
export type FixtureLinkState = ClaimFixtureState | 'REPLACED';

export interface FixtureLinkStates {
  claims: ReadonlyMap<string, FixtureLinkState>;
  inviteState: 'ACTIVE' | 'REVOKED' | 'MISSING';
}

/**
 * The current state of each fixture link. Reruns never reset links changed while testing, so the
 * printed state can differ from the one the fixture was created in.
 */
export async function fixtureLinkStates(db: Database, now: Date): Promise<FixtureLinkStates> {
  const rows = await db
    .select({ username: users.username, claim: playerClaims })
    .from(playerClaims)
    .innerJoin(users, eq(playerClaims.placeholderUserId, users.id))
    .where(
      inArray(
        users.username,
        DEMO_PLACEHOLDERS.map((p) => p.username),
      ),
    );
  const byUsername = new Map(rows.map((r) => [r.username, r.claim]));
  const claims = new Map<string, FixtureLinkState>();
  for (const p of DEMO_PLACEHOLDERS) {
    const claim = byUsername.get(p.username);
    if (!claim || claim.tokenHash !== hashCapabilityToken(p.claimToken)) {
      claims.set(p.username, 'REPLACED');
    } else if (claim.consumedAt) {
      claims.set(p.username, 'CLAIMED');
    } else if (claim.revokedAt) {
      claims.set(p.username, 'REVOKED');
    } else if (claim.expiresAt.getTime() <= now.getTime()) {
      claims.set(p.username, 'EXPIRED');
    } else {
      claims.set(p.username, 'ACTIVE');
    }
  }
  const [invite] = await db
    .select({ revokedAt: groupInvites.revokedAt })
    .from(groupInvites)
    .where(eq(groupInvites.tokenHash, hashCapabilityToken(DEMO_GROUP.inviteToken)));
  return { claims, inviteState: !invite ? 'MISSING' : invite.revokedAt ? 'REVOKED' : 'ACTIVE' };
}

/** The LOCAL ONLY claim and group invite links of the seeded fixtures, as printed by the seed. */
export function seedLinkLines(webUrl: string, states: FixtureLinkStates): string[] {
  return [
    `LOCAL ONLY claim links created by ${PLACEHOLDER_CREATOR} (dev fixtures, not secrets):`,
    ...DEMO_PLACEHOLDERS.map(
      (p) =>
        `  [${states.claims.get(p.username) ?? 'REPLACED'}] ${p.username}: ${claimUrlFor(webUrl, p.claimToken)}`,
    ),
    `LOCAL ONLY invite to group "${DEMO_GROUP.name}" (${DEMO_GROUP.owner} OWNER; dev fixture, not a secret) [${states.inviteState}]:`,
    `  link: ${joinUrlFor(webUrl, DEMO_GROUP.inviteToken)}`,
    `  code: ${DEMO_GROUP.inviteCode}`,
  ];
}

// Host-side default: the compose db is published on 5433 (DATABASE_URL in .env targets db:5432).
const DEFAULT_DEV_DATABASE_URL =
  'postgres://sharkulator:sharkulator@localhost:5433/sharkulator_dev';

async function main(): Promise<void> {
  if (process.env.APP_ENV === 'production') {
    throw new Error('The dev seed must never run against production (APP_ENV=production).');
  }
  const db = createDb(process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL);
  try {
    const now = new Date();
    const summary = await runSeed(db, now);
    console.log(
      `Seed complete: ${summary.users} demo users, ${summary.sports} sports, ` +
        `${summary.tournaments} tournaments (${summary.tournamentsWithNewGames} received demo games), ` +
        `${summary.placeholders} invited players (${summary.placeholderGamesAdded} new placeholder games), ` +
        `${summary.achievementsAwarded} historical badges backfilled.`,
    );
    const webUrl = seedPublicWebUrl(process.env, readRootEnv());
    for (const line of seedLinkLines(webUrl, await fixtureLinkStates(db, now))) console.log(line);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
