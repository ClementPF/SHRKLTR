import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { count, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { playerClaims, refreshTokens, users } from '../src/db/schema.js';
import { googleSubjectLockKey } from '../src/services/google-account.service.js';
import { startTestGoogleJwks, type TestGoogleJwks } from './google-jwks.js';
import { authHeadersFor, buildTestApp, createUser, truncateAll } from './helpers.js';
import { TEST_DATABASE_URL } from './test-env.js';

/**
 * Interleavings are forced deterministically: an external transaction holds the lock the
 * requests need, both requests are started and observed waiting in pg_stat_activity, then the
 * holder is released. Postgres grants queued locks in arrival order.
 */
describe('claim concurrency (VAL-CLAIM-016)', () => {
  let app: FastifyInstance;
  let jwks: TestGoogleJwks;
  let control: postgres.Sql;
  let holder: postgres.ReservedSql | null = null;
  let pending: Promise<unknown>[] = [];
  let placeholderId: string;
  let claimToken: string;

  beforeAll(async () => {
    jwks = await startTestGoogleJwks();
    app = await buildTestApp({ env: { GOOGLE_JWKS_URL: jwks.url } });
    await app.ready();
    control = postgres(TEST_DATABASE_URL, { max: 2, onnotice: () => {} });
  });

  afterAll(async () => {
    await control.end({ timeout: 5 });
    await app.close();
    await jwks.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    const creator = await createUser(app.db, { username: 'alex' });
    const res = await app.inject({
      method: 'POST',
      url: '/players/placeholders',
      headers: await authHeadersFor(app, creator.id),
      payload: { displayName: 'Riley Guest' },
    });
    expect(res.statusCode).toBe(201);
    placeholderId = res.json().user.id;
    claimToken = res.json<{ claimUrl: string }>().claimUrl.split('/invite/claim/')[1] ?? '';
  });

  afterEach(async () => {
    await releaseHolder();
    await Promise.allSettled(pending);
    pending = [];
  });

  const signIn = async (sub: string, token?: string) => {
    const promise = app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: {
        provider: 'google',
        idToken: await jwks.mint({ claims: { sub, name: 'Racing Person' } }),
        ...(token === undefined ? {} : { claimToken: token }),
      },
    });
    pending.push(promise);
    return promise;
  };

  async function hold(statement: (conn: postgres.ReservedSql) => Promise<unknown>) {
    const conn = await control.reserve();
    holder = conn;
    await conn`begin`;
    await statement(conn);
    const [row] = await conn<{ pid: number }[]>`select pg_backend_pid() as pid`;
    if (!row) throw new Error('no backend pid');
    return row.pid;
  }

  async function releaseHolder(): Promise<void> {
    if (!holder) return;
    const conn = holder;
    holder = null;
    await conn`rollback`;
    conn.release();
  }

  async function waitForLockWaiters(holderPid: number, n: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const [row] = await control<{ waiting: number }[]>`
        select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and pid <> ${holderPid}`;
      if ((row?.waiting ?? 0) >= n) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} lock waiters`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Starts each request in order, each parked behind the held lock, then releases it. */
  async function race(
    holderPid: number,
    requests: (() => Promise<LightMyRequestResponse>)[],
  ): Promise<LightMyRequestResponse[]> {
    const started: Promise<LightMyRequestResponse>[] = [];
    for (const [i, start] of requests.entries()) {
      started.push(start());
      await waitForLockWaiters(holderPid, i + 1);
    }
    await releaseHolder();
    return Promise.all(started);
  }

  const holdSubject = (sub: string) =>
    hold(
      (conn) =>
        conn`select pg_advisory_xact_lock(hashtextextended(${googleSubjectLockKey(sub)}, 0))`,
    );

  const usersWithSub = async (sub: string) =>
    app.db.select().from(users).where(eq(users.googleSub, sub));
  const claim = async () =>
    (
      await app.db
        .select()
        .from(playerClaims)
        .where(eq(playerClaims.placeholderUserId, placeholderId))
    )[0];
  const placeholder = async () =>
    (await app.db.select().from(users).where(eq(users.id, placeholderId)))[0];
  const userCount = async () => (await app.db.select({ n: count() }).from(users))[0]?.n;

  it('two new subjects claiming one placeholder: exactly one binding succeeds', async () => {
    const usersBefore = await userCount();
    const pid = await hold(
      (conn) => conn`select id from users where id = ${placeholderId} for update`,
    );

    const [first, second] = await race(pid, [
      () => signIn('racer-a', claimToken),
      () => signIn('racer-b', claimToken),
    ]);

    expect(first?.statusCode).toBe(200);
    expect(first?.json().user.id).toBe(placeholderId);
    expect(second?.statusCode).toBe(400);
    expect(second?.json().error.code).toBe('CLAIM_INVALID');

    expect(await placeholder()).toMatchObject({ googleSub: 'racer-a', accountType: 'REGISTERED' });
    expect(await usersWithSub('racer-b')).toHaveLength(0);
    expect(await userCount()).toBe(usersBefore);
    expect(await app.db.select().from(refreshTokens)).toHaveLength(1);
    expect((await claim())?.consumedAt).not.toBeNull();
  });

  it('claim queued before an ordinary signup of the same subject: both resolve to the placeholder', async () => {
    const usersBefore = await userCount();
    const pid = await holdSubject('shared-sub');

    const [claimed, signedUp] = await race(pid, [
      () => signIn('shared-sub', claimToken),
      () => signIn('shared-sub'),
    ]);

    expect(claimed?.statusCode).toBe(200);
    expect(claimed?.json().user.id).toBe(placeholderId);
    expect(signedUp?.statusCode).toBe(200);
    expect(signedUp?.json().user.id).toBe(placeholderId);
    expect(await usersWithSub('shared-sub')).toHaveLength(1);
    expect(await userCount()).toBe(usersBefore);
    expect((await claim())?.consumedAt).not.toBeNull();
  });

  it('ordinary signup queued before a claim of the same subject: the claim is refused intact', async () => {
    const usersBefore = await userCount();
    const pid = await holdSubject('shared-sub');

    const [signedUp, claimed] = await race(pid, [
      () => signIn('shared-sub'),
      () => signIn('shared-sub', claimToken),
    ]);

    expect(signedUp?.statusCode).toBe(200);
    expect(signedUp?.json().user.id).not.toBe(placeholderId);
    expect(claimed?.statusCode).toBe(400);
    expect(claimed?.json().error.code).toBe('CLAIM_REQUIRES_NEW_ACCOUNT');

    expect(await usersWithSub('shared-sub')).toHaveLength(1);
    expect(await userCount()).toBe((usersBefore ?? 0) + 1);
    expect(await placeholder()).toMatchObject({ accountType: 'PLACEHOLDER', googleSub: null });
    expect((await claim())?.consumedAt).toBeNull();
    expect(await app.db.select().from(refreshTokens)).toHaveLength(1);
  });

  it('unforced concurrent signup and claim never duplicate the subject', async () => {
    const results = await Promise.all([
      signIn('free-for-all', claimToken),
      signIn('free-for-all'),
      signIn('free-for-all'),
    ]);
    const rows = await usersWithSub('free-for-all');
    expect(rows).toHaveLength(1);
    const winnerId = rows[0]?.id;
    for (const res of results) {
      if (res.statusCode === 200) expect(res.json().user.id).toBe(winnerId);
      else expect(res.json().error.code).toBe('CLAIM_REQUIRES_NEW_ACCOUNT');
    }
    const consumed = (await claim())?.consumedAt !== null;
    expect(consumed).toBe(winnerId === placeholderId);
  });
});
