import { create } from 'zustand';

import { sessionStore } from '@/auth/session-store';
import { getPlatformStorage, type KeyValueStorage } from '@/auth/storage';

export const ISSUED_LINKS_KEY = 'sharkulator.issued-links';
/** Keeps the persisted blob small (SecureStore values should stay under ~2 KB). */
export const MAX_REMEMBERED_CLAIM_LINKS = 10;

export interface RememberedClaimLink {
  url: string;
  expiresAt: string;
}

/**
 * Links whose raw URL the server returns only once (claim links, the app invitation). The
 * creator's device keeps them so they can be copied again without rotating the link. They are
 * scoped to the signed-in account and wiped on sign-out.
 */
interface IssuedLinksState {
  ownerId: string | null;
  hydrated: boolean;
  appInviteUrl: string | null;
  claims: Record<string, RememberedClaimLink>;
}

interface Snapshot {
  ownerId: string;
  appInviteUrl: string | null;
  claims: Record<string, RememberedClaimLink>;
}

const EMPTY: IssuedLinksState = { ownerId: null, hydrated: false, appInviteUrl: null, claims: {} };

export const useIssuedLinksStore = create<IssuedLinksState>(() => EMPTY);

let storageOverride: KeyValueStorage | null = null;
const storage = () => storageOverride ?? getPlatformStorage();

/** Test seam: replaces the persistent storage. */
export function setIssuedLinksStorage(next: KeyValueStorage | null): void {
  storageOverride = next;
}

function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ownerId === 'string' &&
    (v.appInviteUrl === null || typeof v.appInviteUrl === 'string') &&
    typeof v.claims === 'object' &&
    v.claims !== null
  );
}

async function persist(): Promise<void> {
  const { ownerId, appInviteUrl, claims } = useIssuedLinksStore.getState();
  try {
    if (!ownerId) {
      await storage().removeItem(ISSUED_LINKS_KEY);
      return;
    }
    const snapshot: Snapshot = { ownerId, appInviteUrl, claims };
    await storage().setItem(ISSUED_LINKS_KEY, JSON.stringify(snapshot));
  } catch {
    // Remembering links is a convenience; the server can always issue a fresh one.
  }
}

function forOwner(ownerId: string): IssuedLinksState {
  const state = useIssuedLinksStore.getState();
  return state.ownerId === ownerId ? state : { ...EMPTY, ownerId };
}

/** Loads the links remembered for this account; in-memory entries win over stored ones. */
export async function hydrateIssuedLinks(ownerId: string): Promise<void> {
  const current = useIssuedLinksStore.getState();
  if (current.ownerId === ownerId && current.hydrated) return;
  let stored: Snapshot | null = null;
  try {
    const raw = await storage().getItem(ISSUED_LINKS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (isSnapshot(parsed) && parsed.ownerId === ownerId) stored = parsed;
  } catch {
    stored = null;
  }
  const latest = forOwner(ownerId);
  useIssuedLinksStore.setState({
    ownerId,
    hydrated: true,
    appInviteUrl: latest.appInviteUrl ?? stored?.appInviteUrl ?? null,
    claims: { ...stored?.claims, ...latest.claims },
  });
}

export function rememberClaimLink(ownerId: string, playerId: string, link: RememberedClaimLink) {
  const state = forOwner(ownerId);
  const others = Object.entries(state.claims).filter(([id]) => id !== playerId);
  const kept = others.slice(-(MAX_REMEMBERED_CLAIM_LINKS - 1));
  useIssuedLinksStore.setState({
    ...state,
    claims: Object.fromEntries([...kept, [playerId, link]]),
  });
  void persist();
}

export function forgetClaimLink(ownerId: string, playerId: string) {
  const state = forOwner(ownerId);
  if (!(playerId in state.claims)) return;
  const claims = { ...state.claims };
  delete claims[playerId];
  useIssuedLinksStore.setState({ ...state, claims });
  void persist();
}

export function rememberAppInvite(ownerId: string, url: string) {
  useIssuedLinksStore.setState({ ...forOwner(ownerId), appInviteUrl: url });
  void persist();
}

export function clearIssuedLinks(): Promise<void> {
  useIssuedLinksStore.setState(EMPTY);
  return persist();
}

sessionStore.subscribe((session) => {
  const { ownerId } = useIssuedLinksStore.getState();
  if (!session || (ownerId && session.user.id !== ownerId)) void clearIssuedLinks();
});
