import { act, render, waitFor } from '@testing-library/react-native';
import { router, usePathname } from 'expo-router';
import type { ReactNode } from 'react';

import RootLayout from '@/app/_layout';
import { PENDING_CLAIM_KEY, getPendingIntentStorage, savePendingClaim } from '@/auth/pending-claim';
import { savePendingJoin } from '@/auth/pending-join';
import {
  PENDING_RETURN_KEY,
  PENDING_RETURN_TTL_MS,
  returnDestinationFromPath,
  savePendingReturn,
  takePendingReturn,
} from '@/auth/pending-return';
import { signInToJoin } from '@/features/groups/pending-join';

import { memoryStorage } from '../test-utils/session';

const mockSecureStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockSecureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockSecureStore.delete(key);
  },
}));
jest.mock('@/notifications/use-notification-listeners', () => ({
  useNotificationListeners: jest.fn(),
}));
jest.mock('@/auth/session', () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({ session: mockSession }),
}));
jest.mock('@/theme/navigation', () => ({ NavigationTheme: {} }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-router', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
  const Stack = Object.assign(Passthrough, { Screen: () => null, Protected: Passthrough });
  return {
    Stack,
    ThemeProvider: Passthrough,
    useRootNavigationState: () => ({ key: 'root' }),
    usePathname: jest.fn(() => '/'),
    router: { push: jest.fn(), replace: jest.fn() },
  };
});

const GAME_ID = 'dbc565ce-84b7-45ce-98b4-844909516cab';
const GAME_PATH = `/games/${GAME_ID}`;
const GAME_DESTINATION = { pathname: '/games/[id]', params: { id: GAME_ID } };
const PARTICIPANT = { user: { id: 'u-participant' } };

let mockSession: { user: { id: string } } | null = null;
const mockedPathname = jest.mocked(usePathname);
const mockedRouter = jest.mocked(router);

/** Lets pending storage reads/writes and the effects they trigger finish. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Renders the root navigator at `pathname` with the given session, like a route change. */
async function at(
  view: Awaited<ReturnType<typeof render>> | null,
  pathname: string,
  session: typeof mockSession,
) {
  mockSession = session;
  mockedPathname.mockReturnValue(pathname);
  const next = view ?? (await render(<RootLayout />));
  if (view) await view.rerender(<RootLayout />);
  await settle();
  return next;
}

/** A signed-out visit to `path`, which the protected navigator then turns into sign-in. */
async function openSignedOut(path: string) {
  const view = await at(null, path, null);
  return at(view, '/login', null);
}

/** Signing in leaves /login through the index redirect and lands on Feed. */
async function signIn(view: Awaited<ReturnType<typeof render>>) {
  await at(view, '/login', PARTICIPANT);
  await at(view, '/', PARTICIPANT);
  return at(view, '/feed', PARTICIPANT);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSecureStore.clear();
  mockSession = null;
});

describe('return destination allowlist', () => {
  it('accepts only game, challenge and group detail routes with a UUID', () => {
    expect(returnDestinationFromPath(GAME_PATH)).toEqual(GAME_DESTINATION);
    expect(returnDestinationFromPath(`/challenges/${GAME_ID}`)).toEqual({
      pathname: '/challenges/[id]',
      params: { id: GAME_ID },
    });
    expect(returnDestinationFromPath(`/groups/${GAME_ID}`)).toEqual({
      pathname: '/groups/[id]',
      params: { id: GAME_ID },
    });
  });

  it.each([
    '/games/not-a-uuid',
    `/games/${GAME_ID}/edit`,
    `/games/${GAME_ID}?next=https://evil.example`,
    `//evil.example/games/${GAME_ID}`,
    `https://evil.example/games/${GAME_ID}`,
    `javascript:alert(1)//games/${GAME_ID}`,
    `/games/../settings/${GAME_ID}`,
    '/challenges/new',
    '/settings/invite',
    '/feed',
    '/',
  ])('rejects %s', async (path) => {
    expect(returnDestinationFromPath(path)).toBeNull();
    const { storage, data } = memoryStorage();
    await expect(savePendingReturn(path, storage)).resolves.toBe(false);
    expect(data.has(PENDING_RETURN_KEY)).toBe(false);
  });
});

