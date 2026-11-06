import { ApiError } from './errors.js';

export const SHARE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
export const SHARE_CACHE_MAX_ENTRIES = 128;
export const SHARE_RENDER_CONCURRENCY = 2;
/** Renders allowed to wait for a slot; beyond this requests fail fast with 503. */
export const SHARE_RENDER_MAX_QUEUE = 32;

export interface ShareCardCacheOptions<T> {
  render: (input: T) => Promise<Buffer>;
  maxBytes?: number;
  maxEntries?: number;
  concurrency?: number;
  maxQueue?: number;
  onError?: (err: unknown) => void;
}

export interface ShareCardCache<T> {
  /**
   * The PNG for `key`, rendered from `input` on a miss. Callers must authorize the share before
   * calling: a cached image says nothing about whether its share is still active.
   */
  get(key: string, input: T): Promise<Buffer>;
  stats(): { entries: number; bytes: number; inFlight: number; queued: number };
  clear(): void;
}

export function renderFailed(): ApiError {
  return new ApiError(503, 'SHARE_RENDER_FAILED', 'The result image could not be rendered');
}

/**
 * Bounded in-memory LRU of rendered share cards. Identical concurrent misses share one render,
 * at most `concurrency` renders run at once and at most `maxQueue` wait for a slot.
 */
export function createShareCardCache<T>(options: ShareCardCacheOptions<T>): ShareCardCache<T> {
  const maxBytes = options.maxBytes ?? SHARE_CACHE_MAX_BYTES;
  const maxEntries = options.maxEntries ?? SHARE_CACHE_MAX_ENTRIES;
  const concurrency = options.concurrency ?? SHARE_RENDER_CONCURRENCY;
  const maxQueue = options.maxQueue ?? SHARE_RENDER_MAX_QUEUE;

  // Map iteration order is insertion order, so the first key is the least recently used.
  const entries = new Map<string, Buffer>();
  let bytes = 0;
  const inFlight = new Map<string, Promise<Buffer>>();
  let active = 0;
  const waiting: (() => void)[] = [];

  function remember(key: string, png: Buffer): void {
    if (png.byteLength > maxBytes || maxEntries < 1) return;
    entries.set(key, png);
    bytes += png.byteLength;
    while (entries.size > maxEntries || bytes > maxBytes) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      bytes -= entries.get(oldest.value)?.byteLength ?? 0;
      entries.delete(oldest.value);
    }
  }

  async function acquire(): Promise<void> {
    if (active < concurrency) {
      active += 1;
      return;
    }
    if (waiting.length >= maxQueue) throw renderFailed();
    // The releasing render hands its slot over directly, so `active` stays unchanged.
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  function release(): void {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }

  async function renderBounded(input: T): Promise<Buffer> {
    await acquire();
    try {
      return await options.render(input);
    } catch (err) {
      options.onError?.(err);
      throw renderFailed();
    } finally {
      release();
    }
  }

  return {
    get(key, input) {
      const hit = entries.get(key);
      if (hit) {
        entries.delete(key);
        entries.set(key, hit);
        return Promise.resolve(hit);
      }
      const pending = inFlight.get(key);
      if (pending) return pending;
      const started = renderBounded(input)
        .then((png) => {
          remember(key, png);
          return png;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, started);
      return started;
    },
    stats: () => ({
      entries: entries.size,
      bytes,
      inFlight: inFlight.size,
      queued: waiting.length,
    }),
    clear() {
      entries.clear();
      bytes = 0;
    },
  };
}
