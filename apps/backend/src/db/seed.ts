import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { count, eq, inArray } from 'drizzle-orm';
import { createDb, type Database } from './client.js';
import { games, outcomes, rivalryStats, sports, stats, tournaments, users } from './schema.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DecisiveResult = 'WIN' | 'LOSS';

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

export const DEMO_SPORTS: readonly string[] = ['babyfoot', 'ping-pong', 'chess'];

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
];

export function tournamentSlug(displayName: string): string {
  return displayName.replace(/\s+/g, '').toLowerCase();
}

interface StatLine {
  score: number;
  bestScore: number;
  worstScore: number;
  gameCount: number;
  winCount: number;
  loseCount: number;
  tieCount: number;
  winStreak: number;
  loseStreak: number;
  tieStreak: number;
  longuestWinStreak: number;
  longuestLoseStreak: number;
  longuestTieStreak: number;
}

function newStatLine(initialScore: number): StatLine {
  return {
    score: initialScore,
    bestScore: initialScore,
    worstScore: initialScore,
    gameCount: 0,
    winCount: 0,
    loseCount: 0,
    tieCount: 0,
    winStreak: 0,
    loseStreak: 0,
    tieStreak: 0,
    longuestWinStreak: 0,
    longuestLoseStreak: 0,
    longuestTieStreak: 0,
  };
}

function applyOutcome(line: StatLine, result: DecisiveResult, delta: number): void {
  line.score += delta;
  line.bestScore = Math.max(line.bestScore, line.score);
  line.worstScore = Math.min(line.worstScore, line.score);
  line.gameCount += 1;
  line.tieStreak = 0;
  if (result === 'WIN') {
    line.winCount += 1;
    line.winStreak += 1;
    line.loseStreak = 0;
    line.longuestWinStreak = Math.max(line.longuestWinStreak, line.winStreak);
  } else {
    line.loseCount += 1;
    line.loseStreak += 1;
    line.winStreak = 0;
    line.longuestLoseStreak = Math.max(line.longuestLoseStreak, line.loseStreak);
  }
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** Elo delta for the winning side (K=32, team ratings averaged, no rounding). */
function winnerDelta(winnerRatings: number[], loserRatings: number[]): number {
  const expected = 1 / (1 + 10 ** ((mean(loserRatings) - mean(winnerRatings)) / 400));
  return 32 * (1 - expected);
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
}

function requireId(ids: Map<string, string>, key: string): string {
  const id = ids.get(key);
  if (!id) throw new Error(`seed references unknown key "${key}"`);
  return id;
}

/** Inserts the demo games of one tournament and the stats/rivalries they imply. */
async function seedTournamentGames(
  tx: Transaction,
  tournamentId: string,
  demoGames: readonly DemoGame[],
  userIds: Map<string, string>,
  now: Date,
): Promise<void> {
  const statLines = new Map<string, StatLine>();
  const rivalryLines = new Map<string, { userId: string; rivalId: string; line: StatLine }>();

  for (const demo of demoGames) {
    const winners = demo.winners.map((u) => requireId(userIds, u));
    const losers = demo.losers.map((u) => requireId(userIds, u));
    const lineFor = (userId: string) => getOrCreate(statLines, userId, () => newStatLine(1000));
    const delta = winnerDelta(
      winners.map((id) => lineFor(id).score),
      losers.map((id) => lineFor(id).score),
    );

    const [gameRow] = await tx
      .insert(games)
      .values({ tournamentId, date: new Date(now.getTime() - demo.hoursAgo * 3_600_000) })
      .returning({ id: games.id });
    if (!gameRow) throw new Error('game insert returned no row');

    const participants: {
      userId: string;
      result: DecisiveResult;
      value: number;
      rivals: string[];
    }[] = [
      ...winners.map((userId) => ({
        userId,
        result: 'WIN' as const,
        value: delta,
        rivals: losers,
      })),
      ...losers.map((userId) => ({
        userId,
        result: 'LOSS' as const,
        value: -delta,
        rivals: winners,
      })),
    ];

    await tx.insert(outcomes).values(
      participants.map((p) => ({
        gameId: gameRow.id,
        userId: p.userId,
        result: p.result,
        scoreValue: p.value,
      })),
    );

    for (const p of participants) {
      applyOutcome(lineFor(p.userId), p.result, p.value);
      for (const rivalId of p.rivals) {
        const rivalry = getOrCreate(rivalryLines, `${p.userId}:${rivalId}`, () => ({
          userId: p.userId,
          rivalId,
          line: newStatLine(0),
        }));
        applyOutcome(rivalry.line, p.result, p.value);
      }
    }
  }

  const rivalryRows = [...rivalryLines.values()].map((r) => ({
    id: randomUUID(),
    tournamentId,
    userId: r.userId,
    rivalId: r.rivalId,
    ...r.line,
  }));
  if (rivalryRows.length > 0) await tx.insert(rivalryStats).values(rivalryRows);

  const statRows = [...statLines.entries()].map(([userId, line]) => {
    const own = rivalryRows.filter((r) => r.userId === userId);
    const best = own
      .filter((r) => r.score > 0)
      .reduce<(typeof own)[number] | null>(
        (acc, r) => (acc && acc.score >= r.score ? acc : r),
        null,
      );
    const worst = own
      .filter((r) => r.score < 0)
      .reduce<(typeof own)[number] | null>(
        (acc, r) => (acc && acc.score <= r.score ? acc : r),
        null,
      );
    return {
      userId,
      tournamentId,
      ...line,
      bestRivalryId: best?.id ?? null,
      worstRivalryId: worst?.id ?? null,
    };
  });
  if (statRows.length > 0) await tx.insert(stats).values(statRows);
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
