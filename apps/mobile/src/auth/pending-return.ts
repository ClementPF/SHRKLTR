import { getPendingIntentStorage } from './pending-claim';
import type { KeyValueStorage } from './storage';

export const PENDING_RETURN_KEY = 'sharkulator.pending-return';
/** A destination not reached within this time (sign-in abandoned) is dropped instead of opened. */
export const PENDING_RETURN_TTL_MS = 60 * 60 * 1000;

/**
 * The signed-in screens a link may open after sign-in. Only these routes with a UUID are ever
 * followed, so a stored value can never lead anywhere else (other screens, other sites).
 */
export type ReturnDestination =
  | { pathname: '/games/[id]'; params: { id: string } }
  | { pathname: '/challenges/[id]'; params: { id: string } }
  | { pathname: '/groups/[id]'; params: { id: string } };

/** A protected screen opened while signed out, kept so sign-in can continue to it. */
interface PendingReturn {
  type: 'return';
  path: string;
  savedAt: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DESTINATION_PATH = /^\/(games|challenges|groups)\/([^/]+)$/;

/** The allowlisted destination for a router pathname such as `/games/<id>`, or null. */
export function returnDestinationFromPath(path: string): ReturnDestination | null {
  const [, section, id] = DESTINATION_PATH.exec(path) ?? [];
  if (!section || !id || !UUID.test(id)) return null;
  const params = { id };
  switch (section) {
    case 'games':
      return { pathname: '/games/[id]', params };
    case 'challenges':
      return { pathname: '/challenges/[id]', params };
    default:
      return { pathname: '/groups/[id]', params };
  }
}

/** Keeps `path` for after sign-in when it is an allowlisted destination; resolves whether it did. */
export async function savePendingReturn(
  path: string,
  storage: KeyValueStorage = getPendingIntentStorage(),
  now: number = Date.now(),
): Promise<boolean> {
  if (!returnDestinationFromPath(path)) return false;
  const value: PendingReturn = { type: 'return', path, savedAt: now };
  await storage.setItem(PENDING_RETURN_KEY, JSON.stringify(value));
  return true;
}

/**
 * Removes the pending destination and returns it when it is still fresh and allowlisted. A
 * destination is followed at most once.
 */
export async function takePendingReturn(
  storage: KeyValueStorage = getPendingIntentStorage(),
  now: number = Date.now(),
): Promise<ReturnDestination | null> {
  const raw = await storage.getItem(PENDING_RETURN_KEY);
  if (!raw) return null;
  await storage.removeItem(PENDING_RETURN_KEY);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { type, path, savedAt } = parsed as Record<string, unknown>;
    if (type !== 'return' || typeof path !== 'string' || typeof savedAt !== 'number') return null;
    if (now - savedAt > PENDING_RETURN_TTL_MS) return null;
    return returnDestinationFromPath(path);
  } catch {
    return null;
  }
}

export async function clearPendingReturn(
  storage: KeyValueStorage = getPendingIntentStorage(),
): Promise<void> {
  await storage.removeItem(PENDING_RETURN_KEY);
}
