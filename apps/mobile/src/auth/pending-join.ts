import { getPendingIntentStorage } from './pending-claim';
import type { KeyValueStorage } from './storage';

export const PENDING_JOIN_KEY = 'sharkulator.pending-join';
/** A join left unfinished for longer than this is dropped instead of resumed. */
export const PENDING_JOIN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A group invitation opened while signed out, kept across sign-in (web reload, native restart)
 * so it can be confirmed afterwards. Holding it never joins anything by itself.
 */
export type PendingJoin =
  | { type: 'join'; token: string; groupName: string; savedAt: number }
  | { type: 'join'; code: string; savedAt: number };

export type PendingJoinInput = { token: string; groupName: string } | { code: string };

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function isPendingJoin(value: unknown): value is PendingJoin {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.type !== 'join' || typeof v.savedAt !== 'number') return false;
  if ('token' in v) return nonEmpty(v.token) && typeof v.groupName === 'string' && !('code' in v);
  return nonEmpty(v.code);
}

export async function savePendingJoin(
  join: PendingJoinInput,
  storage: KeyValueStorage = getPendingIntentStorage(),
  now: number = Date.now(),
): Promise<void> {
  const value: PendingJoin =
    'token' in join
      ? { type: 'join', token: join.token, groupName: join.groupName, savedAt: now }
      : { type: 'join', code: join.code, savedAt: now };
  await storage.setItem(PENDING_JOIN_KEY, JSON.stringify(value));
}

/** The unexpired pending join, or null. Corrupt or stale entries are removed. */
export async function readPendingJoin(
  storage: KeyValueStorage = getPendingIntentStorage(),
  now: number = Date.now(),
): Promise<PendingJoin | null> {
  const raw = await storage.getItem(PENDING_JOIN_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPendingJoin(parsed) && now - parsed.savedAt <= PENDING_JOIN_TTL_MS) return parsed;
  } catch {
    // Corrupt payloads are discarded below.
  }
  await storage.removeItem(PENDING_JOIN_KEY);
  return null;
}

export async function clearPendingJoin(
  storage: KeyValueStorage = getPendingIntentStorage(),
): Promise<void> {
  await storage.removeItem(PENDING_JOIN_KEY);
}
