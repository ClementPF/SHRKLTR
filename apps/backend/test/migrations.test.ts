import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { authHeadersFor, buildTestApp } from './helpers.js';
import { TEST_DATABASE_URL } from './test-env.js';

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true }).filter((d) =>
  d.isDirectory(),
);

describe('committed migrations', () => {
  let db: Database;

  beforeAll(() => {
    db = createDb(TEST_DATABASE_URL);
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 5 });
  });

  it('create all 10 tables', async () => {
    const rows = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      'app_invites',
      'games',
      'outcomes',
      'player_claims',
      'refresh_tokens',
      'rivalry_stats',
      'sports',
      'stats',
      'tournaments',
      'users',
    ]);
  });

  it('record every committed migration in the drizzle journal', async () => {
    expect(migrationFolders.length).toBeGreaterThan(0);
    const rows = await db.execute<{ name: string }>(
      sql`select name from drizzle.__drizzle_migrations order by id`,
    );
    expect(rows.map((r) => r.name)).toEqual(migrationFolders.map((d) => d.name).sort());
  });

  it('define the game_result enum', async () => {
    const rows = await db.execute<{ label: string }>(
      sql`select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'game_result' order by e.enumsortorder`,
    );
    expect(rows.map((r) => r.label)).toEqual(['WIN', 'TIE', 'LOSS']);
  });

  it('create the lookup indexes and unique constraints', async () => {
    const rows = await db.execute<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes where schemaname = 'public'`,
    );
    const defs = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(defs.get('games_tournament_date_idx')).toContain('(tournament_id, date DESC');
    expect(defs.get('outcomes_game_idx')).toContain('(game_id)');
    expect(defs.get('outcomes_user_idx')).toContain('(user_id)');
    expect(defs.get('stats_tournament_idx')).toContain('(tournament_id)');
    expect(defs.get('rivalry_stats_tournament_idx')).toContain('(tournament_id)');
    expect(defs.get('tournaments_sport_idx')).toContain('(sport_id)');
    expect(defs.get('stats_user_tournament_unique')).toContain('(user_id, tournament_id)');
    expect(defs.get('rivalry_stats_user_rival_tournament_unique')).toContain(
      '(user_id, rival_id, tournament_id)',
    );
  });

  it('add a nullable outcomes.rating_before snapshot column', async () => {
    const rows = await db.execute<{ data_type: string; is_nullable: string }>(
      sql`select data_type, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'outcomes' and column_name = 'rating_before'`,
    );
    expect(rows).toEqual([{ data_type: 'double precision', is_nullable: 'YES' }]);
  });

  it('add placeholder identity columns, constraints and claim/invite tables', async () => {
    const enumRows = await db.execute<{ label: string }>(
      sql`select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'account_type' order by e.enumsortorder`,
    );
    expect(enumRows.map((r) => r.label)).toEqual(['REGISTERED', 'PLACEHOLDER']);

    const columns = await db.execute<{ column_name: string; is_nullable: string }>(
      sql`select column_name, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'users'
            and column_name in ('google_sub', 'account_type', 'created_by_user_id', 'claimed_at')
          order by column_name`,
    );
    expect(columns).toEqual([
      { column_name: 'account_type', is_nullable: 'NO' },
      { column_name: 'claimed_at', is_nullable: 'YES' },
      { column_name: 'created_by_user_id', is_nullable: 'YES' },
      { column_name: 'google_sub', is_nullable: 'YES' },
    ]);

    const constraints = await db.execute<{ conname: string }>(
      sql`select conname from pg_constraint
          where conname in ('users_account_identity_check',
                            'player_claims_not_consumed_and_revoked_check')
          order by conname`,
    );
    expect(constraints.map((r) => r.conname)).toEqual([
      'player_claims_not_consumed_and_revoked_check',
      'users_account_identity_check',
    ]);

    const indexes = await db.execute<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes where schemaname = 'public'`,
    );
    const defs = new Map(indexes.map((r) => [r.indexname, r.indexdef]));
    expect(defs.get('users_created_by_account_type_idx')).toContain(
      '(created_by_user_id, account_type)',
    );
    expect(defs.get('player_claims_creator_created_idx')).toContain(
      '(creator_user_id, created_at DESC',
    );
    const uniques = [...defs.values()].filter((d) => d.startsWith('CREATE UNIQUE INDEX'));
    for (const expected of [
      'player_claims USING btree (placeholder_user_id)',
      'player_claims USING btree (token_hash)',
      'app_invites USING btree (creator_user_id)',
      'app_invites USING btree (token_hash)',
      'users USING btree (google_sub)',
    ]) {
      expect(uniques.some((d) => d.includes(expected))).toBe(true);
    }
  });

  it('keep the legacy longuest_* column spelling', async () => {
    const rows = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'stats' and column_name like 'longuest_%'
          order by column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'longuest_lose_streak',
      'longuest_tie_streak',
      'longuest_win_streak',
    ]);
  });
});

