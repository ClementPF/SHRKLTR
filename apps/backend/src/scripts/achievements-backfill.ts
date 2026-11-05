import { pathToFileURL } from 'node:url';
import { asc, gt, sql, type SQL } from 'drizzle-orm';
import {
  GAME_COUNT_THRESHOLDS,
  SPORT_COUNT_THRESHOLDS,
  WIN_STREAK_THRESHOLDS,
  type AchievementCode,
  type Thresholds,
} from '../achievements/catalog.js';
import { createDb, type Database, type Transaction } from '../db/client.js';
import { users } from '../db/schema.js';

/**
 * Codes derivable from retained history. giant_killer needs pre-game ratings that historical
 * outcomes do not have, and challenge/group/claim badges need events that were never recorded.
 */
export const BACKFILL_CODES = [
  'first_win',
  'win_streak_3',
  'win_streak_5',
  'win_streak_10',
  'games_10',
  'games_50',
  'games_100',
  'explorer_3',
  'explorer_5',
] as const satisfies readonly AchievementCode[];

export type BackfillCode = (typeof BACKFILL_CODES)[number];

export interface BackfillOptions {
  /** Report what would be awarded without writing anything. */
  dryRun: boolean;
  /** Unlock time for badges whose qualifying moment is unknown (win streaks). */
  now: Date;
  batchSize?: number;
}

export interface BackfillReport {
  dryRun: boolean;
  usersScanned: number;
  batches: number;
  /** Badges proposed (dry run) or actually inserted (apply), per code. */
  awards: Record<BackfillCode, number>;
}

export const DEFAULT_BATCH_SIZE = 500;

function thresholdValues(thresholds: Thresholds): SQL {
  return sql.join(
    thresholds.map(([min, code]) => sql`(${min}::int, ${code}::text)`),
    sql`, `,
  );
}

/**
 * Qualifying (user_id, code, unlocked_at, source_game_id) rows for users with ids in
 * [first, last]. Counted badges unlock at the date of the game that reached the threshold;
 * win streaks come from the stored longest streak per tournament, unlocked at the backfill time.
 */
function candidatesQuery(first: string, last: string, now: Date): SQL {
  return sql`
    with batch as (
      select id as user_id from users where id between ${first}::uuid and ${last}::uuid
    ),
    first_win as (
      select distinct on (o.user_id) o.user_id, 'first_win'::text as code,
             g.date as unlocked_at, g.id as source_game_id
      from outcomes o
      join games g on g.id = o.game_id
      where o.result = 'WIN' and o.user_id in (select user_id from batch)
      order by o.user_id, g.date, g.id
    ),
    played as (
      select p.user_id, g.id as game_id, g.date,
             row_number() over (partition by p.user_id order by g.date, g.id) as n
      from (
        select distinct user_id, game_id from outcomes
        where user_id in (select user_id from batch)
      ) p
      join games g on g.id = p.game_id
    ),
    game_counts as (
      select played.user_id, t.code, played.date as unlocked_at, played.game_id as source_game_id
      from played
      join (values ${thresholdValues(GAME_COUNT_THRESHOLDS)}) as t(min, code) on played.n = t.min
    ),
    first_per_sport as (
      select distinct on (o.user_id, tr.sport_id) o.user_id, g.id as game_id, g.date
      from outcomes o
      join games g on g.id = o.game_id
      join tournaments tr on tr.id = g.tournament_id
      where o.user_id in (select user_id from batch)
      order by o.user_id, tr.sport_id, g.date, g.id
    ),
    sports_ranked as (
      select user_id, game_id, date,
             row_number() over (partition by user_id order by date, game_id) as n
      from first_per_sport
    ),
    sport_counts as (
      select s.user_id, t.code, s.date as unlocked_at, s.game_id as source_game_id
      from sports_ranked s
      join (values ${thresholdValues(SPORT_COUNT_THRESHOLDS)}) as t(min, code) on s.n = t.min
    ),
    longest as (
      select user_id, max(longuest_win_streak) as best from stats
      where user_id in (select user_id from batch)
      group by user_id
    ),
    streaks as (
      select l.user_id, t.code, ${now.toISOString()}::timestamptz as unlocked_at,
             null::uuid as source_game_id
      from longest l
      join (values ${thresholdValues(WIN_STREAK_THRESHOLDS)}) as t(min, code) on l.best >= t.min
    ),
    candidates as (
      select * from first_win
      union all select * from game_counts
      union all select * from sport_counts
      union all select * from streaks
    )
  `;
}