describe('pending return storage', () => {
  it('is followed at most once', async () => {
    const { storage, data } = memoryStorage();
    await savePendingReturn(GAME_PATH, storage, 1_000);
    expect(JSON.parse(data.get(PENDING_RETURN_KEY)!)).toEqual({
      type: 'return',
      path: GAME_PATH,
      savedAt: 1_000,
    });
    await expect(takePendingReturn(storage, 2_000)).resolves.toEqual(GAME_DESTINATION);
    await expect(takePendingReturn(storage, 2_000)).resolves.toBeNull();
  });

  it('drops stale, corrupt and tampered destinations instead of following them', async () => {
    const { storage, data } = memoryStorage();
    await savePendingReturn(GAME_PATH, storage, 0);
    await expect(takePendingReturn(storage, PENDING_RETURN_TTL_MS + 1)).resolves.toBeNull();
    expect(data.has(PENDING_RETURN_KEY)).toBe(false);

    for (const raw of [
      '{not json',
      JSON.stringify({ type: 'join', path: GAME_PATH, savedAt: 0 }),
      JSON.stringify({ type: 'return', path: `https://evil.example${GAME_PATH}`, savedAt: 0 }),
      JSON.stringify({ type: 'return', path: '/settings/invite', savedAt: 0 }),
    ]) {
      data.set(PENDING_RETURN_KEY, raw);
      await expect(takePendingReturn(storage, 1)).resolves.toBeNull();
      expect(data.has(PENDING_RETURN_KEY)).toBe(false);
    }
  });

  it('keeps the web destination in sessionStorage so a reload of the tab keeps it', async () => {
    const values = new Map<string, string>();
    const fake = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => void values.set(k, v),
      removeItem: (k: string) => void values.delete(k),
    };
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', { value: fake, configurable: true });
    try {
      await savePendingReturn(GAME_PATH, getPendingIntentStorage('web'));
      expect(values.has(PENDING_RETURN_KEY)).toBe(true);
      await expect(takePendingReturn(getPendingIntentStorage('web'))).resolves.toEqual(
        GAME_DESTINATION,
      );
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
      else delete (window as { sessionStorage?: unknown }).sessionStorage;
    }
  });
});