describe('boot-time migrator (runMigrations)', () => {
  const scratchName = `sharkulator_migrate_${process.pid}`;
  const scratchUrl = (() => {
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${scratchName}`;
    return url.toString();
  })();
  let admin: Database;

  beforeAll(async () => {
    admin = createDb(TEST_DATABASE_URL);
    await admin.execute(sql.raw(`DROP DATABASE IF EXISTS "${scratchName}"`));
    await admin.execute(sql.raw(`CREATE DATABASE "${scratchName}"`));
  });

  afterAll(async () => {
    await admin.execute(sql.raw(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`));
    await admin.$client.end({ timeout: 5 });
  });

  const journal = async (url: string) => {
    const db = createDb(url);
    try {
      const rows = await db.execute<{ name: string }>(
        sql`select name from drizzle.__drizzle_migrations order by id`,
      );
      const tables = await db.execute<{ tablename: string }>(
        sql`select tablename from pg_tables where schemaname = 'public'`,
      );
      return { names: rows.map((r) => r.name), tables: tables.length };
    } finally {
      await db.$client.end({ timeout: 5 });
    }
  };

  it('migrates a fresh database from the committed folder', async () => {
    await runMigrations(scratchUrl);
    const { names, tables } = await journal(scratchUrl);
    expect(names).toEqual(migrationFolders.map((d) => d.name).sort());
    expect(tables).toBe(10);
  });

  it('is a no-op when every migration is already applied', async () => {
    await runMigrations(scratchUrl);
    expect((await journal(scratchUrl)).names).toHaveLength(migrationFolders.length);
  });

  it('accepts a database migrated by drizzle-kit migrate', async () => {
    const before = await journal(TEST_DATABASE_URL);
    await runMigrations(TEST_DATABASE_URL);
    expect(await journal(TEST_DATABASE_URL)).toEqual(before);
  });
});

/** True when err (or its cause chain) is a Postgres CHECK violation of the named constraint. */
function isCheckViolation(err: unknown, constraint: string): boolean {
  let current: unknown = err;
  while (typeof current === 'object' && current !== null) {
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === '23514' && e.constraint_name === constraint) return true;
    current = e.cause;
  }
  return false;
}

