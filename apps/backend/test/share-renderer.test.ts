import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createShareCardCache,
  SHARE_CACHE_MAX_BYTES,
  SHARE_CACHE_MAX_ENTRIES,
} from '../src/lib/share-card-cache.js';
import { ApiError } from '../src/lib/errors.js';
import { escapeHtml } from '../src/lib/share-page.js';
import { renderShareCard, shareCardTree } from '../src/lib/share-renderer.js';
import type { ShareSnapshot } from '../src/lib/share-snapshot.js';

function snapshotWith(
  participants: ShareSnapshot['participants'],
  extra: Partial<ShareSnapshot> = {},
): ShareSnapshot {
  return {
    version: 1,
    gameId: '00000000-0000-4000-8000-000000000001',
    date: '2026-11-05T10:00:00.000Z',
    sport: 'Table Tennis',
    tournament: 'Office Cup',
    participants,
    ...extra,
  };
}

const player = (name: string, result: 'WIN' | 'LOSS', eloDelta: number) => ({
  username: name.toLowerCase(),
  displayName: name,
  result,
  eloDelta,
  ratingBefore: 1000,
});

function pngSize(png: Buffer) {
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Every text child in a satori element tree. */
function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node && typeof node === 'object' && 'props' in node) {
    return texts((node as { props: { children?: unknown } }).props.children);
  }
  return [];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('share card renderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a 1200x630 PNG with the bundled fonts and no network access', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const png = await renderShareCard(
      snapshotWith([player('Alice', 'WIN', 16), player('Bob', 'LOSS', -16)]),
    );
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('bounds long names, unsupported glyphs and 100-player teams', async () => {
    const participants = Array.from({ length: 100 }, (_, i) =>
      player(
        i === 0 ? `${'W'.repeat(100)} 🦈 名前` : `Player ${i}`,
        i < 50 ? 'WIN' : 'LOSS',
        i < 50 ? 3 : -3,
      ),
    );
    const snapshot = snapshotWith(participants, {
      tournament: 'T'.repeat(100),
      sport: 'S'.repeat(100),
    });
    const content = texts(shareCardTree(snapshot));
    expect(content.filter((t) => t === '+47 players')).toHaveLength(2);
    expect(content.some((t) => t.includes('Player 10'))).toBe(false);
    for (const t of content) expect(Array.from(t).length).toBeLessThanOrEqual(60);
    expect(content).toContain(`${'W'.repeat(31)}…`);

    const png = await renderShareCard(snapshot);
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  });

  it('shows WIN/LOSS teams with signed Elo changes, sport and branding', () => {
    const content = texts(
      shareCardTree(snapshotWith([player('Alice', 'WIN', 16.04), player('Bob', 'LOSS', -16.04)])),
    );
    expect(content).toEqual(
      expect.arrayContaining([
        'SHARKULATOR',
        'TABLE TENNIS',
        'Office Cup',
        'WINNER',
        'LOSER',
        'Alice',
        'Bob',
        '+16.0 Elo',
        '-16.0 Elo',
      ]),
    );
  });
});

describe('share card cache', () => {
  const input = snapshotWith([player('Alice', 'WIN', 1)]);

  it('defaults to a 32 MiB / 128 entry bound', () => {
    expect(SHARE_CACHE_MAX_BYTES).toBe(32 * 1024 * 1024);
    expect(SHARE_CACHE_MAX_ENTRIES).toBe(128);
  });

  it('evicts the least recently used entries beyond the entry bound', async () => {
    const render = vi.fn(async () => Buffer.alloc(10));
    const cache = createShareCardCache({ render });
    for (let i = 0; i < 130; i += 1) await cache.get(`k${i}`, input);
    expect(cache.stats()).toMatchObject({ entries: 128, bytes: 1280 });
    expect(render).toHaveBeenCalledTimes(130);

    await cache.get('k2', input);
    expect(render).toHaveBeenCalledTimes(130);
    await cache.get('k0', input);
    expect(render).toHaveBeenCalledTimes(131);
    // k2 was used recently, so adding k0 evicted k3 instead.
    await cache.get('k2', input);
    expect(render).toHaveBeenCalledTimes(131);
    await cache.get('k3', input);
    expect(render).toHaveBeenCalledTimes(132);
  });

  it('keeps total bytes under the byte bound and skips oversized images', async () => {
    const mib = 1024 * 1024;
    const cache = createShareCardCache({ render: async () => Buffer.alloc(5 * mib) });
    for (let i = 0; i < 10; i += 1) await cache.get(`k${i}`, input);
    const { entries, bytes } = cache.stats();
    expect(bytes).toBeLessThanOrEqual(SHARE_CACHE_MAX_BYTES);
    expect(entries).toBe(6);

    const huge = createShareCardCache({ render: async () => Buffer.alloc(33 * mib) });
    expect((await huge.get('big', input)).byteLength).toBe(33 * mib);
    expect(huge.stats()).toMatchObject({ entries: 0, bytes: 0 });
  });

  it('renders identical concurrent misses once', async () => {
    const gate = deferred<Buffer>();
    const render = vi.fn(() => gate.promise);
    const cache = createShareCardCache({ render });
    const calls = [cache.get('same', input), cache.get('same', input), cache.get('same', input)];
    await flush();
    expect(render).toHaveBeenCalledTimes(1);
    gate.resolve(Buffer.from('png'));
    const results = await Promise.all(calls);
    expect(new Set(results).size).toBe(1);
    expect(cache.stats()).toMatchObject({ entries: 1, inFlight: 0 });
  });

  it('limits concurrent renders and rejects when the queue is full', async () => {
    const gates: ReturnType<typeof deferred<Buffer>>[] = [];
    const render = vi.fn(() => {
      const gate = deferred<Buffer>();
      gates.push(gate);
      return gate.promise;
    });
    const cache = createShareCardCache({ render, concurrency: 2, maxQueue: 2 });
    const running = ['a', 'b', 'c', 'd'].map((key) => cache.get(key, input));
    await flush();
    expect(render).toHaveBeenCalledTimes(2);
    expect(cache.stats().queued).toBe(2);

    const overflow = cache.get('e', input);
    await expect(overflow).rejects.toMatchObject({ status: 503, code: 'SHARE_RENDER_FAILED' });

    gates[0]!.resolve(Buffer.from('a'));
    await flush();
    expect(render).toHaveBeenCalledTimes(3);
    gates[1]!.resolve(Buffer.from('b'));
    await flush();
    expect(render).toHaveBeenCalledTimes(4);
    gates[2]!.resolve(Buffer.from('c'));
    gates[3]!.resolve(Buffer.from('d'));
    expect((await Promise.all(running)).map(String)).toEqual(['a', 'b', 'c', 'd']);
    expect(cache.stats()).toMatchObject({ queued: 0, inFlight: 0, entries: 4 });
  });

  it('turns render failures into 503 SHARE_RENDER_FAILED without caching them', async () => {
    const onError = vi.fn();
    let fail = true;
    const cache = createShareCardCache({
      render: async () => {
        if (fail) throw new Error('boom');
        return Buffer.from('ok');
      },
      onError,
    });
    const err = await cache.get('k', input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 503, code: 'SHARE_RENDER_FAILED' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(cache.stats().entries).toBe(0);
    fail = false;
    expect(String(await cache.get('k', input))).toBe('ok');
  });
});

describe('escapeHtml', () => {
  it('escapes markup and both quote styles', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});
