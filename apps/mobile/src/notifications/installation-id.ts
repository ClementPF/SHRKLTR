import * as SecureStore from 'expo-secure-store';

import type { KeyValueStorage } from '@/auth/storage';

export const INSTALLATION_ID_KEY = 'sharkulator.installation-id';

const secureStore: KeyValueStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

let storage: KeyValueStorage = secureStore;
let cached: string | null = null;
let initializing: Promise<string> | null = null;

/** Tests swap the backing store; null restores SecureStore. */
export function setInstallationIdStorage(next: KeyValueStorage | null): void {
  storage = next ?? secureStore;
  cached = null;
  initializing = null;
}

// Identifies the installation, not a secret: it only has to be unique per device.
function randomId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** The stored installation ID, or null if this installation never registered for push. */
export async function readInstallationId(): Promise<string | null> {
  if (cached) return cached;
  const backing = storage;
  const stored = await backing.getItem(INSTALLATION_ID_KEY);
  if (backing !== storage) return stored;
  if (stored && !cached) cached = stored;
  return cached;
}

async function loadOrPersistId(backing: KeyValueStorage): Promise<string> {
  const stored = await backing.getItem(INSTALLATION_ID_KEY);
  if (stored) return stored;
  const created = randomId();
  await backing.setItem(INSTALLATION_ID_KEY, created);
  return created;
}

/**
 * Stable across launches and accounts, so the server keeps one device row per installation.
 * Overlapping callers (sign-in registration and the token-listener event it triggers on iOS)
 * share one read/create/persist; otherwise each could see empty storage and register its own ID.
 */
export function getOrCreateInstallationId(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  if (initializing) return initializing;
  const attempt = loadOrPersistId(storage);
  initializing = attempt;
  // Registered before any caller's continuation, so callers resolve with the cache already set.
  attempt.then(
    (id) => {
      if (initializing !== attempt) return;
      cached = id;
      initializing = null;
    },
    () => {
      if (initializing === attempt) initializing = null;
    },
  );
  return attempt;
}
