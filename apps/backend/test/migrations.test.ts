import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../src/db/client.js';
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

  it('create all 8 tables', async () => {
    const rows = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      'games',
      'outcomes',
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
