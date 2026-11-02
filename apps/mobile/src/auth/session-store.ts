import type { QueryClient } from '@tanstack/react-query';

import type { TokenPair, User } from '@/api/types';
import { queryClient as defaultQueryClient } from '@/lib/query-client';

import { emitAuthLost } from './auth-events';
import {
  deleteSession,
  getPlatformStorage,
  readSession,
  writeSession,
  type KeyValueStorage,
  type StoredSession,
} from './storage';

export type SessionListener = (session: StoredSession | null) => void;

/** Side effects that belong to the session and run only inside the store's clear transitions. */
export interface SessionStoreEffects {
  queryClient?: Pick<QueryClient, 'clear'>;
  /** Called when a session is lost to expiry. Defaults to emitting the app-wide auth-lost event. */
  onAuthLost?: () => void;
}

/** In-memory source of truth for the current session, persisted through the storage adapter. */
export interface SessionStore {
  get(): StoredSession | null;
  /**
   * Increments whenever the session is replaced (hydrate, set, clear, expire) but not on token
   * or profile updates, so async work can tell whether the session it started under still exists.
   */
  generation(): number;
  hydrate(): Promise<StoredSession | null>;
  set(session: StoredSession): Promise<void>;
  /** Resolves false (and changes nothing) when `expectedGeneration` is no longer current. */
  updateTokens(pair: TokenPair, expectedGeneration?: number): Promise<boolean>;
  /** Resolves false (and changes nothing) when `expectedGeneration` is no longer current. */
  updateUser(user: User, expectedGeneration?: number): Promise<boolean>;
  /**
   * Signs out: clears the session, its storage and the query cache. Does nothing when
   * `expectedGeneration` is no longer current; skips the cache clear when another session was
   * installed while storage was being cleared. Resolves true when the cleanup ran.
   */
  clear(expectedGeneration?: number): Promise<boolean>;
  /**
   * Like `clear`, for a session whose refresh token was rejected: additionally reports auth-lost
   * and records the expiry so `expiredFrom(expectedGeneration)` holds until the next transition.
   */
  expire(expectedGeneration: number): Promise<boolean>;
  /** True while the current state is the completed expiry of the session at `generation`. */
  expiredFrom(generation: number): boolean;
  subscribe(listener: SessionListener): () => void;
}

export function createSessionStore(
  storage?: KeyValueStorage,
  effects: SessionStoreEffects = {},
): SessionStore {
  const backend = () => storage ?? getPlatformStorage();
  const { queryClient, onAuthLost = emitAuthLost } = effects;
  let current: StoredSession | null = null;
  let generation = 0;
  let lastExpiry: { from: number; to: number } | null = null;
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

  const clearTransition = (
    expectedGeneration: number | undefined,
    onCleared?: (from: number, to: number) => void,
  ): Promise<boolean> => {
    if (isStale(expectedGeneration)) return Promise.resolve(false);
    const from = generation;
    generation += 1;
    const cleared = generation;
    publish(null);
    return persist(async () => {
      try {
        await deleteSession(backend());
      } finally {
        // The generation check and the cleanup run in one synchronous step, so no session
        // installed after the check can have its cache wiped or be reported as lost.
        if (generation === cleared) {
          queryClient?.clear();
          onCleared?.(from, cleared);
        }
      }
      return generation === cleared;
    });
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
    clear: (expectedGeneration) => clearTransition(expectedGeneration),
    expire: (expectedGeneration) =>
      clearTransition(expectedGeneration, (from, to) => {
        lastExpiry = { from, to };
        onAuthLost();
      }),
    expiredFrom: (from) => lastExpiry?.from === from && lastExpiry.to === generation,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const sessionStore = createSessionStore(undefined, { queryClient: defaultQueryClient });