describe('signed-out deep link through the root navigator', () => {
  it('opens the game from the incoming URL after sign-in instead of stopping at Feed', async () => {
    const view = await openSignedOut(GAME_PATH);
    expect(mockSecureStore.has(PENDING_RETURN_KEY)).toBe(true);

    await at(view, '/login', PARTICIPANT);
    expect(mockedRouter.push).not.toHaveBeenCalled();
    await signIn(view);

    await waitFor(() => expect(mockedRouter.push).toHaveBeenCalledWith(GAME_DESTINATION));
    expect(mockedRouter.push).toHaveBeenCalledTimes(1);
    expect(mockSecureStore.has(PENDING_RETURN_KEY)).toBe(false);
  });

  it('keeps the game across a reload of the login page and the OAuth redirect back', async () => {
    const first = await openSignedOut(GAME_PATH);
    await first.unmount();

    // Reloading /login starts a new app whose incoming URL no longer names the game.
    const reloaded = await at(null, '/login', null);
    // Google returns to the app (native redirect path, web popup root) before the session exists.
    await at(reloaded, '/oauthredirect', null);
    await at(reloaded, '/', null);
    await at(reloaded, '/login', null);
    expect(mockSecureStore.has(PENDING_RETURN_KEY)).toBe(true);

    await signIn(reloaded);
    await waitFor(() => expect(mockedRouter.push).toHaveBeenCalledWith(GAME_DESTINATION));
  });

  it('keeps ordinary sign-in on Feed', async () => {
    const view = await at(null, '/login', null);
    await signIn(view);
    await settle();
    expect(mockedRouter.push).not.toHaveBeenCalled();
  });

  it('never follows unsafe or non-allowlisted incoming routes', async () => {
    const view = await openSignedOut('/settings/invite');
    await at(view, '/games/not-a-uuid', null);
    await at(view, '/login', null);
    expect(mockSecureStore.has(PENDING_RETURN_KEY)).toBe(false);
    await signIn(view);
    await settle();
    expect(mockedRouter.push).not.toHaveBeenCalled();
  });

  it('does not keep the game screen a sign-out left, so the next sign-in opens Feed', async () => {
    const view = await at(null, GAME_PATH, PARTICIPANT);
    // Signing out on the game: the guard redirects from the still-current game route.
    await at(view, GAME_PATH, null);
    await at(view, '/', null);
    await at(view, '/login', null);
    expect(mockSecureStore.has(PENDING_RETURN_KEY)).toBe(false);

    await signIn(view);
    await settle();
    expect(mockedRouter.push).not.toHaveBeenCalled();
  });

  it('follows a destination once: signing out and in again opens Feed', async () => {
    const view = await openSignedOut(GAME_PATH);
    await signIn(view);
    await waitFor(() => expect(mockedRouter.push).toHaveBeenCalledTimes(1));

    await at(view, '/login', null);
    await signIn(view);
    await settle();
    expect(mockedRouter.push).toHaveBeenCalledTimes(1);
  });

  it('drops a stale destination instead of opening it', async () => {
    await savePendingReturn(GAME_PATH, undefined, Date.now() - PENDING_RETURN_TTL_MS - 1);
    const view = await at(null, '/login', null);
    await signIn(view);
    await settle();
    expect(mockedRouter.push).not.toHaveBeenCalled();
    expect(mockSecureStore.has(PENDING_RETURN_KEY)).toBe(false);
  });
});

describe('claim and join intents keep priority', () => {
  it('resumes a pending join, not a game opened afterwards', async () => {
    await savePendingJoin({ token: 'tok-1', groupName: 'Shark Tank' });
    const view = await openSignedOut(GAME_PATH);
    expect(mockSecureStore.has(PENDING_RETURN_KEY)).toBe(false);

    await signIn(view);
    await waitFor(() =>
      expect(mockedRouter.push).toHaveBeenCalledWith({
        pathname: '/join/[token]',
        params: { token: 'tok-1' },
      }),
    );
    expect(mockedRouter.push).not.toHaveBeenCalledWith(GAME_DESTINATION);
  });

  it('signing in to join drops a game opened before it', async () => {
    const view = await openSignedOut(GAME_PATH);
    await act(async () => {
      await signInToJoin({ token: 'tok-1', groupName: 'Shark Tank' });
    });
    expect(mockSecureStore.has(PENDING_RETURN_KEY)).toBe(false);
    mockedRouter.push.mockClear();

    await signIn(view);
    await waitFor(() =>
      expect(mockedRouter.push).toHaveBeenCalledWith({
        pathname: '/join/[token]',
        params: { token: 'tok-1' },
      }),
    );
    expect(mockedRouter.push).toHaveBeenCalledTimes(1);
  });

  it('does not keep a game opened while a claim is pending, and never opens one over it', async () => {
    await savePendingClaim({ token: 'claim-tok', playerName: 'Riley Guest' });
    const view = await openSignedOut(GAME_PATH);
    expect(mockSecureStore.has(PENDING_RETURN_KEY)).toBe(false);

    // Even a destination stored alongside the claim is not followed by the claim's sign-in.
    await savePendingReturn(GAME_PATH);
    await signIn(view);
    await settle();
    expect(mockedRouter.push).not.toHaveBeenCalled();
    expect(mockSecureStore.has(PENDING_RETURN_KEY)).toBe(false);
    expect(mockSecureStore.has(PENDING_CLAIM_KEY)).toBe(true);
  });
});
