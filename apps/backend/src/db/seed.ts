import { pathToFileURL } from 'node:url';
import { count, eq, inArray } from 'drizzle-orm';
import { hashCapabilityToken } from '../lib/capability-token.js';
import { recordGame } from '../services/game.service.js';
import { claimUrlFor } from '../services/placeholder.service.js';
import { createDb, type Database, type Transaction } from './client.js';
import { games, outcomes, playerClaims, sports, tournaments, users } from './schema.js';

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

export interface SeedSummary {
  users: number;
  sports: number;
  tournaments: number;
  tournamentsWithNewGames: number;
  placeholders: number;
  placeholderGamesAdded: number;
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
 * Idempotent: rows are keyed by their unique natural keys (username, sport name, tournament
 * slug), and a tournament only receives demo games while it has none.
 */
export async function runSeed(db: Database, now: Date = new Date()): Promise<SeedSummary> {
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

    await tx
      .insert(tournaments)
      .values(
        DEMO_TOURNAMENTS.map((t) => ({
          name: tournamentSlug(t.displayName),
          displayName: t.displayName,
          sportId: requireId(sportIds, t.sport),
          ownerUserId: requireId(userIds, t.owner),
        })),
      )
      .onConflictDoNothing();

    let tournamentsWithNewGames = 0;
    for (const demo of DEMO_TOURNAMENTS) {
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

    return {
      users: userRows.length,
      sports: sportRows.length,
      tournaments: DEMO_TOURNAMENTS.length,
      tournamentsWithNewGames,
      placeholders: placeholders.placeholders,
      placeholderGamesAdded: placeholders.gamesAdded,
    };
  });
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
    const summary = await runSeed(db);
    console.log(
      `Seed complete: ${summary.users} demo users, ${summary.sports} sports, ` +
        `${summary.tournaments} tournaments (${summary.tournamentsWithNewGames} received demo games), ` +
        `${summary.placeholders} invited players (${summary.placeholderGamesAdded} new placeholder games).`,
    );
    const webUrl = (process.env.PUBLIC_WEB_URL ?? 'http://localhost:8081').replace(/\/+$/, '');
    console.log(
      `LOCAL ONLY claim links created by ${PLACEHOLDER_CREATOR} (dev fixtures, not secrets):`,
    );
    for (const p of DEMO_PLACEHOLDERS) {
      console.log(`  [${p.state}] ${p.username}: ${claimUrlFor(webUrl, p.claimToken)}`);
    }
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
