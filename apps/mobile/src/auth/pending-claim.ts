import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { KeyValueStorage } from './storage';

export const PENDING_CLAIM_KEY = 'sharkulator.pending-claim';
/** A claim left unfinished for longer than this is dropped instead of resumed. */
export const PENDING_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A claim started from a public claim link, kept across the Google sign-in round trip (web
 * reload, native app restart). The token never goes into OAuth state or redirect parameters.
 */
export interface PendingClaim {
  type: 'claim';
  token: string;
  /** Display name of the player being claimed, shown while resuming. Not a secret. */
  playerName: string;
  savedAt: number;
}

// Web keeps the intent per tab (sessionStorage) so it survives a reload but not the browser.
function webSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

const sessionStorageAdapter: KeyValueStorage = {
  getItem: async (key) => webSessionStorage()?.getItem(key) ?? null,
  setItem: async (key, value) => {
    webSessionStorage()?.setItem(key, value);
  },
  removeItem: async (key) => {
    webSessionStorage()?.removeItem(key);
  },
};

const secureStoreAdapter: KeyValueStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export function getPendingIntentStorage(os: string = Platform.OS): KeyValueStorage {
  return os === 'web' ? sessionStorageAdapter : secureStoreAdapter;
}

function isPendingClaim(value: unknown): value is PendingClaim {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'claim' &&
    typeof v.token === 'string' &&
    v.token.length > 0 &&
    typeof v.playerName === 'string' &&
    typeof v.savedAt === 'number'
  );
}

export async function savePendingClaim(
  claim: { token: string; playerName: string },
  storage: KeyValueStorage = getPendingIntentStorage(),
  now: number = Date.now(),
): Promise<void> {
  const value: PendingClaim = {
    type: 'claim',
    token: claim.token,
    playerName: claim.playerName,
    savedAt: now,
  };
  await storage.setItem(PENDING_CLAIM_KEY, JSON.stringify(value));
}

/** The unexpired pending claim, or null. Corrupt or stale entries are removed. */
export async function readPendingClaim(
  storage: KeyValueStorage = getPendingIntentStorage(),
  now: number = Date.now(),
): Promise<PendingClaim | null> {
  const raw = await storage.getItem(PENDING_CLAIM_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPendingClaim(parsed) && now - parsed.savedAt <= PENDING_CLAIM_TTL_MS) return parsed;
  } catch {
    // Corrupt payloads are discarded below.
  }
  await storage.removeItem(PENDING_CLAIM_KEY);
  return null;
}

export async function clearPendingClaim(
  storage: KeyValueStorage = getPendingIntentStorage(),
): Promise<void> {
  await storage.removeItem(PENDING_CLAIM_KEY);
}
