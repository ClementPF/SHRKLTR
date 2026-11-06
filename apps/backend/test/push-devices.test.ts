import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pushDevices } from '../src/db/schema.js';
import {
  authHeadersFor,
  buildTestApp,
  createNotification,
  createPlaceholderUser,
  createUser,
  expoTokenOf,
  truncateAll,
} from './helpers.js';
import { startPushCollector, type PushCollector } from './push-collector.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;

describe('push device registration (VAL-NOTIF-010, VAL-NOTIF-011)', () => {
  let collector: PushCollector;
  let app: FastifyInstance;
  let alex: UserRow;
  let sam: UserRow;

  beforeAll(async () => {
    collector = await startPushCollector();
    app = await buildTestApp({ env: { PUSH_URL: collector.url } });
  });

  afterAll(async () => {
    await app.close();
    await collector.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    collector.reset();
    alex = await createUser(app.db, { username: 'alex' });
    sam = await createUser(app.db, { username: 'sam' });
  });

  const register = async (
    user: UserRow,
    installationId: string,
    expoToken: string,
    platform = 'IOS',
  ) =>
    app.inject({
      method: 'POST',
      url: '/users/me/push-devices',
      headers: await authHeadersFor(app, user.id),
      payload: { installationId, expoToken, platform },
    });

  const unregister = async (user: UserRow, installationId: string) =>
    app.inject({
      method: 'DELETE',
      url: `/users/me/push-devices/${installationId}`,
      headers: await authHeadersFor(app, user.id),
    });

  const devicesOf = (user: UserRow) =>
    app.db.select().from(pushDevices).where(eq(pushDevices.userId, user.id));

  /** Tokens that receive a push for a fresh notification addressed to the user. */
  async function deliveredTo(user: UserRow): Promise<string[]> {
    collector.reset();
    const subject = await createPlaceholderUser(app.db);
    const row = await createNotification(app.db, {
      recipientUserId: user.id,
      subjectUserId: subject.id,
    });
    app.push.dispatch([row.id]);
    await app.push.drain();
    return collector
      .messages()
      .map((m) => m.to)
      .sort();
  }

  it('registers two installations, and re-registering one does not duplicate it', async () => {
    expect((await register(alex, 'phone', expoTokenOf('phone'))).statusCode).toBe(204);
    expect((await register(alex, 'tablet', expoTokenOf('tablet'), 'ANDROID')).statusCode).toBe(204);
    expect((await register(alex, 'phone', expoTokenOf('phone'))).statusCode).toBe(204);

    const rows = await devicesOf(alex);
    expect(rows.map((r) => [r.installationId, r.platform, r.disabledAt]).sort()).toEqual([
      ['phone', 'IOS', null],
      ['tablet', 'ANDROID', null],
    ]);
    expect(await deliveredTo(alex)).toEqual([expoTokenOf('phone'), expoTokenOf('tablet')]);
  });

  it('accepts the ExpoPushToken[...] form and rejects malformed tokens with INVALID_PUSH_TOKEN', async () => {
    expect((await register(alex, 'a', 'ExpoPushToken[abc]')).statusCode).toBe(204);
    for (const bad of ['', 'not-a-token', 'ExponentPushToken[unterminated', 'https://evil']) {
      const res = await register(alex, 'b', bad);
      expect(res.statusCode, bad).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PUSH_TOKEN');
    }
    expect(await devicesOf(alex)).toHaveLength(1);
  });

  it('validates the body shape', async () => {
    const headers = await authHeadersFor(app, alex.id);
    for (const payload of [
      { installationId: '', expoToken: expoTokenOf('x'), platform: 'IOS' },
      { installationId: 'a'.repeat(201), expoToken: expoTokenOf('x'), platform: 'IOS' },
      { installationId: 'x', expoToken: expoTokenOf('x'), platform: 'WINDOWS' },
      { installationId: 'x', expoToken: expoTokenOf('x') },
      { installationId: 'x', expoToken: expoTokenOf('x'), platform: 'IOS', userId: sam.id },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/users/me/push-devices',
        headers,
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(await devicesOf(alex)).toHaveLength(0);
    expect(await devicesOf(sam)).toHaveLength(0);
  });

  it('unregistering one installation stops its pushes while the other stays eligible', async () => {
    await register(alex, 'phone', expoTokenOf('phone'));
    await register(alex, 'tablet', expoTokenOf('tablet'));

    expect((await unregister(alex, 'phone')).statusCode).toBe(204);

    expect(await deliveredTo(alex)).toEqual([expoTokenOf('tablet')]);
    expect((await unregister(alex, 'phone')).statusCode).toBe(204);
    expect((await unregister(alex, 'never-registered')).statusCode).toBe(204);
  });

  it("another user's unregister request cannot disable the installation", async () => {
    await register(alex, 'phone', expoTokenOf('phone'));

    expect((await unregister(sam, 'phone')).statusCode).toBe(204);

    const [row] = await devicesOf(alex);
    expect(row?.disabledAt).toBeNull();
    expect(await deliveredTo(alex)).toEqual([expoTokenOf('phone')]);
  });

  it('a rotated token replaces the old one for the same installation', async () => {
    await register(alex, 'phone', expoTokenOf('old'));
    await register(alex, 'phone', expoTokenOf('new'));

    const rows = await devicesOf(alex);
    expect(rows.map((r) => r.expoToken)).toEqual([expoTokenOf('new')]);
    expect(await deliveredTo(alex)).toEqual([expoTokenOf('new')]);
  });

  it('account switching moves the token to the new account atomically', async () => {
    await register(alex, 'shared-phone', expoTokenOf('shared'));
    await register(alex, 'laptop', expoTokenOf('alex-laptop'));

    await register(sam, 'shared-phone', expoTokenOf('shared'));

    expect((await devicesOf(alex)).map((r) => r.expoToken)).toEqual([expoTokenOf('alex-laptop')]);
    expect((await devicesOf(sam)).map((r) => [r.installationId, r.expoToken])).toEqual([
      ['shared-phone', expoTokenOf('shared')],
    ]);
    expect(await app.db.select().from(pushDevices)).toHaveLength(2);
    expect(await deliveredTo(alex)).toEqual([expoTokenOf('alex-laptop')]);
    expect(await deliveredTo(sam)).toEqual([expoTokenOf('shared')]);
  });

  it('moving a token to another installation of the same user leaves one row holding it', async () => {
    await register(alex, 'old-install', expoTokenOf('t'));
    await register(alex, 'new-install', expoTokenOf('t'));

    expect((await devicesOf(alex)).map((r) => r.installationId)).toEqual(['new-install']);
    expect(await deliveredTo(alex)).toEqual([expoTokenOf('t')]);
  });

  it('concurrent registrations of one token by two accounts leave a single owner', async () => {
    const results = await Promise.all([
      register(alex, 'phone', expoTokenOf('race')),
      register(sam, 'phone', expoTokenOf('race')),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([204, 204]);
    const rows = await app.db
      .select()
      .from(pushDevices)
      .where(eq(pushDevices.expoToken, expoTokenOf('race')));
    expect(rows).toHaveLength(1);
  });

  it('registration reactivates a previously disabled installation', async () => {
    await register(alex, 'phone', expoTokenOf('phone'));
    await unregister(alex, 'phone');
    expect(await deliveredTo(alex)).toEqual([]);

    await register(alex, 'phone', expoTokenOf('phone'));

    const [row] = await devicesOf(alex);
    expect(row?.disabledAt).toBeNull();
    expect(await deliveredTo(alex)).toEqual([expoTokenOf('phone')]);
  });
});
