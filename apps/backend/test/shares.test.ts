import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gameShares, games, tournaments } from '../src/db/schema.js';
import { renderShareCard } from '../src/lib/share-renderer.js';
import type { ShareSnapshot } from '../src/lib/share-snapshot.js';
import {
  authHeadersFor,
  buildTestApp,
  createLogCapture,
  createPlaceholderUser,
  createSport,
  createTournament,
  createUser,
  truncateAll,
} from './helpers.js';
import { buildPrivacyFixture, call, type PrivacyFixture } from './privacy-fixture.js';

type UserRow = Awaited<ReturnType<typeof createUser>>;

const API = 'https://api.share.test';
const WEB = 'https://web.share.test';
const env = { PUBLIC_API_URL: API, PUBLIC_WEB_URL: WEB };

interface ShareBody {
  shareId: string;
  url: string;
  imageUrl: string;
}

const tokenOf = (share: ShareBody) => share.url.slice(`${API}/s/`.length);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngInfo(body: Buffer) {
  return {
    signature: body.subarray(0, 8).equals(PNG_SIGNATURE),
    chunk: body.subarray(12, 16).toString('ascii'),
    width: body.readUInt32BE(16),
    height: body.readUInt32BE(20),
  };
}

/** content of <meta property|name="key" content="..."> (still HTML-escaped). */
function meta(html: string, key: string): string | undefined {
  const pattern = new RegExp(
    `<meta (?:property|name)="${key.replace(/:/g, ':')}" content="([^"]*)">`,
  );
  return pattern.exec(html)?.[1];
}

function expectPublicHeaders(headers: Record<string, unknown>) {
  expect(String(headers['x-robots-tag'])).toContain('noindex');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['cache-control']).toBe('no-store');
}