type CodeCount = { code: string; n: number };

function proposeBatch(tx: Transaction, first: string, last: string, now: Date) {
  return tx.execute<CodeCount>(sql`
    ${candidatesQuery(first, last, now)}
    select c.code, count(*)::int as n
    from candidates c
    where not exists (
      select 1 from user_achievements ua
      where ua.user_id = c.user_id and ua.achievement_code = c.code
    )
    group by c.code
  `);
}

function applyBatch(tx: Transaction, first: string, last: string, now: Date) {
  return tx.execute<CodeCount>(sql`
    ${candidatesQuery(first, last, now)},
    inserted as (
      insert into user_achievements
        (user_id, achievement_code, unlocked_at, source_type, source_game_id)
      select user_id, code, unlocked_at, 'BACKFILL', source_game_id from candidates
      order by user_id, code
      on conflict (user_id, achievement_code) do nothing
      returning achievement_code
    )
    select achievement_code as code, count(*)::int as n from inserted group by achievement_code
  `);
}

/**
 * Awards historical badges in bounded batches of users. Idempotent (insert-once per user and
 * code, so existing unlock dates are kept) and silent: no inbox rows and no push. Never touches
 * games, outcomes, ratings, stats or rivalries. A dry run uses read-only transactions.
 */
export async function runAchievementsBackfill(
  db: Database,
  opts: BackfillOptions,
): Promise<BackfillReport> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const awards = Object.fromEntries(BACKFILL_CODES.map((code) => [code, 0])) as Record<
    BackfillCode,
    number
  >;
  const report: BackfillReport = { dryRun: opts.dryRun, usersScanned: 0, batches: 0, awards };

  let after: string | null = null;
  for (;;) {
    const ids: { id: string }[] = await db
      .select({ id: users.id })
      .from(users)
      .where(after === null ? undefined : gt(users.id, after))
      .orderBy(asc(users.id))
      .limit(batchSize);
    const first = ids[0]?.id;
    const last: string | undefined = ids[ids.length - 1]?.id;
    if (first === undefined || last === undefined) break;

    const counts = await db.transaction(async (tx) => {
      if (opts.dryRun) {
        await tx.execute(sql`set transaction read only`);
        return proposeBatch(tx, first, last, opts.now);
      }
      return applyBatch(tx, first, last, opts.now);
    });
    for (const { code, n } of counts) {
      if (code in awards) awards[code as BackfillCode] += n;
    }
    report.usersScanned += ids.length;
    report.batches += 1;
    after = last;
  }
  return report;
}

export function formatBackfillReport(report: BackfillReport): string {
  const verb = report.dryRun ? 'would award' : 'awarded';
  const mode = report.dryRun ? 'DRY RUN, nothing written' : 'applied';
  return [
    `Achievements backfill (${mode}): ${report.usersScanned} users in ${report.batches} batch(es).`,
    ...BACKFILL_CODES.map((code) => `  ${code}: ${verb} ${report.awards[code]}`),
  ].join('\n');
}

export function parseBackfillArgs(argv: readonly string[]): {
  dryRun: boolean;
  batchSize: number;
} {
  let dryRun = false;
  let batchSize = DEFAULT_BATCH_SIZE;
  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--batch-size=')) {
      const value = Number(arg.slice('--batch-size='.length));
      if (!Number.isInteger(value) || value < 1 || value > 10_000) {
        throw new Error('--batch-size must be an integer between 1 and 10000');
      }
      batchSize = value;
    } else {
      throw new Error(
        `Unknown argument "${arg}". Usage: achievements:backfill [--dry-run] [--batch-size=N]`,
      );
    }
  }
  return { dryRun, batchSize };
}

// Host-side default: the compose db is published on 5433 (DATABASE_URL in .env targets db:5432).
const DEFAULT_DEV_DATABASE_URL =
  'postgres://sharkulator:sharkulator@localhost:5433/sharkulator_dev';

async function main(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(2));
  const db = createDb(process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL);
  try {
    const report = await runAchievementsBackfill(db, { ...args, now: new Date() });
    console.log(formatBackfillReport(report));
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
