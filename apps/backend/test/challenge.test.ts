import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeadersFor, buildTestApp, createUser, truncateAll } from './helpers.js';
import { startPushCollector, type PushCollector } from './push-collector.js';

const TOKEN = 'ExponentPushToken[target-device]';

describe('VAL-USERS-005: POST /users/:username/challenge', () => {
  let collector: PushCollector;
  let app: FastifyInstance;

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
  });

  async function challenge(callerId: string, target: string, payload: object = {}) {
    return app.inject({
      method: 'POST',
      url: `/users/${target}/challenge`,
      headers: await authHeadersFor(app, callerId),
      payload,
    });
  }

  it('sends the Expo push payload to the target token', async () => {
    const challenger = await createUser(app.db, { username: 'jean-dupont', firstName: 'Jean' });
    await createUser(app.db, { username: 'marie', pushToken: TOKEN });

    const res = await challenge(challenger.id, 'marie', { message: 'Babyfoot at 6?' });

    expect(res.statusCode).toBe(204);
    expect(collector.received).toHaveLength(1);
    const [push] = collector.received;
    expect(push?.method).toBe('POST');
    expect(push?.headers['content-type']).toContain('application/json');
    expect(push?.body).toEqual({
      to: TOKEN,
      title: 'Jean is challenging you.',
      body: 'Babyfoot at 6?',
      sound: 'default',
      data: {
        title: 'Jean is challenging you.',
        message: 'Babyfoot at 6?',
        payload: { type: 'challenge', challenger: 'jean-dupont' },
      },
    });
  });

  it('uses the default message when none is supplied', async () => {
    const challenger = await createUser(app.db, { firstName: 'Jean' });
    const target = await createUser(app.db, { pushToken: TOKEN });

    const res = await challenge(challenger.id, target.username);

    expect(res.statusCode).toBe(204);
    expect(collector.received[0]?.body).toMatchObject({
      title: 'Jean is challenging you.',
      body: 'I demand a trial by combat.',
    });
  });

  it('falls back to the username when the challenger has no first name', async () => {
    const challenger = await createUser(app.db, { username: 'nameless', firstName: null });
    const target = await createUser(app.db, { pushToken: TOKEN });

    const res = await challenge(challenger.id, target.username);

    expect(res.statusCode).toBe(204);
    expect(collector.received[0]?.body).toMatchObject({ title: 'nameless is challenging you.' });
  });

  it('accepts an explicit challenger equal to the authenticated user', async () => {
    const challenger = await createUser(app.db, { username: 'jean', firstName: 'Jean' });
    const target = await createUser(app.db, { pushToken: TOKEN });

    const res = await challenge(challenger.id, target.username, { challenger: 'jean' });

    expect(res.statusCode).toBe(204);
    expect(collector.received).toHaveLength(1);
  });

  it('rejects a challenger other than the authenticated user with 403', async () => {
    const caller = await createUser(app.db, { username: 'caller' });
    await createUser(app.db, { username: 'impersonated' });
    const target = await createUser(app.db, { pushToken: TOKEN });

    const res = await challenge(caller.id, target.username, { challenger: 'impersonated' });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(collector.received).toHaveLength(0);
  });

  it('rejects a target without a push token with 400', async () => {
    const caller = await createUser(app.db);
    const target = await createUser(app.db, { pushToken: null });

    const res = await challenge(caller.id, target.username);

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PUSH_TOKEN_MISSING');
    expect(collector.received).toHaveLength(0);
  });

  it('returns 404 for an unknown target', async () => {
    const caller = await createUser(app.db);

    const res = await challenge(caller.id, 'nobody-here');

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('USER_NOT_FOUND');
    expect(collector.received).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'POST', url: '/users/marie/challenge', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an empty message with 400', async () => {
    const caller = await createUser(app.db);
    const target = await createUser(app.db, { pushToken: TOKEN });

    const res = await challenge(caller.id, target.username, { message: '' });

    expect(res.statusCode).toBe(400);
    expect(collector.received).toHaveLength(0);
  });

  it('still succeeds when the push API answers with an error status', async () => {
    collector.respondWith(500);
    const caller = await createUser(app.db);
    const target = await createUser(app.db, { pushToken: TOKEN });

    const res = await challenge(caller.id, target.username);

    expect(res.statusCode).toBe(204);
    expect(collector.received).toHaveLength(1);
  });

  it('still succeeds when the push API reports a ticket error', async () => {
    collector.respondWith(200, { data: { status: 'error', message: 'DeviceNotRegistered' } });
    const caller = await createUser(app.db);
    const target = await createUser(app.db, { pushToken: TOKEN });

    const res = await challenge(caller.id, target.username);

    expect(res.statusCode).toBe(204);
  });
});

describe('challenge with an unreachable push API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ env: { PUSH_URL: 'http://127.0.0.1:1/push' } });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
  });

  it('swallows the delivery error and returns 204', async () => {
    const caller = await createUser(app.db);
    const target = await createUser(app.db, { pushToken: TOKEN });

    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.username}/challenge`,
      headers: await authHeadersFor(app, caller.id),
      payload: {},
    });

    expect(res.statusCode).toBe(204);
  });
});
