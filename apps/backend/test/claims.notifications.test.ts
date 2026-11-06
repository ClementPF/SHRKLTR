import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notifications } from '../src/db/schema.js';
import { startTestGoogleJwks, type TestGoogleJwks } from './google-jwks.js';
import {
  authHeadersFor,
  buildTestApp,
  createClaim,
  createPlaceholderUser,
  createPushDevice,
  createUser,
  expoTokenOf,
  truncateAll,
} from './helpers.js';
import { startPushCollector, type PushCollector } from './push-collector.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;

describe('placeholder_claimed notification (VAL-NOTIF-007)', () => {
  let app: FastifyInstance;
  let jwks: TestGoogleJwks;
  let collector: PushCollector;
  let creator: UserRow;
  let bystander: UserRow;
  let placeholder: Awaited<ReturnType<typeof createPlaceholderUser>>;
  let claimToken: string;

  beforeAll(async () => {
    jwks = await startTestGoogleJwks();
    collector = await startPushCollector();
    app = await buildTestApp({ env: { GOOGLE_JWKS_URL: jwks.url, PUSH_URL: collector.url } });
  });

  afterAll(async () => {
    await app.close();
    await collector.close();
    await jwks.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    collector.reset();
    creator = await createUser(app.db, { username: 'alex', googleSub: 'creator-sub' });
    bystander = await createUser(app.db, { username: 'sam', googleSub: 'sam-sub' });
    await createPushDevice(app.db, { userId: creator.id, expoToken: expoTokenOf('alex-phone') });
    await createPushDevice(app.db, { userId: bystander.id, expoToken: expoTokenOf('sam-phone') });
    placeholder = await createPlaceholderUser(app.db, {
      username: 'riley',
      firstName: 'Riley',
      lastName: 'Guest',
      createdByUserId: creator.id,
    });
    ({ token: claimToken } = await createClaim(app.db, {
      placeholderUserId: placeholder.id,
      creatorUserId: creator.id,
    }));
  });

  const signIn = async (sub: string, token?: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: {
        provider: 'google',
        idToken: await jwks.mint({ claims: { sub, name: 'Riley New', email: `${sub}@x.com` } }),
        ...(token === undefined ? {} : { claimToken: token }),
      },
    });

  // The creator's invited_player_claimed badge notification is covered by achievements tests.
  const all = () =>
    app.db.select().from(notifications).where(eq(notifications.type, 'placeholder_claimed'));
  const claimMessages = () =>
    collector
      .messages()
      .filter((m) => (m.data as { target?: { type?: string } }).target?.type === 'user');

  it('notifies the creator once, targeting the retained claimed identity, and pushes it', async () => {
    const res = await signIn('brand-new-sub', claimToken);
    await app.push.drain();

    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(placeholder.id);
    const rows = await all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipientUserId: creator.id,
      type: 'placeholder_claimed',
      category: 'claims',
      subjectUserId: placeholder.id,
    });

    const inbox = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: await authHeadersFor(app, creator.id),
    });
    const claimRows = inbox
      .json()
      .filter((n: { type: string }) => n.type !== 'achievement_unlocked');
    expect(claimRows).toEqual([
      expect.objectContaining({
        type: 'placeholder_claimed',
        category: 'claims',
        title: 'Invite accepted',
        target: { type: 'user', username: 'riley' },
      }),
    ]);
    expect(claimRows[0].body).toContain('claimed their player profile');
    expect(claimRows[0].body).not.toContain(claimToken);

    expect(claimMessages()).toEqual([
      {
        to: expoTokenOf('alex-phone'),
        title: 'Invite accepted',
        body: claimRows[0].body,
        sound: 'default',
        data: { notificationId: rows[0]!.id, target: { type: 'user', username: 'riley' } },
      },
    ]);
    expect(JSON.stringify(collector.received)).not.toContain(claimToken);

    const bystanderInbox = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: await authHeadersFor(app, bystander.id),
    });
    expect(bystanderInbox.json()).toEqual([]);
  });

  it('a claim refused for an existing account adds no notification', async () => {
    const res = await signIn('sam-sub', claimToken);
    await app.push.drain();

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CLAIM_REQUIRES_NEW_ACCOUNT');
    expect(await all()).toHaveLength(0);
    expect(collector.received).toHaveLength(0);
  });

  it('reusing a consumed claim adds no second notification', async () => {
    expect((await signIn('first-sub', claimToken)).statusCode).toBe(200);
    const again = await signIn('second-sub', claimToken);
    await app.push.drain();

    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('CLAIM_INVALID');
    expect(await all()).toHaveLength(1);
    expect(claimMessages()).toHaveLength(1);
  });

  it('ordinary sign-in creates no claim notification', async () => {
    expect((await signIn('creator-sub')).statusCode).toBe(200);
    await app.push.drain();
    expect(await all()).toHaveLength(0);
  });

  it('a disabled claims category keeps the inbox row but sends no push', async () => {
    await app.inject({
      method: 'PUT',
      url: '/users/me/notification-preferences',
      headers: await authHeadersFor(app, creator.id),
      payload: { claims: false },
    });

    await signIn('brand-new-sub', claimToken);
    await app.push.drain();

    expect(
      await app.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, creator.id),
            eq(notifications.type, 'placeholder_claimed'),
          ),
        ),
    ).toHaveLength(1);
    expect(claimMessages()).toHaveLength(0);
    // The achievements category is still enabled, so the creator's badge is pushed.
    expect(collector.messages()).toHaveLength(1);
    expect(collector.messages()[0]?.data).toMatchObject({
      target: { type: 'achievements', username: 'alex' },
    });
  });
});
