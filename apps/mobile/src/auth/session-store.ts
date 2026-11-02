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
  hydrate(): Promise<StoredSession | null>;
  set(session: StoredSession): Promise<void>;
  updateTokens(pair: TokenPair): Promise<void>;
  updateUser(user: User): Promise<void>;
  clear(): Promise<void>;
  subscribe(listener: SessionListener): () => void;
}

export function createSessionStore(storage?: KeyValueStorage): SessionStore {
  const backend = () => storage ?? getPlatformStorage();
  let current: StoredSession | null = null;
  const listeners = new Set<SessionListener>();

  const publish = (next: StoredSession | null) => {
    current = next;
    listeners.forEach((listener) => listener(next));
  };

  return {
    get: () => current,
    async hydrate() {
      try {
        publish(await readSession(backend()));
      } catch {
        publish(null);
      }
      return current;
    },
    async set(session) {
      publish(session);
      await writeSession(session, backend());
    },
    async updateTokens(pair) {
      if (!current) return;
      const next = { ...current, ...pair };
      publish(next);
      await writeSession(next, backend());
    },
    async updateUser(user) {
      if (!current) return;
      const next = { ...current, user };
      publish(next);
      await writeSession(next, backend());
    },
    async clear() {
      publish(null);
      await deleteSession(backend());
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
