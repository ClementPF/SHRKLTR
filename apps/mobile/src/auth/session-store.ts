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
  updateUser(user: User): Promise<void>;
  /** Resolves false (and changes nothing) when `expectedGeneration` is no longer current. */
  clear(expectedGeneration?: number): Promise<boolean>;
  subscribe(listener: SessionListener): () => void;
}

export function createSessionStore(storage?: KeyValueStorage): SessionStore {
  const backend = () => storage ?? getPlatformStorage();
  let current: StoredSession | null = null;
  let generation = 0;
  const listeners = new Set<SessionListener>();

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
      const restored = await readSession(backend()).catch(() => null);
      generation += 1;
      publish(restored);
      return current;
    },
    async set(session) {
      generation += 1;
      publish(session);
      await writeSession(session, backend());
    },
    async updateTokens(pair, expectedGeneration) {
      if (!current || isStale(expectedGeneration)) return false;
      const next = { ...current, ...pair };
      publish(next);
      await writeSession(next, backend());
      return true;
    },
    async updateUser(user) {
      if (!current) return;
      const next = { ...current, user };
      publish(next);
      await writeSession(next, backend());
    },
    async clear(expectedGeneration) {
      if (isStale(expectedGeneration)) return false;
      generation += 1;
      publish(null);
      await deleteSession(backend());
      return true;
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
