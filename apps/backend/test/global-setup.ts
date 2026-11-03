import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { TEST_DATABASE_URL } from './test-env.js';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default async function setup(): Promise<void> {
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    // Start from an empty database so the committed migrations are applied from scratch.
    await sql.unsafe(
      'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
    );
  } catch (err) {
    throw new Error(
      `Cannot reach the test database at ${new URL(TEST_DATABASE_URL).host}. ` +
        'Start it with `docker compose up -d db`.',
      { cause: err },
    );
  } finally {
    await sql.end({ timeout: 5 });
  }

  execFileSync('npx', ['drizzle-kit', 'migrate'], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
