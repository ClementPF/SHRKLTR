import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

// Resolves to apps/backend/drizzle from both src/db (tsx) and dist/db (compiled build).
export const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/**
 * Applies the committed drizzle migrations that the database has not recorded yet. Uses its own
 * single-connection client so it can run before the app's pool exists. Idempotent.
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<void> {
  const db = drizzle({
    connection: { url: connectionString, max: 1, connect_timeout: 5, onnotice: () => {} },
  });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
