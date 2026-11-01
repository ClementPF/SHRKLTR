import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { decodeJwt } from 'jose';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createUser, testEnv, truncateAll } from './helpers.js';
import { TEST_DATABASE_URL } from './test-env.js';

const DEV_AUTH_SECRET = testEnv.DEV_AUTH_SECRET ?? '';

/**
 * These tests force the interleavings deterministically: an external transaction holds the
 * row lock of the token being refreshed, so the refresh request parks inside its transaction.
 * The competing request is started next, and the tests wait (by observing pg_stat_activity)
 * until both requests are blocked on locks before releasing the holder.
 */
describe('refresh family concurrency', () => {
  let app: FastifyInstance;
  let control: postgres.Sql;
  let holder: postgres.ReservedSql | null = null;
  let pending: Promise<unknown>[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
    control = postgres(TEST_DATABASE_URL, { max: 2, onnotice: () => {} });
  });

  afterAll(async () => {
    await control.end({ timeout: 5 });
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
  });

  afterEach(async () => {
    if (holder) {
      await holder`rollback`;
      holder.release();
      holder = null;
    }
    await Promise.allSettled(pending);
    pending = [];
  });

  const refresh = (refreshToken: string) =>
    app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });

  const logout = (refreshToken: string) =>
    app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken } });

  const track = <T>(promise: Promise<T>): Promise<T> => {
    pending.push(promise);
    return promise;
  };

  async function startSession(): Promise<string> {
    await createUser(app.db, { username: 'dev-alex' });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/dev-token',
      headers: { 'x-dev-auth': DEV_AUTH_SECRET },
      payload: { username: 'dev-alex' },
    });
    expect(res.statusCode).toBe(200);
    return res.json<{ refreshToken: string }>().refreshToken;
  }

  /** Opens a transaction that holds the row lock of the given refresh token. */
  async function holdTokenRow(refreshToken: string): Promise<number> {
    const conn = await control.reserve();
    holder = conn;
    await conn`begin`;
    const [row] = await conn<{ pid: number }[]>`
      select pg_backend_pid() as pid from refresh_tokens
      where jti = ${String(decodeJwt(refreshToken).jti)} for update`;
    if (!row) throw new Error('refresh token row not found');
    return row.pid;
  }

  async function releaseHolder(): Promise<void> {
    if (!holder) return;
    const conn = holder;
    holder = null;
    await conn`rollback`;
    conn.release();
  }

  async function waitUntil(description: string, check: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting until ${description}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Backends in this database (excluding the holder) currently waiting on a heavyweight lock. */
  async function lockWaiters(
    holderPid: number,
  ): Promise<{ pid: number; blockedByHolder: boolean }[]> {
    const rows = await control<{ pid: number; blocked_by_holder: boolean }[]>`
      select pid, ${holderPid}::int = any(pg_blocking_pids(pid)) as blocked_by_holder
      from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and pid <> ${holderPid}`;
    return rows.map((r) => ({ pid: r.pid, blockedByHolder: r.blocked_by_holder }));
  }

  /**
   * Parks a refresh of `token` behind the held row lock, starts `competitor`, waits until both
   * are blocked on locks, then releases the holder and returns both responses.
   */
  async function raceAgainstParkedRefresh(
    token: string,
    competitor: () => Promise<LightMyRequestResponse>,
  ): Promise<[LightMyRequestResponse, LightMyRequestResponse]> {
    const holderPid = await holdTokenRow(token);

    const parked = track(refresh(token));
    await waitUntil('the refresh is blocked by the held row lock', async () =>
      (await lockWaiters(holderPid)).some((w) => w.blockedByHolder),
    );

    const competing = track(competitor());
    await waitUntil(
      'the competing request is blocked on a lock',
      async () => (await lockWaiters(holderPid)).length >= 2,
    );
    // The competitor must queue on the family lock, not on a refresh-token row lock.
    const [locks] = await control<{ waiting: number }[]>`
      select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted`;
    expect(locks?.waiting).toBe(1);

    await releaseHolder();
    return Promise.all([parked, competing]);
  }

  it('logout overlapping an in-flight refresh revokes the newly inserted descendant', async () => {
    const token = await startSession();

    const [refreshed, loggedOut] = await raceAgainstParkedRefresh(token, () => logout(token));

    expect(refreshed.statusCode).toBe(200);
    expect(loggedOut.statusCode).toBe(204);
    const descendant = refreshed.json<{ refreshToken: string }>().refreshToken;
    expect(decodeJwt(descendant).familyId).toBe(decodeJwt(token).familyId);

    const attempt = await refresh(descendant);
    expect(attempt.statusCode).toBe(401);
    expect(attempt.json().error.code).toBe('INVALID_REFRESH_TOKEN');

    const [tokens] = await control<{ active: number }[]>`
      select count(*)::int as active from refresh_tokens where revoked_at is null`;
    expect(tokens?.active).toBe(0);
  });

  it('reuse of an ancestor overlapping a descendant refresh revokes the newest descendant', async () => {
    const ancestor = await startSession();
    const first = await refresh(ancestor);
    expect(first.statusCode).toBe(200);
    const child = first.json<{ refreshToken: string }>().refreshToken;

    const [refreshed, reused] = await raceAgainstParkedRefresh(child, () => refresh(ancestor));

    expect(refreshed.statusCode).toBe(200);
    expect(reused.statusCode).toBe(401);
    expect(reused.json().error.code).toBe('INVALID_REFRESH_TOKEN');
    const newest = refreshed.json<{ refreshToken: string }>().refreshToken;
    expect(decodeJwt(newest).familyId).toBe(decodeJwt(ancestor).familyId);

    expect((await refresh(newest)).statusCode).toBe(401);

    const [tokens] = await control<{ total: number; active: number }[]>`
      select count(*)::int as total, count(*) filter (where revoked_at is null)::int as active
      from refresh_tokens`;
    expect(tokens).toEqual({ total: 3, active: 0 });
  });
});
