import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { outcomes, playerClaims, refreshTokens, stats, users } from '../src/db/schema.js';
import {
  authHeadersFor,
  buildTestApp,
  createLogCapture,
  createTournament,
  createUser,
  testEnv,
  truncateAll,
} from './helpers.js';

const WEB_URL = 'http://sharkulator.local.test:19006';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEV_AUTH_SECRET = testEnv.DEV_AUTH_SECRET ?? '';

type UserRow = Awaited<ReturnType<typeof createUser>>;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function tokenOf(claimUrl: string): string {
  const prefix = `${WEB_URL}/invite/claim/`;
  expect(claimUrl.startsWith(prefix)).toBe(true);
  return claimUrl.slice(prefix.length);
}

describe('placeholder players and claim links', () => {
  let app: FastifyInstance;
  let now: Date;
  const capture = createLogCapture();
  let creator: UserRow;
  let other: UserRow;

  beforeAll(async () => {
    app = await buildTestApp({
      env: { PUBLIC_WEB_URL: `${WEB_URL}/` },
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
    creator = await createUser(app.db, { username: 'alex' });
    other = await createUser(app.db, { username: 'sam' });
  });

  const create = async (displayName: string, caller: UserRow = creator) =>
    app.inject({
      method: 'POST',
      url: '/players/placeholders',
      headers: await authHeadersFor(app, caller.id),
      payload: { displayName },
    });

  const preview = (token: string) =>
    app.inject({ method: 'GET', url: `/invites/claim/${encodeURIComponent(token)}` });

  const reissue = async (id: string, caller: UserRow = creator) =>
    app.inject({
      method: 'POST',
      url: `/players/${id}/claim-link`,
      headers: await authHeadersFor(app, caller.id),
    });

  const revoke = async (id: string, caller: UserRow = creator) =>
    app.inject({
      method: 'DELETE',
      url: `/players/${id}/claim-link`,
      headers: await authHeadersFor(app, caller.id),
    });

  const invited = async (caller: UserRow = creator) =>
    app.inject({
      method: 'GET',
      url: '/players/invited',
      headers: await authHeadersFor(app, caller.id),
    });

  async function createRiley() {
    const res = await create('Riley Guest');
    expect(res.statusCode).toBe(201);
    const body = res.json<{ user: { id: string; username: string }; claimUrl: string }>();
    return { ...body, token: tokenOf(body.claimUrl) };
  }

  describe('POST /players/placeholders', () => {
    it('creates a PLACEHOLDER user and returns its claim URL built from PUBLIC_WEB_URL', async () => {
      const res = await create('Riley Guest');

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toEqual({
        user: {
          id: expect.any(String),
          username: 'riley-guest',
          accountType: 'PLACEHOLDER',
          firstName: 'Riley',
          lastName: 'Guest',
          pictureUrl: null,
          locale: null,
        },
        claimUrl: expect.stringMatching(
          /^http:\/\/sharkulator\.local\.test:19006\/invite\/claim\//,
        ),
        claimExpiresAt: new Date(now.getTime() + 30 * DAY_MS).toISOString(),
      });

      const [row] = await app.db.select().from(users).where(eq(users.id, body.user.id));
      expect(row).toMatchObject({
        accountType: 'PLACEHOLDER',
        googleSub: null,
        email: null,
        emailVerified: false,
        claimedAt: null,
        createdByUserId: creator.id,
      });
    });

    it('VAL-CLAIM-018: the claim token is 32 random bytes in base64url and only its SHA-256 is stored', async () => {
      const { token, user } = await createRiley();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);

      const claims = await app.db.select().from(playerClaims);
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({
        placeholderUserId: user.id,
        creatorUserId: creator.id,
        tokenHash: sha256(token),
        consumedAt: null,
        revokedAt: null,
      });
      expect(JSON.stringify(claims)).not.toContain(token);
      const userRows = await app.db.select().from(users);
      expect(JSON.stringify(userRows)).not.toContain(token);
    });

    it('derives URL-safe unique usernames from HTML-like or repeated names', async () => {
      const first = await create('<b>Bob</b> <script>/x</script>');
      expect(first.statusCode).toBe(201);
      expect(first.json().user.username).toMatch(/^[\p{L}\p{N}._-]+$/u);
      expect(first.json().user.firstName).toBe('<b>Bob</b>');

      await create('Riley Guest');
      const again = await create('Riley Guest');
      expect(again.json().user.username).toBe('riley-guest-1');
    });

    it('validates the body and requires authentication', async () => {
      expect((await create('   ')).statusCode).toBe(400);
      const anon = await app.inject({
        method: 'POST',
        url: '/players/placeholders',
        payload: { displayName: 'X' },
      });
      expect(anon.statusCode).toBe(401);
      expect((await app.db.select({ n: count() }).from(users))[0]?.n).toBe(2);
    });
  });

  it('records a game with a placeholder username and gives it Elo stats', async () => {
    const { user } = await createRiley();
    const tournament = await createTournament(app.db, { name: 'babyfoot' });

    const res = await app.inject({
      method: 'POST',
      url: `/tournaments/${tournament.name}/games`,
      headers: await authHeadersFor(app, creator.id),
      payload: {
        outcomes: [
          { username: user.username, result: 'WIN' },
          { username: 'alex', result: 'LOSS' },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const winner = res
      .json<{ outcomes: { result: string; scoreValue: number; user: { accountType: string } }[] }>()
      .outcomes.find((o) => o.result === 'WIN');
    expect(winner).toMatchObject({ scoreValue: 16, user: { accountType: 'PLACEHOLDER' } });
    const [row] = await app.db.select().from(stats).where(eq(stats.userId, user.id));
    expect(row).toMatchObject({ score: 1016, gameCount: 1, winCount: 1 });
  });

  describe('GET /invites/claim/:token (public preview)', () => {
    it('shows the player, inviter, open history and expiry without consuming the link', async () => {
      const { token, user } = await createRiley();
      const tournament = await createTournament(app.db, { name: 'babyfoot' });
      await app.inject({
        method: 'POST',
        url: `/tournaments/${tournament.name}/games`,
        headers: await authHeadersFor(app, creator.id),
        payload: {
          outcomes: [
            { username: user.username, result: 'WIN' },
            { username: 'alex', result: 'LOSS' },
          ],
        },
      });

      for (let i = 0; i < 2; i++) {
        const res = await preview(token);
        expect(res.statusCode).toBe(200);
        expect(res.headers['x-robots-tag']).toContain('noindex');
        expect(res.headers['referrer-policy']).toBe('no-referrer');
        expect(res.headers['cache-control']).toBe('no-store');
        const body = res.json();
        expect(body.player).toMatchObject({ id: user.id, accountType: 'PLACEHOLDER' });
        expect(body.invitedBy).toMatchObject({ id: creator.id, username: 'alex' });
        expect(body.gamesCount).toBe(1);
        expect(body.recentGames).toHaveLength(1);
        expect(body.stats).toHaveLength(1);
        expect(body.stats[0]).toMatchObject({ score: 1016 });
        expect(body.expiresAt).toBe(new Date(now.getTime() + 30 * DAY_MS).toISOString());
        const raw = JSON.stringify(body);
        expect(raw).not.toContain('@example.com');
        expect(raw).not.toContain('google');
        expect(raw).not.toContain(token);
      }
      const [claim] = await app.db.select().from(playerClaims);
      expect(claim?.consumedAt).toBeNull();
    });

    it('VAL-CLAIM-011: unknown, expired, revoked and consumed links are 404 CLAIM_INVALID', async () => {
      const { token, user } = await createRiley();
      const expectInvalid = async (t: string) => {
        const res = await preview(t);
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({
          error: { code: 'CLAIM_INVALID', message: expect.any(String) },
        });
        expect(JSON.stringify(res.json())).not.toContain('riley');
      };

      await expectInvalid('not-a-real-token');

      now = new Date(now.getTime() + 31 * DAY_MS);
      await expectInvalid(token);
      now = new Date();
      expect((await preview(token)).statusCode).toBe(200);

      await app.db
        .update(playerClaims)
        .set({ consumedAt: new Date() })
        .where(eq(playerClaims.placeholderUserId, user.id));
      await expectInvalid(token);
      await app.db
        .update(playerClaims)
        .set({ consumedAt: null })
        .where(eq(playerClaims.placeholderUserId, user.id));

      expect((await revoke(user.id)).statusCode).toBe(204);
      await expectInvalid(token);

      const [row] = await app.db.select().from(users).where(eq(users.id, user.id));
      expect(row?.accountType).toBe('PLACEHOLDER');
    });
  });

  describe('claim link management', () => {
    it('VAL-CLAIM-007: reissue rotates the token; the old link fails and the new one previews the same player', async () => {
      const { token: oldToken, user } = await createRiley();
      now = new Date(now.getTime() + 5 * DAY_MS);

      const res = await reissue(user.id);
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.user.id).toBe(user.id);
      expect(body.claimExpiresAt).toBe(new Date(now.getTime() + 30 * DAY_MS).toISOString());
      const newToken = tokenOf(body.claimUrl);
      expect(newToken).not.toBe(oldToken);

      expect((await preview(oldToken)).json().error.code).toBe('CLAIM_INVALID');
      const fresh = await preview(newToken);
      expect(fresh.statusCode).toBe(200);
      expect(fresh.json().player.id).toBe(user.id);
      expect((await app.db.select({ n: count() }).from(users))[0]?.n).toBe(3);
      expect(await app.db.select().from(playerClaims)).toHaveLength(1);
    });

    it('VAL-CLAIM-008: revoke disables the link immediately; reissue gives a new link without reviving the old one', async () => {
      const { token: oldToken, user } = await createRiley();
      expect((await revoke(user.id)).statusCode).toBe(204);
      expect((await revoke(user.id)).statusCode).toBe(204);
      expect((await preview(oldToken)).statusCode).toBe(404);

      const list = (await invited()).json();
      expect(list[0]).toMatchObject({ status: 'REVOKED', claimRevokedAt: expect.any(String) });
      expect((await app.db.select().from(users).where(eq(users.id, user.id))).length).toBe(1);

      const again = await reissue(user.id);
      expect(again.statusCode).toBe(201);
      expect((await preview(tokenOf(again.json().claimUrl))).statusCode).toBe(200);
      expect((await preview(oldToken)).statusCode).toBe(404);
      expect((await invited()).json()[0]).toMatchObject({ status: 'ACTIVE', claimRevokedAt: null });
    });

    it('VAL-CLAIM-009: only the creator can reissue or revoke; refusals leave the link usable', async () => {
      const { token, user } = await createRiley();

      for (const res of [await reissue(user.id, other), await revoke(user.id, other)]) {
        expect(res.statusCode).toBe(403);
        expect(res.json().error.code).toBe('NOT_PLACEHOLDER_CREATOR');
      }
      for (const method of ['POST', 'DELETE'] as const) {
        const anon = await app.inject({ method, url: `/players/${user.id}/claim-link` });
        expect(anon.statusCode).toBe(401);
      }
      expect((await preview(token)).statusCode).toBe(200);
      expect((await invited(other)).json()).toEqual([]);
    });

    it('answers 404 for unknown players and registered users without a claim', async () => {
      for (const id of [crypto.randomUUID(), other.id]) {
        const res = await reissue(id);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('PLACEHOLDER_NOT_FOUND');
      }
      expect((await reissue('not-a-uuid')).statusCode).toBe(400);
    });

    it('VAL-CLAIM-006: lists the creator’s players with lifecycle status and no secrets', async () => {
      const active = await createRiley();
      const expired = (await create('Casey Guest')).json();
      const revoked = (await create('Jamie Guest')).json();
      const claimed = (await create('Quinn Guest')).json();
      await app.db
        .update(playerClaims)
        .set({ expiresAt: new Date(now.getTime() - 1000) })
        .where(eq(playerClaims.placeholderUserId, expired.user.id));
      await revoke(revoked.user.id);
      await app.db
        .update(users)
        .set({ accountType: 'REGISTERED', googleSub: 'claimed-sub', claimedAt: now })
        .where(eq(users.id, claimed.user.id));
      await app.db
        .update(playerClaims)
        .set({ consumedAt: now })
        .where(eq(playerClaims.placeholderUserId, claimed.user.id));

      const res = await invited();
      expect(res.statusCode).toBe(200);
      const byName = new Map(
        res
          .json<{ user: { username: string }; status: string }[]>()
          .map((p) => [p.user.username, p]),
      );
      expect(byName.get(active.user.username)).toMatchObject({ status: 'ACTIVE', claimedAt: null });
      expect(byName.get(expired.user.username)).toMatchObject({ status: 'EXPIRED' });
      expect(byName.get(revoked.user.username)).toMatchObject({ status: 'REVOKED' });
      expect(byName.get(claimed.user.username)).toMatchObject({
        status: 'CLAIMED',
        claimedAt: now.toISOString(),
        user: { accountType: 'REGISTERED' },
      });

      const raw = res.body;
      for (const issued of [active, expired, revoked, claimed]) {
        const token = tokenOf(issued.claimUrl);
        expect(raw).not.toContain(token);
        expect(raw).not.toContain(sha256(token));
      }
      expect(raw).not.toMatch(/claimUrl|tokenHash|token/);
    });

    it('VAL-CLAIM-015: a consumed claim cannot be reissued or revoked', async () => {
      const { user } = await createRiley();
      await app.db
        .update(users)
        .set({ accountType: 'REGISTERED', googleSub: 'claimed-sub', claimedAt: now })
        .where(eq(users.id, user.id));
      await app.db
        .update(playerClaims)
        .set({ consumedAt: now })
        .where(eq(playerClaims.placeholderUserId, user.id));

      for (const res of [await reissue(user.id), await revoke(user.id)]) {
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('CLAIM_ALREADY_USED');
      }
      const [claim] = await app.db.select().from(playerClaims);
      expect(claim?.revokedAt).toBeNull();
    });
  });

  it('VAL-CLAIM-004: dev sign-in refuses a placeholder but still works for registered users', async () => {
    const { user } = await createRiley();
    const devToken = (username: string) =>
      app.inject({
        method: 'POST',
        url: '/auth/dev-token',
        headers: { 'x-dev-auth': DEV_AUTH_SECRET },
        payload: { username },
      });

    const refused = await devToken(user.username);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({
      error: { code: 'PLACEHOLDER_CANNOT_SIGN_IN', message: expect.any(String) },
    });
    expect(refused.body).not.toMatch(/accessToken|refreshToken/);
    expect(await app.db.select().from(refreshTokens)).toHaveLength(0);

    expect((await devToken('alex')).statusCode).toBe(200);
    const [row] = await app.db.select().from(users).where(eq(users.id, user.id));
    expect(row?.accountType).toBe('PLACEHOLDER');
  });

  it('user lookups label placeholders without exposing claim data', async () => {
    const { user, token } = await createRiley();
    const res = await app.inject({
      method: 'GET',
      url: `/users/${user.username}`,
      headers: await authHeadersFor(app, other.id),
    });
    expect(res.json()).toMatchObject({ id: user.id, accountType: 'PLACEHOLDER' });
    expect(res.body).not.toContain(token);
    expect(await app.db.select().from(outcomes)).toHaveLength(0);
  });

  it('VAL-CLAIM-018: issuance, reissue and preview logs never contain claim tokens', async () => {
    capture.lines.length = 0;
    const { token, user } = await createRiley();
    await preview(token);
    const rotated = tokenOf((await reissue(user.id)).json().claimUrl);
    await preview(rotated);
    await preview(token);

    const output = capture.text();
    expect(output).toContain('/invites/claim/[REDACTED]');
    expect(output).not.toContain(token);
    expect(output).not.toContain(rotated);
  });
});
