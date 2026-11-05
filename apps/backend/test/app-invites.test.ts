import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appInvites, playerClaims, users } from '../src/db/schema.js';
import {
  authHeadersFor,
  buildTestApp,
  createLogCapture,
  createPlaceholderUser,
  createUser,
  truncateAll,
} from './helpers.js';

const WEB_URL = 'http://sharkulator.local.test:19006';
const DAY_MS = 24 * 60 * 60 * 1000;

type UserRow = Awaited<ReturnType<typeof createUser>>;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function tokenOf(url: string): string {
  const prefix = `${WEB_URL}/invite/app/`;
  expect(url.startsWith(prefix)).toBe(true);
  return url.slice(prefix.length);
}

describe('general app invitations', () => {
  let app: FastifyInstance;
  let now: Date;
  const capture = createLogCapture();
  let alex: UserRow;

  beforeAll(async () => {
    app = await buildTestApp({
      env: { PUBLIC_WEB_URL: WEB_URL },
      logger: capture,
      clock: () => now,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    now = new Date();
    await truncateAll(app.db);
    alex = await createUser(app.db, { username: 'alex' });
  });

  const issue = async (caller: UserRow = alex) =>
    app.inject({
      method: 'POST',
      url: '/invites/app',
      headers: await authHeadersFor(app, caller.id),
    });

  const preview = (token: string) =>
    app.inject({ method: 'GET', url: `/invites/app/${encodeURIComponent(token)}` });

  it('VAL-INVITE-005: issues a reusable link on PUBLIC_WEB_URL, storing only its hash', async () => {
    const res = await issue();
    expect(res.statusCode).toBe(201);
    const { url } = res.json<{ url: string }>();
    expect(Object.keys(res.json())).toEqual(['url']);
    const token = tokenOf(url);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);

    const rows = await app.db.select().from(appInvites);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ creatorUserId: alex.id, tokenHash: sha256(token) });
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('VAL-INVITE-007: the link previews publicly, repeatedly, and without expiry', async () => {
    const token = tokenOf((await issue()).json().url);
    const usersBefore = (await app.db.select({ n: count() }).from(users))[0]?.n;

    for (const offsetDays of [0, 0, 31, 400]) {
      now = new Date(Date.now() + offsetDays * DAY_MS);
      const res = await preview(token);
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-robots-tag']).toContain('noindex');
      expect(res.json()).toEqual({
        invitedBy: expect.objectContaining({ id: alex.id, username: 'alex' }),
      });
      expect(res.body).not.toContain('@example.com');
    }
    expect((await app.db.select({ n: count() }).from(users))[0]?.n).toBe(usersBefore);
    expect(await app.db.select().from(playerClaims)).toHaveLength(0);
    expect(await app.db.select().from(appInvites)).toHaveLength(1);
  });

  it('VAL-INVITE-003: reissue invalidates the previous link and keeps one row per creator', async () => {
    const first = tokenOf((await issue()).json().url);
    const second = tokenOf((await issue()).json().url);
    expect(second).not.toBe(first);

    const old = await preview(first);
    expect(old.statusCode).toBe(404);
    expect(old.json()).toEqual({
      error: { code: 'INVITE_NOT_FOUND', message: expect.any(String) },
    });
    expect((await preview(second)).statusCode).toBe(200);
    const rows = await app.db
      .select()
      .from(appInvites)
      .where(eq(appInvites.creatorUserId, alex.id));
    expect(rows).toHaveLength(1);
  });

  it('keeps links per creator independent', async () => {
    const sam = await createUser(app.db, { username: 'sam' });
    const alexToken = tokenOf((await issue()).json().url);
    const samToken = tokenOf((await issue(sam)).json().url);
    expect((await preview(alexToken)).json().invitedBy.username).toBe('alex');
    expect((await preview(samToken)).json().invitedBy.username).toBe('sam');
  });

  it('rejects unknown and revoked links, unauthenticated issuance and placeholder issuers', async () => {
    expect((await preview('unknown-token')).json().error.code).toBe('INVITE_NOT_FOUND');

    const token = tokenOf((await issue()).json().url);
    await app.db.update(appInvites).set({ revokedAt: now });
    expect((await preview(token)).statusCode).toBe(404);

    const anon = await app.inject({ method: 'POST', url: '/invites/app', payload: {} });
    expect(anon.statusCode).toBe(401);

    const placeholder = await createPlaceholderUser(app.db);
    const res = await issue(placeholder);
    expect(res.statusCode).toBe(401);
  });

  it('VAL-INVITE-007: issuance and preview logs never contain the token', async () => {
    capture.lines.length = 0;
    const token = tokenOf((await issue()).json().url);
    await preview(token);
    const output = capture.text();
    expect(output).toContain('/invites/app/[REDACTED]');
    expect(output).not.toContain(token);
  });
});
