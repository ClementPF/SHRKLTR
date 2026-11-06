import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notifications, userAchievements, users } from '../src/db/schema.js';
import { startTestGoogleJwks, type TestGoogleJwks } from './google-jwks.js';
import {
  achievementCodesOf,
  authHeadersFor,
  buildTestApp,
  createClaim,
  createPlaceholderUser,
  createPushDevice,
  createTournament,
  createUser,
  expoTokenOf,
  truncateAll,
} from './helpers.js';
import { startPushCollector, type PushCollector } from './push-collector.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;

describe('invited_player_claimed and placeholder badges (VAL-ACH-001, VAL-ACH-007)', () => {
  let app: FastifyInstance;
  let jwks: TestGoogleJwks;
  let collector: PushCollector;
  let creator: UserRow;
  let bystander: UserRow;

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
  });

  const signIn = async (sub: string, claimToken?: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: {
        provider: 'google',
        idToken: await jwks.mint({ claims: { sub, name: 'New Player', email: `${sub}@x.com` } }),
        ...(claimToken === undefined ? {} : { claimToken }),
      },
    });

  const tokenOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);

  async function addPlaceholder(displayName: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/players/placeholders',
      headers: await authHeadersFor(app, creator.id),
      payload: { displayName },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { user: { id: string; username: string }; claimUrl: string };
    return { ...body.user, token: tokenOf(body.claimUrl) };
  }

  it('creating, re-issuing, app invitations and failed claims award nothing', async () => {
    const guest = await addPlaceholder('Riley Guest');
    const rotated = await app.inject({
      method: 'POST',
      url: `/players/${guest.id}/claim-link`,
      headers: await authHeadersFor(app, creator.id),
    });
    expect(rotated.statusCode).toBe(201);
    const appInvite = await app.inject({
      method: 'POST',
      url: '/invites/app',
      headers: await authHeadersFor(app, creator.id),
    });
    expect(appInvite.statusCode).toBe(201);
    const inviteToken = tokenOf((appInvite.json() as { url: string }).url);
    expect(
      (await app.inject({ method: 'GET', url: `/invites/app/${inviteToken}` })).statusCode,
    ).toBe(200);
    // A new account signing up after following the app invitation is not a claim.
    expect((await signIn('invited-by-app-sub')).statusCode).toBe(200);

    const currentToken = tokenOf((rotated.json() as { claimUrl: string }).claimUrl);
    const refused = await signIn('sam-sub', currentToken);
    expect(refused.json().error.code).toBe('CLAIM_REQUIRES_NEW_ACCOUNT');
    const stale = await signIn('stale-link-sub', guest.token);
    expect(stale.json().error.code).toBe('CLAIM_INVALID');
    await app.push.drain();

    expect(await app.db.select().from(userAchievements)).toEqual([]);
    expect(
      await app.db
        .select()
        .from(notifications)
        .where(eq(notifications.type, 'achievement_unlocked')),
    ).toEqual([]);
  });

  it('a successful claim awards the creator only, with an owner-only notification and push', async () => {
    const guest = await addPlaceholder('Riley Guest');

    const res = await signIn('riley-new-sub', guest.token);
    await app.push.drain();

    expect(res.statusCode).toBe(200);
    expect(await achievementCodesOf(app.db, creator.id)).toEqual(['invited_player_claimed']);
    expect(await achievementCodesOf(app.db, guest.id)).toEqual([]);
    expect(await achievementCodesOf(app.db, bystander.id)).toEqual([]);
    const [badge] = await app.db
      .select()
      .from(userAchievements)
      .where(eq(userAchievements.userId, creator.id));
    expect(badge).toMatchObject({ sourceType: 'CLAIM', sourceGameId: null });

    const inbox = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: await authHeadersFor(app, creator.id),
    });
    const unlock = inbox
      .json()
      .find((n: { type: string }) => n.type === 'achievement_unlocked') as Record<string, unknown>;
    expect(unlock).toMatchObject({
      category: 'achievements',
      title: 'Achievement unlocked: Recruiter',
      target: { type: 'achievements', username: 'alex' },
    });
    expect(
      collector
        .messages()
        .map((m) => (m.data as { target: { type: string } }).target.type)
        .sort(),
    ).toEqual(['achievements', 'user']);
  });

  it('a second claimed placeholder of the same creator adds no second badge or notification', async () => {
    const first = await addPlaceholder('Riley Guest');
    const second = await addPlaceholder('Casey Guest');
    expect((await signIn('riley-sub', first.token)).statusCode).toBe(200);
    expect((await signIn('casey-sub', second.token)).statusCode).toBe(200);

    expect(await achievementCodesOf(app.db, creator.id)).toEqual(['invited_player_claimed']);
    const unlocks = await app.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, creator.id),
          eq(notifications.type, 'achievement_unlocked'),
        ),
      );
    expect(unlocks).toHaveLength(1);
  });

  it('badges earned as a placeholder stay on the same identity after the claim', async () => {
    const tournament = await createTournament(app.db);
    const guest = await createPlaceholderUser(app.db, {
      username: 'riley',
      createdByUserId: creator.id,
    });
    const { token } = await createClaim(app.db, {
      placeholderUserId: guest.id,
      creatorUserId: creator.id,
    });
    const game = await app.inject({
      method: 'POST',
      url: `/tournaments/${tournament.name}/games`,
      headers: await authHeadersFor(app, creator.id),
      payload: {
        outcomes: [
          { username: 'riley', result: 'WIN' },
          { username: 'alex', result: 'LOSS' },
        ],
      },
    });
    expect(game.statusCode).toBe(201);
    const [before] = await app.db
      .select()
      .from(userAchievements)
      .where(eq(userAchievements.userId, guest.id));
    expect(before?.achievementCode).toBe('first_win');

    const res = await signIn('riley-sub', token);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ id: guest.id, accountType: 'REGISTERED' });

    const [claimed] = await app.db.select().from(users).where(eq(users.id, guest.id));
    expect(claimed?.accountType).toBe('REGISTERED');
    expect(
      await app.db.select().from(userAchievements).where(eq(userAchievements.userId, guest.id)),
    ).toEqual([before]);
    const view = await app.inject({
      method: 'GET',
      url: '/users/riley/achievements',
      headers: await authHeadersFor(app, guest.id),
    });
    expect(view.json()[0]).toMatchObject({
      code: 'first_win',
      unlocked: true,
      unlockedAt: before!.unlockedAt.toISOString(),
    });
  });
});
