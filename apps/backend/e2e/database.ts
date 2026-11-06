import postgres from 'postgres';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { DATABASE_URL } from './environment.js';

export async function prepareDatabase() {
  const adminUrl = new URL(DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const existing = await admin`SELECT 1 FROM pg_database WHERE datname = 'sharkulator_e2e'`;
    if (existing.length === 0) await admin.unsafe('CREATE DATABASE sharkulator_e2e');
  } finally {
    await admin.end({ timeout: 5 });
  }
  await runMigrations(DATABASE_URL);
}

export async function resetFixtures() {
  const db = createDb(DATABASE_URL);
  try {
    const tables = await db.$client<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    const names = tables.map(({ tablename }) => `"public"."${tablename.replaceAll('"', '""')}"`);
    if (names.length) {
      await db.$client.unsafe(`TRUNCATE ${names.join(', ')} RESTART IDENTITY CASCADE`);
    }
    await runSeed(db);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
