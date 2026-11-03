import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { SessionResponse } from '@/api/types';

export const SESSION_STORAGE_KEY = 'sharkulator.session';

export type StoredSession = SessionResponse;

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const secureStoreStorage: KeyValueStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

// Web tokens live in localStorage, which page scripts can read. Static/server rendering has no
// window, so every access is guarded and degrades to "no session".
function webLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

const localStorageStorage: KeyValueStorage = {
  getItem: async (key) => webLocalStorage()?.getItem(key) ?? null,
  setItem: async (key, value) => {
    webLocalStorage()?.setItem(key, value);
  },
  removeItem: async (key) => {
    webLocalStorage()?.removeItem(key);
  },
};

export function getPlatformStorage(os: string = Platform.OS): KeyValueStorage {
  return os === 'web' ? localStorageStorage : secureStoreStorage;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const user = v.user as Record<string, unknown> | null | undefined;
  return (
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof user === 'object' &&
    user !== null &&
    typeof user.id === 'string' &&
    typeof user.username === 'string'
  );
}

export async function readSession(
  storage: KeyValueStorage = getPlatformStorage(),
): Promise<StoredSession | null> {
  const raw = await storage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isStoredSession(parsed)) return parsed;
  } catch {
    // Corrupt payloads are discarded below.
  }
  await storage.removeItem(SESSION_STORAGE_KEY);
  return null;
}

export async function writeSession(
  session: StoredSession,
  storage: KeyValueStorage = getPlatformStorage(),
): Promise<void> {
  const { accessToken, refreshToken, user } = session;
  await storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ accessToken, refreshToken, user }));
}

export async function deleteSession(
  storage: KeyValueStorage = getPlatformStorage(),
): Promise<void> {
  await storage.removeItem(SESSION_STORAGE_KEY);
}
