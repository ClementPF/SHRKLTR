import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notificationPreferences, notifications } from '../src/db/schema.js';
import {
  authHeadersFor,
  buildTestApp,
  createNotification,
  createPlaceholderUser,
  createUser,
  truncateAll,
} from './helpers.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;

const HOUR_MS = 60 * 60 * 1000;

describe('notification inbox', () => {
  let app: FastifyInstance;
  let now: Date;
  let alex: UserRow;
  let sam: UserRow;

  beforeAll(async () => {
    app = await buildTestApp({ clock: () => now });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    now = new Date('2026-11-05T12:00:00Z');
    await truncateAll(app.db);
    alex = await createUser(app.db, { username: 'alex' });
    sam = await createUser(app.db, { username: 'sam' });
  });

  const get = async (user: UserRow, url: string) =>
    app.inject({ method: 'GET', url, headers: await authHeadersFor(app, user.id) });

  async function fixtures(recipient: UserRow, specs: { hoursAgo: number; read: boolean }[]) {
    const rows = [];
    for (const spec of specs) {
      const subject = await createPlaceholderUser(app.db);
      rows.push(
        await createNotification(app.db, {
          recipientUserId: recipient.id,
          subjectUserId: subject.id,
          actorUserId: subject.id,
          createdAt: new Date(now.getTime() - spec.hoursAgo * HOUR_MS),
          readAt: spec.read ? new Date(now.getTime() - HOUR_MS / 2) : null,
        }),
      );
    }
    return rows;
  }

  it('lists own notifications newest first with read state and display text', async () => {
    const [older, newest, middle] = await fixtures(alex, [
      { hoursAgo: 30, read: true },
      { hoursAgo: 1, read: false },
      { hoursAgo: 5, read: false },
    ]);
    await fixtures(sam, [{ hoursAgo: 2, read: false }]);

    const res = await get(alex, '/notifications');

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.map((n: { id: string }) => n.id)).toEqual([newest!.id, middle!.id, older!.id]);
    expect(body[0]).toMatchObject({
      type: 'placeholder_claimed',
      category: 'claims',
      title: 'Invite accepted',
      readAt: null,
      target: { type: 'user', username: expect.any(String) },
    });
    expect(body[0].body).toMatch(/claimed their player profile/);
    expect(body[2].readAt).toBe(new Date(now.getTime() - HOUR_MS / 2).toISOString());
  });

  it('paginates with page/pageSize and filters unreadOnly', async () => {
    const rows = await fixtures(
      alex,
      Array.from({ length: 5 }, (_, i) => ({ hoursAgo: i + 1, read: i % 2 === 1 })),
    );

    const page1 = await get(alex, '/notifications?page=1&pageSize=2');
    expect(page1.json().map((n: { id: string }) => n.id)).toEqual([rows[2]!.id, rows[3]!.id]);

    const unread = await get(alex, '/notifications?unreadOnly=true');
    expect(unread.json().map((n: { id: string }) => n.id)).toEqual([
      rows[0]!.id,
      rows[2]!.id,
      rows[4]!.id,
    ]);

    expect((await get(alex, '/notifications?pageSize=101')).statusCode).toBe(400);
    expect((await get(alex, '/notifications?unreadOnly=maybe')).statusCode).toBe(400);
  });

  it('counts only own unread rows', async () => {
    await fixtures(alex, [
      { hoursAgo: 1, read: false },
      { hoursAgo: 2, read: false },
      { hoursAgo: 3, read: true },
    ]);
    await fixtures(sam, [{ hoursAgo: 1, read: false }]);

    expect((await get(alex, '/notifications/unread-count')).json()).toEqual({ count: 2 });
    expect((await get(sam, '/notifications/unread-count')).json()).toEqual({ count: 1 });
  });

  it('shows an explicit empty inbox and a zero count', async () => {
    expect((await get(alex, '/notifications')).json()).toEqual([]);
    expect((await get(alex, '/notifications/unread-count')).json()).toEqual({ count: 0 });
  });

  describe('PUT /notifications/:id/read (VAL-NOTIF-018)', () => {
    it('marks only that row read, idempotently keeping the first readAt', async () => {
      const [first, second] = await fixtures(alex, [
        { hoursAgo: 1, read: false },
        { hoursAgo: 2, read: false },
      ]);
      const headers = await authHeadersFor(app, alex.id);

      const res = await app.inject({
        method: 'PUT',
        url: `/notifications/${first!.id}/read`,
        headers,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: first!.id, readAt: now.toISOString() });

      const firstReadAt = now.toISOString();
      now = new Date(now.getTime() + HOUR_MS);
      const again = await app.inject({
        method: 'PUT',
        url: `/notifications/${first!.id}/read`,
        headers,
        payload: {},
      });
      expect(again.statusCode).toBe(200);
      expect(again.json().readAt).toBe(firstReadAt);

      expect((await get(alex, '/notifications/unread-count')).json()).toEqual({ count: 1 });
      const [stored] = await app.db
        .select()
        .from(notifications)
        .where(eq(notifications.id, second!.id));
      expect(stored?.readAt).toBeNull();
    });

    it("answers 404 NOTIFICATION_NOT_FOUND for another user's row and leaves it unread", async () => {
      const [samsRow] = await fixtures(sam, [{ hoursAgo: 1, read: false }]);

      const res = await app.inject({
        method: 'PUT',
        url: `/notifications/${samsRow!.id}/read`,
        headers: await authHeadersFor(app, alex.id),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOTIFICATION_NOT_FOUND');
      expect((await get(sam, '/notifications/unread-count')).json()).toEqual({ count: 1 });
      expect((await get(alex, '/notifications')).json()).toEqual([]);
    });

    it('answers 404 for an unknown id and 400 for a malformed one', async () => {
      const headers = await authHeadersFor(app, alex.id);
      const unknown = await app.inject({
        method: 'PUT',
        url: '/notifications/00000000-0000-4000-8000-000000000000/read',
        headers,
      });
      expect(unknown.statusCode).toBe(404);
      const malformed = await app.inject({
        method: 'PUT',
        url: '/notifications/not-a-uuid/read',
        headers,
      });
      expect(malformed.statusCode).toBe(400);
    });
  });

  it('POST /notifications/read-all clears only the caller’s unread rows', async () => {
    await fixtures(alex, [
      { hoursAgo: 1, read: false },
      { hoursAgo: 2, read: false },
    ]);
    await fixtures(sam, [{ hoursAgo: 1, read: false }]);

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/read-all',
      headers: await authHeadersFor(app, alex.id),
    });

    expect(res.statusCode).toBe(204);
    expect((await get(alex, '/notifications/unread-count')).json()).toEqual({ count: 0 });
    for (const n of (await get(alex, '/notifications')).json()) {
      expect(n.readAt).toBe(now.toISOString());
    }
    expect((await get(sam, '/notifications/unread-count')).json()).toEqual({ count: 1 });
  });

  it('requires authentication on every inbox route', async () => {
    for (const [method, url] of [
      ['GET', '/notifications'],
      ['GET', '/notifications/unread-count'],
      ['PUT', '/notifications/00000000-0000-4000-8000-000000000000/read'],
      ['POST', '/notifications/read-all'],
      ['GET', '/users/me/notification-preferences'],
      ['PUT', '/users/me/notification-preferences'],
      ['POST', '/users/me/push-devices'],
      ['DELETE', '/users/me/push-devices/abc'],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('notification preferences', () => {
  let app: FastifyInstance;
  let alex: UserRow;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    alex = await createUser(app.db, { username: 'alex' });
  });

  const allTrue = { games: true, challenges: true, achievements: true, claims: true, groups: true };

  const put = async (payload?: unknown) =>
    app.inject({
      method: 'PUT',
      url: '/users/me/notification-preferences',
      headers: await authHeadersFor(app, alex.id),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  const getPrefs = async () =>
    app.inject({
      method: 'GET',
      url: '/users/me/notification-preferences',
      headers: await authHeadersFor(app, alex.id),
    });

  it('treats a missing row as all five categories enabled', async () => {
    const res = await getPrefs();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(allTrue);
    expect(await app.db.select().from(notificationPreferences)).toHaveLength(0);
  });

  it('changes only the given categories and persists them', async () => {
    const first = await put({ games: false, claims: false });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ...allTrue, games: false, claims: false });

    const second = await put({ claims: true, groups: false });
    expect(second.json()).toEqual({ ...allTrue, games: false, groups: false });
    expect((await getPrefs()).json()).toEqual({ ...allTrue, games: false, groups: false });
  });

  it('rejects empty, unknown-key and non-boolean updates with 400', async () => {
    for (const payload of [{}, { email: false }, { games: 'no' }, undefined]) {
      const res = await put(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect((await getPrefs()).json()).toEqual(allTrue);
  });
});