describe('M1 migrations on a populated baseline (VAL-GAME-009)', () => {
  const scratchName = `sharkulator_m1_baseline_${process.pid}`;
  const scratchUrl = (() => {
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${scratchName}`;
    return url.toString();
  })();
  const baselineFolder = migrationFolders
    .map((d) => d.name)
    .sort()
    .find((name) => name.endsWith('_init'));
  let admin: Database;
  let db: Database;
  let baselineDir: string;

  beforeAll(async () => {
    if (!baselineFolder) throw new Error('init migration folder not found');
    admin = createDb(TEST_DATABASE_URL);
    await admin.execute(sql.raw(`DROP DATABASE IF EXISTS "${scratchName}"`));
    await admin.execute(sql.raw(`CREATE DATABASE "${scratchName}"`));
    baselineDir = mkdtempSync(join(tmpdir(), 'sharkulator-baseline-'));
    cpSync(join(migrationsDir, baselineFolder), join(baselineDir, baselineFolder), {
      recursive: true,
    });
    await runMigrations(scratchUrl, baselineDir);
    db = createDb(scratchUrl);
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 5 });
    rmSync(baselineDir, { recursive: true, force: true });
    await admin.execute(sql.raw(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`));
    await admin.$client.end({ timeout: 5 });
  });

  const snapshot = async (table: string) =>
    db.execute<Record<string, unknown>>(sql.raw(`select * from "${table}" order by id`));

  it('keeps existing users REGISTERED and every history row intact', async () => {
    await db.execute(sql`
      insert into users (id, google_sub, email, email_verified, first_name, username)
      values ('00000000-0000-4000-8000-000000000001', 'google-alice', 'alice@example.com', true, 'Alice', 'alice'),
             ('00000000-0000-4000-8000-000000000002', 'dev|bob', null, false, 'Bob', 'bob')`);
    await db.execute(sql`
      insert into sports (id, name) values ('00000000-0000-4000-8000-000000000010', 'chess')`);
    await db.execute(sql`
      insert into tournaments (id, name, display_name, sport_id, owner_user_id)
      values ('00000000-0000-4000-8000-000000000020', 'club', 'Club',
              '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001')`);
    await db.execute(sql`
      insert into games (id, tournament_id, date)
      values ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000020',
              '2026-10-01T10:00:00Z')`);
    await db.execute(sql`
      insert into outcomes (id, game_id, user_id, result, score_value)
      values ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000030',
              '00000000-0000-4000-8000-000000000001', 'WIN', 16),
             ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000030',
              '00000000-0000-4000-8000-000000000002', 'LOSS', -16)`);
    await db.execute(sql`
      insert into rivalry_stats (id, user_id, rival_id, tournament_id, score, best_score, worst_score,
                                 game_count, win_count, lose_count)
      values ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000001',
              '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000020',
              16, 16, 0, 1, 1, 0),
             ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-000000000002',
              '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020',
              -16, 0, -16, 1, 0, 1)`);
    await db.execute(sql`
      insert into stats (id, user_id, tournament_id, score, best_score, worst_score, game_count,
                         win_count, lose_count, best_rivalry_id, worst_rivalry_id)
      values ('00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000001',
              '00000000-0000-4000-8000-000000000020', 1016, 1016, 1000, 1, 1, 0,
              '00000000-0000-4000-8000-000000000051', null),
             ('00000000-0000-4000-8000-000000000062', '00000000-0000-4000-8000-000000000002',
              '00000000-0000-4000-8000-000000000020', 984, 1000, 984, 1, 0, 1,
              null, '00000000-0000-4000-8000-000000000052')`);

    const tables = [
      'users',
      'sports',
      'tournaments',
      'games',
      'outcomes',
      'stats',
      'rivalry_stats',
    ];
    const before = Object.fromEntries(
      await Promise.all(tables.map(async (t) => [t, await snapshot(t)] as const)),
    );

    await runMigrations(scratchUrl);

    for (const table of tables) {
      const after = await snapshot(table);
      expect(after).toHaveLength(before[table]!.length);
      after.forEach((row, i) => expect(row).toMatchObject(before[table]![i]!));
    }
    const users = await snapshot('users');
    for (const user of users) {
      expect(user).toMatchObject({
        account_type: 'REGISTERED',
        created_by_user_id: null,
        claimed_at: null,
      });
    }
    expect(users.map((u) => u.google_sub)).toEqual(['google-alice', 'dev|bob']);
    for (const outcome of await snapshot('outcomes')) {
      expect(outcome.rating_before).toBeNull();
    }

    const app = await buildTestApp({ env: { DATABASE_URL: scratchUrl } });
    try {
      const headers = await authHeadersFor(app, '00000000-0000-4000-8000-000000000002');
      const history = await app.inject({ method: 'GET', url: '/users/alice/games', headers });
      expect(history.statusCode).toBe(200);
      expect(history.json()).toEqual([
        expect.objectContaining({
          id: '00000000-0000-4000-8000-000000000030',
          outcomes: [
            expect.objectContaining({
              scoreValue: 16,
              ratingBefore: null,
              user: expect.objectContaining({ username: 'alice', accountType: 'REGISTERED' }),
            }),
            expect.objectContaining({ scoreValue: -16, ratingBefore: null }),
          ],
        }),
      ]);
      const board = await app.inject({ method: 'GET', url: '/tournaments/club/stats', headers });
      expect(board.json().map((s: { score: number }) => s.score)).toEqual([1016, 984]);
      const rivalries = await app.inject({ method: 'GET', url: '/users/bob/rivalries', headers });
      expect(rivalries.json()).toEqual([expect.objectContaining({ score: -16, gameCount: 1 })]);
    } finally {
      await app.close();
    }
  });

  it('enforces the placeholder/registered identity constraint', async () => {
    await db.execute(
      sql`insert into users (username, account_type) values ('guest-ok', 'PLACEHOLDER')`,
    );

    const forbidden = [
      sql`insert into users (username, account_type, email) values ('g1', 'PLACEHOLDER', 'x@y.z')`,
      sql`insert into users (username, account_type, email_verified) values ('g2', 'PLACEHOLDER', true)`,
      sql`insert into users (username, account_type, claimed_at) values ('g3', 'PLACEHOLDER', now())`,
      sql`insert into users (username, account_type, google_sub) values ('g4', 'PLACEHOLDER', 'sub-4')`,
      sql`insert into users (username, account_type) values ('r1', 'REGISTERED')`,
      sql`insert into users (username) values ('r2')`,
    ];
    for (const statement of forbidden) {
      const err = await db.execute(statement).then(
        () => null,
        (e: unknown) => e,
      );
      expect(isCheckViolation(err, 'users_account_identity_check')).toBe(true);
    }

    await db.execute(
      sql`insert into users (username, account_type, google_sub, claimed_at)
          values ('claimed-ok', 'REGISTERED', 'sub-claimed', now())`,
    );
  });
});
