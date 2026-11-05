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

/** Tests swap the backing store; null restores SecureStore. */
export function setInstallationIdStorage(next: KeyValueStorage | null): void {
  storage = next ?? secureStore;
  cached = null;
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
  cached = await storage.getItem(INSTALLATION_ID_KEY);
  return cached;
}

/** Stable across launches and accounts, so the server keeps one device row per installation. */
export async function getOrCreateInstallationId(): Promise<string> {
  const existing = await readInstallationId();
  if (existing) return existing;
  const created = randomId();
  await storage.setItem(INSTALLATION_ID_KEY, created);
  cached = created;
  return created;
}
