import type { TokenPair, User } from '@/api/types';

import {
  deleteSession,
  getPlatformStorage,
  readSession,
  writeSession,
  type KeyValueStorage,
  type StoredSession,
} from './storage';

export type SessionListener = (session: StoredSession | null) => void;

/** In-memory source of truth for the current session, persisted through the storage adapter. */
export interface SessionStore {
  get(): StoredSession | null;
  /**
   * Increments whenever the session is replaced (hydrate, set, clear) but not on token or
   * profile updates, so async work can tell whether the session it started under still exists.
   */
  generation(): number;
  hydrate(): Promise<StoredSession | null>;
  set(session: StoredSession): Promise<void>;
  /** Resolves false (and changes nothing) when `expectedGeneration` is no longer current. */
  updateTokens(pair: TokenPair, expectedGeneration?: number): Promise<boolean>;
  /** Resolves false (and changes nothing) when `expectedGeneration` is no longer current. */
  updateUser(user: User, expectedGeneration?: number): Promise<boolean>;
  /**
   * Resolves false (and changes nothing) when `expectedGeneration` is no longer current. Also
   * resolves false when another session was installed while storage was being cleared, so
   * sign-out side effects (cache clear, auth-lost) can be skipped for the replacement session.
   */
  clear(expectedGeneration?: number): Promise<boolean>;
  subscribe(listener: SessionListener): () => void;
}

export function createSessionStore(storage?: KeyValueStorage): SessionStore {
  const backend = () => storage ?? getPlatformStorage();
  let current: StoredSession | null = null;
  let generation = 0;
  const listeners = new Set<SessionListener>();

  // Storage operations run one at a time in call order, so a slow write or delete for a
  // replaced session can never land after (and overwrite) the session that replaced it.
  let storageQueue: Promise<unknown> = Promise.resolve();
  const persist = <T>(op: () => Promise<T>): Promise<T> => {
    const run = storageQueue.then(op);
    storageQueue = run.catch(() => undefined);
    return run;
  };

  const isStale = (expected: number | undefined) =>
    expected !== undefined && expected !== generation;

  const publish = (next: StoredSession | null) => {
    current = next;
    listeners.forEach((listener) => listener(next));
  };

  return {
    get: () => current,
    generation: () => generation,
    async hydrate() {
      const started = generation;
      const restored = await persist(() => readSession(backend())).catch(() => null);
      // A login or logout while storage was being read is newer than what was stored.
      if (generation !== started) return current;
      generation += 1;
      publish(restored);
      return current;
    },
    async set(session) {
      generation += 1;
      publish(session);
      await persist(() => writeSession(session, backend()));
    },
    async updateTokens(pair, expectedGeneration) {
      if (!current || isStale(expectedGeneration)) return false;
      const next = { ...current, ...pair };
      publish(next);
      await persist(() => writeSession(next, backend()));
      return true;
    },
    async updateUser(user, expectedGeneration) {
      if (!current || isStale(expectedGeneration)) return false;
      const next = { ...current, user };
      publish(next);
      await persist(() => writeSession(next, backend()));
      return true;
    },
    async clear(expectedGeneration) {
      if (isStale(expectedGeneration)) return false;
      generation += 1;
      const cleared = generation;
      publish(null);
      await persist(() => deleteSession(backend()));
      return generation === cleared;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const sessionStore = createSessionStore();
