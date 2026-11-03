import { pathToFileURL } from 'node:url';
import { count, eq, inArray } from 'drizzle-orm';
import { recordGame } from '../services/game.service.js';
import { createDb, type Database, type Transaction } from './client.js';
import { games, sports, tournaments, users } from './schema.js';

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

    return {
      users: userRows.length,
      sports: sportRows.length,
      tournaments: DEMO_TOURNAMENTS.length,
      tournamentsWithNewGames,
    };
  });
}

// Host-side default: the compose db is published on 5433 (DATABASE_URL in .env targets db:5432).
const DEFAULT_DEV_DATABASE_URL =
  'postgres://sharkulator:sharkulator@localhost:5433/sharkulator_dev';

async function main(): Promise<void> {
  const db = createDb(process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL);
  try {
    const summary = await runSeed(db);
    console.log(
      `Seed complete: ${summary.users} demo users, ${summary.sports} sports, ` +
        `${summary.tournaments} tournaments (${summary.tournamentsWithNewGames} received demo games).`,
    );
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