describe('share cards', () => {
  let app: FastifyInstance;
  const rendered: ShareSnapshot[] = [];

  beforeAll(async () => {
    app = await buildTestApp({
      env,
      renderShareCard: async (snapshot) => {
        rendered.push(snapshot);
        return renderShareCard(snapshot);
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    app.shareCards.clear();
    rendered.length = 0;
  });

  const issue = async (user: UserRow | null, gameId: string) =>
    app.inject({
      method: 'POST',
      url: `/games/${gameId}/share`,
      headers: user ? await authHeadersFor(app, user.id) : {},
    });

  const revoke = async (user: UserRow | null, gameId: string, shareId: string) =>
    app.inject({
      method: 'DELETE',
      url: `/games/${gameId}/share/${shareId}`,
      headers: user ? await authHeadersFor(app, user.id) : {},
    });

  const publicGet = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers });

  async function openGame() {
    const sport = await createSport(app.db, { name: 'Table Tennis' });
    const tournament = await createTournament(app.db, {
      name: 'officecup',
      displayName: 'Office Cup',
      sportId: sport.id,
    });
    const alice = await createUser(app.db, {
      username: 'alice',
      firstName: 'Alice',
      lastName: 'A',
    });
    const bob = await createUser(app.db, { username: 'bob', firstName: 'Bob', lastName: 'B' });
    const carol = await createUser(app.db, { username: 'carol' });
    const res = await app.inject({
      method: 'POST',
      url: '/tournaments/officecup/games',
      headers: await authHeadersFor(app, bob.id),
      payload: {
        outcomes: [
          { username: 'alice', result: 'WIN' },
          { username: 'bob', result: 'LOSS' },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return { tournament, alice, bob, carol, gameId: res.json<{ id: string }>().id };
  }

  const activeRows = (gameId: string) =>
    app.db
      .select()
      .from(gameShares)
      .where(and(eq(gameShares.gameId, gameId), isNull(gameShares.revokedAt)));

  describe('issuing (VAL-SHARE-003/004/005)', () => {
    it('lets the winner and the losing submitter each issue their own link', async () => {
      const { alice, bob, gameId } = await openGame();
      const a = await issue(alice, gameId);
      const b = await issue(bob, gameId);
      expect(a.statusCode, a.body).toBe(201);
      expect(b.statusCode, b.body).toBe(201);
      expect(a.json<ShareBody>().shareId).not.toBe(b.json<ShareBody>().shareId);
      expect(a.json<ShareBody>().url).not.toBe(b.json<ShareBody>().url);
      expect(await activeRows(gameId)).toHaveLength(2);
    });

    it('rejects a visible-game nonparticipant, anonymous callers and malformed ids', async () => {
      const { carol, gameId } = await openGame();
      const outsider = await issue(carol, gameId);
      expect(outsider.statusCode).toBe(403);
      expect(outsider.json().error.code).toBe('NOT_GAME_PARTICIPANT');
      const anonymous = await issue(null, gameId);
      expect(anonymous.statusCode).toBe(401);
      const malformed = await issue(carol, 'not-a-uuid');
      expect(malformed.statusCode).toBe(400);
      const unknown = await issue(carol, '00000000-0000-4000-8000-000000000000');
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().error.code).toBe('GAME_NOT_FOUND');
      expect(await app.db.select().from(gameShares)).toHaveLength(0);
    });

    it('reuses the active link for repeated and concurrent requests', async () => {
      const { alice, bob, gameId } = await openGame();
      const first = await issue(alice, gameId);
      expect(first.statusCode).toBe(201);
      const again = await issue(alice, gameId);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual(first.json());

      const concurrent = await Promise.all(Array.from({ length: 6 }, () => issue(bob, gameId)));
      const bodies = concurrent.map((r) => r.json<ShareBody>());
      expect(new Set(bodies.map((s) => s.shareId)).size).toBe(1);
      expect(new Set(bodies.map((s) => s.url)).size).toBe(1);
      expect(concurrent.filter((r) => r.statusCode === 201)).toHaveLength(1);
      expect(concurrent.filter((r) => r.statusCode === 200)).toHaveLength(5);
      expect(await activeRows(gameId)).toHaveLength(2);
    });

    it('issues a different token after revocation instead of reviving the old one', async () => {
      const { alice, gameId } = await openGame();
      const first = (await issue(alice, gameId)).json<ShareBody>();
      expect((await revoke(alice, gameId, first.shareId)).statusCode).toBe(204);
      const second = await issue(alice, gameId);
      expect(second.statusCode).toBe(201);
      const next = second.json<ShareBody>();
      expect(next.shareId).not.toBe(first.shareId);
      expect(tokenOf(next)).not.toBe(tokenOf(first));
      expect((await publicGet(`/s/${tokenOf(first)}`)).statusCode).toBe(404);
      expect((await publicGet(`/s/${tokenOf(next)}`)).statusCode).toBe(200);
    });

    it('uses random 32-byte base64url tokens under PUBLIC_API_URL whatever the Host', async () => {
      const { alice, bob, gameId } = await openGame();
      const res = await app.inject({
        method: 'POST',
        url: `/games/${gameId}/share`,
        headers: { ...(await authHeadersFor(app, alice.id)), host: 'evil.example' },
      });
      const share = res.json<ShareBody>();
      const token = tokenOf(share);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(share.url).toBe(`${API}/s/${token}`);
      expect(share.imageUrl).toBe(`${API}/s/${token}.png`);
      for (const id of [gameId, alice.id, bob.id, share.shareId]) {
        expect(token).not.toContain(id);
        expect(token).not.toContain(id.replace(/-/g, ''));
      }
      const other = tokenOf((await issue(bob, gameId)).json<ShareBody>());
      expect(other).not.toBe(token);

      const html = (await publicGet(`/s/${token}`, { host: 'evil.example' })).body;
      expect(html).not.toContain('evil.example');
      expect(meta(html, 'og:url')).toBe(share.url);
      expect(html).toContain(`<link rel="canonical" href="${share.url}">`);
      expect(meta(html, 'og:image')).toBe(share.imageUrl);
    });
  });

  describe('public page (VAL-SHARE-006/007/008/009)', () => {
    it('serves anonymous HTML with complete preview metadata and the visible result', async () => {
      const { alice, gameId } = await openGame();
      const share = (await issue(alice, gameId)).json<ShareBody>();
      const res = await publicGet(`/s/${tokenOf(share)}`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expectPublicHeaders(res.headers);
      const html = res.body;
      expect(html).toMatch(/^<!doctype html>/);
      expect(meta(html, 'robots')).toContain('noindex');
      expect(meta(html, 'og:title')).toBe('Alice A beat Bob B · Table Tennis');
      expect(meta(html, 'og:description')).toMatch(
        /^Elo: Alice A \+\d+\.\d, Bob B -\d+\.\d · Office Cup · \w{3} \d{1,2}, \d{4}$/,
      );
      expect(meta(html, 'og:url')).toBe(share.url);
      expect(meta(html, 'og:image')).toBe(share.imageUrl);
      expect(meta(html, 'og:image:type')).toBe('image/png');
      expect(meta(html, 'og:image:width')).toBe('1200');
      expect(meta(html, 'og:image:height')).toBe('630');
      expect(meta(html, 'twitter:card')).toBe('summary_large_image');

      const body = html.slice(html.indexOf('<body>'));
      expect(body).toContain('Alice A');
      expect(body).toContain('Bob B');
      expect(body).toContain('Winner');
      expect(body).toContain('Loser');
      expect(body).toMatch(/\+\d+\.\d Elo/);
      expect(body).toMatch(/-\d+\.\d Elo/);
      expect(body).toContain('Table Tennis');
      expect(body).toContain('SHARKULATOR');
      expect(body).toContain(`<a class="cta" href="${WEB}/games/${gameId}">Open Sharkulator</a>`);
      expect(html).not.toContain('<script');
    });

    it('escapes user-provided names and labels in text, attributes and metadata', async () => {
      const sport = await createSport(app.db, { name: 'Darts "&" <i>' });
      await createTournament(app.db, {
        name: 'evilcup',
        displayName: `Cup "quoted" & <b onmouseover='x'>`,
        sportId: sport.id,
      });
      const winner = await createUser(app.db, { username: 'winner', firstName: 'Win"ner' });
      const loser = await createUser(app.db, { username: 'loser' });
      const evil = await createPlaceholderUser(app.db, {
        username: 'evil-guest',
        firstName: '<script>alert(1)</script>',
        createdByUserId: loser.id,
      });
      const mate = await createUser(app.db, {
        username: 'mate',
        firstName: '<img src=x onerror=alert(2)>',
      });
      const game = await app.inject({
        method: 'POST',
        url: '/tournaments/evilcup/games',
        headers: await authHeadersFor(app, loser.id),
        payload: {
          outcomes: [
            { username: winner.username, result: 'WIN' },
            { username: mate.username, result: 'WIN' },
            { username: loser.username, result: 'LOSS' },
            { username: evil.username, result: 'LOSS' },
          ],
        },
      });
      expect(game.statusCode, game.body).toBe(201);
      const gameId = game.json<{ id: string }>().id;
      const share = (await issue(loser, gameId)).json<ShareBody>();
      const html = (await publicGet(`/s/${tokenOf(share)}`)).body;

      expect(html).not.toContain('<script');
      expect(html).not.toContain('<img src=x');
      expect(html).not.toContain('<b ');
      expect(html).not.toContain('<i>');
      expect(html).not.toMatch(/onmouseover='/);
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
      expect(html).toContain('Cup &quot;quoted&quot; &amp; &lt;b onmouseover=&#39;x&#39;&gt;');
      expect(meta(html, 'og:title')).toContain('Win&quot;ner');
      expect(meta(html, 'og:description')).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      // Every <meta> stays one well-formed tag: no attribute was broken out of.
      for (const tag of html.match(/<meta [^>]*>/g) ?? []) {
        expect(tag).toMatch(
          /^<meta (?:charset="utf-8"|(?:name|property)="[^"]+" content="[^"]*")>$/,
        );
      }

      const png = await publicGet(`/s/${tokenOf(share)}.png`);
      expect(png.statusCode).toBe(200);
      expect(pngInfo(png.rawPayload)).toMatchObject({ signature: true, width: 1200, height: 630 });
      expect(rendered.at(-1)?.participants.map((p) => p.displayName)).toContain(
        '<script>alert(1)</script>',
      );
    });

    it('sets a strict content security policy without scripts', async () => {
      const { alice, gameId } = await openGame();
      const share = (await issue(alice, gameId)).json<ShareBody>();
      const res = await publicGet(`/s/${tokenOf(share)}`);
      const csp = String(res.headers['content-security-policy']);
      expect(csp).toContain("default-src 'none'");
      expect(csp).not.toContain('script-src');
      expect(csp).toContain(`img-src 'self' ${API}`);
    });
  });

  describe('public image (VAL-SHARE-010)', () => {
    it('serves an anonymous 1200x630 PNG with the public headers', async () => {
      const { alice, gameId } = await openGame();
      const share = (await issue(alice, gameId)).json<ShareBody>();
      const res = await publicGet(`/s/${tokenOf(share)}.png`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expectPublicHeaders(res.headers);
      expect(pngInfo(res.rawPayload)).toEqual({
        signature: true,
        chunk: 'IHDR',
        width: 1200,
        height: 630,
      });
      expect(rendered).toHaveLength(1);
      expect(rendered[0]).toMatchObject({
        gameId,
        sport: 'Table Tennis',
        tournament: 'Office Cup',
        participants: [
          expect.objectContaining({ displayName: 'Alice A', result: 'WIN' }),
          expect.objectContaining({ displayName: 'Bob B', result: 'LOSS' }),
        ],
      });

      const again = await publicGet(`/s/${tokenOf(share)}.png`);
      expect(again.rawPayload.equals(res.rawPayload)).toBe(true);
      expect(rendered).toHaveLength(1);
      const head = await app.inject({ method: 'HEAD', url: `/s/${tokenOf(share)}.png` });
      expect(head.statusCode).toBe(200);
      expect(head.headers['content-type']).toBe('image/png');
    });
  });

  describe('private group games (VAL-SHARE-011/013)', () => {
    let fixture: PrivacyFixture;

    beforeEach(async () => {
      fixture = await buildPrivacyFixture(app);
    });

    // privcup games: #6 alex+jordan beat fran+guest, #9 alex beat jordan.
    const franPrivateGame = () => fixture.games[6]!.id;
    const alexJordanGame = () => fixture.games[9]!.id;

    it('lets current members share without opt-in and exposes only the explicit result', async () => {
      const gameId = alexJordanGame();
      const res = await issue(fixture.jordan, gameId);
      expect(res.statusCode, res.body).toBe(201);
      const share = res.json<ShareBody>();

      const page = await publicGet(`/s/${tokenOf(share)}`);
      expect(page.statusCode).toBe(200);
      const png = await publicGet(`/s/${tokenOf(share)}.png`);
      expect(png.statusCode).toBe(200);
      expect(pngInfo(png.rawPayload)).toMatchObject({ width: 1200, height: 630 });

      const html = page.body;
      expect(html).toContain('Priv Cup');
      expect(html).not.toContain('Secret Society');
      expect(html).not.toContain(fixture.group.id);
      expect(html).not.toContain('@example.com');
      for (const other of fixture.games.filter((g) => g.id !== gameId)) {
        expect(html).not.toContain(other.id);
      }
      for (const word of ['claim', 'stats', 'rivalr', 'members', 'invite']) {
        expect(html.toLowerCase()).not.toContain(word);
      }
      const [row] = await app.db.select().from(gameShares).where(eq(gameShares.id, share.shareId));
      expect(Object.keys(row!.snapshot).sort()).toEqual(
        ['date', 'gameId', 'participants', 'sport', 'tournament', 'version'].sort(),
      );
      expect(JSON.stringify(row!.snapshot)).not.toContain('@example.com');
      expect(JSON.stringify(row!.snapshot)).not.toContain(fixture.group.id);

      // The capability grants nothing on the protected API.
      expect((await call(app, null, 'GET', `/games/${gameId}`)).statusCode).toBe(401);
      expect((await call(app, fixture.pat, 'GET', `/games/${gameId}`)).statusCode).toBe(404);
      expect((await call(app, fixture.pat, 'GET', `/tournaments/privcup`)).statusCode).toBe(404);
      expect((await call(app, fixture.pat, 'GET', `/groups/${fixture.group.id}`)).statusCode).toBe(
        404,
      );
    });

    it('answers 404 to callers who cannot see the private game, even former participants', async () => {
      const gameId = franPrivateGame();
      for (const user of [fixture.fran, fixture.pat]) {
        const res = await issue(user, gameId);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('GAME_NOT_FOUND');
        expect(res.body).not.toContain('Priv Cup');
      }
      expect(await app.db.select().from(gameShares)).toHaveLength(0);
    });

    it('only lets the issuer revoke, including after leaving the group', async () => {
      const gameId = alexJordanGame();
      const jordanShare = (await issue(fixture.jordan, gameId)).json<ShareBody>();
      const alexShare = (await issue(fixture.alex, gameId)).json<ShareBody>();

      const stolen = await revoke(fixture.alex, gameId, jordanShare.shareId);
      expect(stolen.statusCode).toBe(404);
      expect(stolen.json().error.code).toBe('SHARE_NOT_FOUND');
      expect((await publicGet(`/s/${tokenOf(jordanShare)}`)).statusCode).toBe(200);
      expect((await revoke(null, gameId, jordanShare.shareId)).statusCode).toBe(401);
      const wrongGame = await revoke(fixture.jordan, fixture.games[0]!.id, jordanShare.shareId);
      expect(wrongGame.statusCode).toBe(404);

      const left = await call(app, fixture.jordan, 'POST', `/groups/${fixture.group.id}/leave`);
      expect(left.statusCode, left.body).toBe(204);
      expect((await call(app, fixture.jordan, 'GET', `/games/${gameId}`)).statusCode).toBe(404);

      const revoked = await revoke(fixture.jordan, gameId, jordanShare.shareId);
      expect(revoked.statusCode).toBe(204);
      expect((await revoke(fixture.jordan, gameId, jordanShare.shareId)).statusCode).toBe(204);
      expect((await publicGet(`/s/${tokenOf(jordanShare)}`)).statusCode).toBe(404);
      expect((await publicGet(`/s/${tokenOf(alexShare)}`)).statusCode).toBe(200);
      expect((await publicGet(`/s/${tokenOf(alexShare)}.png`)).statusCode).toBe(200);
    });
  });

  describe('snapshot stability (VAL-SHARE-012)', () => {
    it('keeps describing the issued result after names and labels change', async () => {
      const { alice, bob, tournament, gameId } = await openGame();
      const share = (await issue(alice, gameId)).json<ShareBody>();
      expect((await publicGet(`/s/${tokenOf(share)}.png`)).statusCode).toBe(200);

      const renamed = await app.inject({
        method: 'PUT',
        url: '/users/me',
        headers: await authHeadersFor(app, bob.id),
        payload: { firstName: 'Robert', lastName: 'Renamed' },
      });
      expect(renamed.statusCode, renamed.body).toBe(200);
      await app.db
        .update(tournaments)
        .set({ displayName: 'Renamed Cup' })
        .where(eq(tournaments.id, tournament.id));
      app.shareCards.clear();

      const html = (await publicGet(`/s/${tokenOf(share)}`)).body;
      expect(html).toContain('Bob B');
      expect(html).toContain('Office Cup');
      expect(html).not.toContain('Robert');
      expect(html).not.toContain('Renamed Cup');
      expect((await publicGet(`/s/${tokenOf(share)}.png`)).statusCode).toBe(200);
      expect(rendered).toHaveLength(2);
      expect(rendered[1]).toEqual(rendered[0]);

      const fresh = (await issue(bob, gameId)).json<ShareBody>();
      const freshHtml = (await publicGet(`/s/${tokenOf(fresh)}`)).body;
      expect(freshHtml).toContain('Robert Renamed');
      expect(freshHtml).toContain('Renamed Cup');
    });
  });

  describe('revocation and unknown links (VAL-SHARE-014/015)', () => {
    it('answers 404 for HTML and an already cached PNG after revocation', async () => {
      const { alice, gameId } = await openGame();
      const share = (await issue(alice, gameId)).json<ShareBody>();
      const token = tokenOf(share);
      expect((await publicGet(`/s/${token}`)).statusCode).toBe(200);
      expect((await publicGet(`/s/${token}.png`)).statusCode).toBe(200);
      expect(app.shareCards.stats().entries).toBe(1);

      expect((await revoke(alice, gameId, share.shareId)).statusCode).toBe(204);
      const page = await publicGet(`/s/${token}`);
      const png = await publicGet(`/s/${token}.png`);
      for (const res of [page, png]) {
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('SHARE_NOT_FOUND');
        expect(res.body).not.toContain('Alice');
        expectPublicHeaders(res.headers);
      }
      expect(app.shareCards.stats().entries).toBe(1);
      expect(rendered).toHaveLength(1);

      const browser = await publicGet(`/s/${token}`, { accept: 'text/html,*/*;q=0.8' });
      expect(browser.statusCode).toBe(404);
      expect(browser.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(browser.body).toContain('This result is not available');
      expect(browser.body).not.toContain('Alice');
      expectPublicHeaders(browser.headers);
    });

    it('answers 404 once the game is deleted, even with a cached image', async () => {
      const { alice, gameId } = await openGame();
      const share = (await issue(alice, gameId)).json<ShareBody>();
      const token = tokenOf(share);
      expect((await publicGet(`/s/${token}.png`)).statusCode).toBe(200);
      await app.db.delete(games).where(eq(games.id, gameId));
      expect((await publicGet(`/s/${token}`)).statusCode).toBe(404);
      expect((await publicGet(`/s/${token}.png`)).statusCode).toBe(404);
    });

    it('answers 404 for unknown and malformed tokens without login or result content', async () => {
      const { alice, gameId } = await openGame();
      const share = (await issue(alice, gameId)).json<ShareBody>();
      const unknown = 'A'.repeat(43);
      const paths = [
        unknown,
        tokenOf(share).slice(0, 42),
        `${tokenOf(share)}x`,
        gameId,
        share.shareId,
        'a.b',
        '%3Cscript%3E',
        'x'.repeat(150),
      ];
      for (const path of paths) {
        for (const suffix of ['', '.png']) {
          const res = await publicGet(`/s/${path}${suffix}`);
          expect(res.statusCode, `/s/${path}${suffix}`).toBe(404);
          expect(res.body).not.toContain('Alice');
          expect(res.body).not.toContain('Office Cup');
        }
      }
      expect((await publicGet(`/s/${unknown}`)).json().error.code).toBe('SHARE_NOT_FOUND');
      expect((await publicGet(`/s/${unknown}.png`)).json().error.code).toBe('SHARE_NOT_FOUND');
      expect((await publicGet('/s/')).statusCode).toBe(404);
      expect((await publicGet(`/s/${tokenOf(share)}/extra`)).statusCode).toBe(404);
      expect(rendered).toHaveLength(0);
    });
  });

  describe('rendering isolation (VAL-SHARE-017)', () => {
    it('never renders while recording a game or issuing a share', async () => {
      const { alice, gameId } = await openGame();
      await issue(alice, gameId);
      expect(rendered).toHaveLength(0);
      expect(app.shareCards.stats()).toMatchObject({ entries: 0, inFlight: 0 });
    });
  });
});

describe('share card failures and logging', () => {
  it('answers 503 SHARE_RENDER_FAILED for the PNG without breaking HTML or game saves', async () => {
    const capture = createLogCapture();
    let attempts = 0;
    const app = await buildTestApp({
      env,
      logger: capture,
      renderShareCard: async () => {
        attempts += 1;
        throw new Error('renderer exploded');
      },
    });
    try {
      await truncateAll(app.db);
      await createTournament(app.db, { name: 'cup' });
      const alice = await createUser(app.db, { username: 'alice' });
      const bob = await createUser(app.db, { username: 'bob' });
      const submit = async () =>
        app.inject({
          method: 'POST',
          url: '/tournaments/cup/games',
          headers: await authHeadersFor(app, bob.id),
          payload: {
            outcomes: [
              { username: 'alice', result: 'WIN' },
              { username: 'bob', result: 'LOSS' },
            ],
          },
        });
      const game = await submit();
      expect(game.statusCode).toBe(201);
      const gameId = game.json<{ id: string }>().id;
      const shareRes = await app.inject({
        method: 'POST',
        url: `/games/${gameId}/share`,
        headers: await authHeadersFor(app, alice.id),
      });
      const share = shareRes.json<ShareBody>();
      const token = tokenOf(share);

      const png = await app.inject({ method: 'GET', url: `/s/${token}.png` });
      expect(png.statusCode).toBe(503);
      expect(png.json()).toEqual({
        error: { code: 'SHARE_RENDER_FAILED', message: expect.any(String) },
      });
      expect(png.headers['cache-control']).toBe('no-store');
      // Failures are not cached: the next request tries again.
      expect((await app.inject({ method: 'GET', url: `/s/${token}.png` })).statusCode).toBe(503);
      expect(attempts).toBe(2);
      expect(app.shareCards.stats().entries).toBe(0);

      expect((await app.inject({ method: 'GET', url: `/s/${token}` })).statusCode).toBe(200);
      expect((await submit()).statusCode).toBe(201);

      const logs = capture.text();
      expect(logs).toContain('share card rendering failed');
      expect(logs).toContain('/s/[REDACTED]');
      expect(logs).toContain('/s/[REDACTED].png');
      expect(logs).not.toContain(token);
    } finally {
      await app.close();
    }
  });
});
