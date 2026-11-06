import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import type { AuthSessionResult } from 'expo-auth-session';
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactElement } from 'react';
import { Platform } from 'react-native';

import * as endpoints from '@/api/endpoints';
import { exchangeGoogleCode } from '@/api/endpoints';
import LoginRoute from '@/app/(auth)/login';
import { ApiError } from '@/api/errors';
import type { ClaimPreview, Game, User } from '@/api/types';
import { GOOGLE_WEB_REDIRECT_URI, googleRedirectUri } from '@/auth/google';
import {
  PENDING_CLAIM_KEY,
  PENDING_CLAIM_TTL_MS,
  clearPendingClaim,
  getPendingIntentStorage,
  readPendingClaim,
  savePendingClaim,
} from '@/auth/pending-claim';
import { PENDING_RETURN_KEY, savePendingReturn } from '@/auth/pending-return';
import { useSession, type SessionContextValue } from '@/auth/session';
import { LoginScreen } from '@/features/auth/login-screen';
import { AppInviteLanding } from '@/features/invites/app-invite-landing';
import {
  CLAIM_UNUSABLE_TEXT,
  EXISTING_ACCOUNT_TEXT,
  NEW_ACCOUNT_ONLY_TEXT,
} from '@/features/invites/claim-sign-in';
import { CLAIM_UNUSABLE_TITLE, ClaimScreen } from '@/features/invites/claim-screen';

import { deferred, jsonResponse, makeSession, memoryStorage } from '../test-utils/session';

const mockSecureStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));
jest.mock('expo-auth-session', () => ({
  ...jest.requireActual<typeof import('expo-auth-session')>('expo-auth-session'),
  useAuthRequest: jest.fn(),
  makeRedirectUri: jest.fn(() => 'com.elo.sharkulator:/oauthredirect'),
}));
jest.mock('@/api/endpoints', () => ({
  ...jest.requireActual<typeof import('@/api/endpoints')>('@/api/endpoints'),
  getClaimPreview: jest.fn(),
  getAppInvitePreview: jest.fn(),
}));
jest.mock('@/auth/session', () => ({ useSession: jest.fn() }));
jest.mock('@/api/config', () => ({
  ...jest.requireActual<typeof import('@/api/config')>('@/api/config'),
  GOOGLE_CLIENT_ID: 'test-client-id',
}));
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    router: { push: jest.fn(), replace: jest.fn(), navigate: jest.fn() },
    useLocalSearchParams: jest.fn(() => ({})),
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>,
    Link: (props: { href: string; target?: string; testID?: string; children: string }) => (
      <Text {...props} accessibilityRole="link" />
    ),
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockedUseAuthRequest = jest.mocked(AuthSession.useAuthRequest);
const mockedSession = jest.mocked(useSession);
const getClaimPreview = jest.mocked(endpoints.getClaimPreview);
const getAppInvitePreview = jest.mocked(endpoints.getAppInvitePreview);
const mockedParams = jest.mocked(useLocalSearchParams);

const TOKEN = 'claim-token-abc';

const placeholder: User = {
  id: 'p-riley',
  username: 'guest-riley',
  accountType: 'PLACEHOLDER',
  firstName: 'Riley',
  lastName: 'Guest',
  pictureUrl: null,
  locale: null,
};
const creator: User = {
  ...placeholder,
  id: 'u-alex',
  username: 'dev-alex',
  accountType: 'REGISTERED',
  firstName: 'Alex',
  lastName: 'Martin',
};

const previewGame: Game = {
  id: 'g1',
  date: new Date(Date.now() - 3_600_000).toISOString(),
  tournament: {
    id: 't1',
    name: 'officebabyfoot',
    displayName: 'Office Babyfoot',
    isOver: false,
    sport: { id: 's1', name: 'babyfoot' },
    owner: null,
  },
  outcomes: [
    { id: 'o1', result: 'WIN', scoreValue: 16, ratingBefore: 1000, user: placeholder },
    { id: 'o2', result: 'LOSS', scoreValue: -16, ratingBefore: 1000, user: creator },
  ],
};

const preview: ClaimPreview = {
  player: placeholder,
  invitedBy: creator,
  expiresAt: '2026-12-05T07:00:00.000Z',
  gamesCount: 1,
  recentGames: [previewGame],
  stats: [],
};

// Mutable Google response the mocked useAuthRequest hands to useGoogleSignIn on each render.
let authResponse: AuthSessionResult | null = null;
const promptAsync = jest.fn(async () => ({ type: 'dismiss' }) as AuthSessionResult);

function sessionValue(overrides: Partial<SessionContextValue> = {}): SessionContextValue {
  return {
    status: 'unauthenticated',
    session: null,
    user: null,
    loginWithGoogleCode: jest.fn(async () => undefined),
    loginWithDevUser: jest.fn(async () => undefined),
    logout: jest.fn(async () => undefined),
    refresh: jest.fn(async () => false),
    ...overrides,
  };
}

let client: QueryClient;
function renderWithClient(ui: ReactElement) {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function googleReturns(response: AuthSessionResult) {
  authResponse = response;
}

const success = { type: 'success', params: { code: 'auth-code' } } as unknown as AuthSessionResult;

beforeEach(() => {
  jest.clearAllMocks();
  mockSecureStore.clear();
  authResponse = null;
  mockedUseAuthRequest.mockImplementation(() => [
    { codeVerifier: 'v'.repeat(43) } as AuthSession.AuthRequest,
    authResponse,
    promptAsync,
  ]);
  getClaimPreview.mockResolvedValue(preview);
});

describe('pending claim storage', () => {
  it('saves, reads and clears a typed claim intent', async () => {
    const { storage, data } = memoryStorage();
    await savePendingClaim({ token: TOKEN, playerName: 'Riley Guest' }, storage, 1_000);
    expect(JSON.parse(data.get(PENDING_CLAIM_KEY)!)).toEqual({
      type: 'claim',
      token: TOKEN,
      playerName: 'Riley Guest',
      savedAt: 1_000,
    });
    await expect(readPendingClaim(storage, 2_000)).resolves.toMatchObject({ token: TOKEN });
    await clearPendingClaim(storage);
    await expect(readPendingClaim(storage, 2_000)).resolves.toBeNull();
  });

  it('drops stale and corrupt intents', async () => {
    const { storage, data } = memoryStorage();
    await savePendingClaim({ token: TOKEN, playerName: 'Riley' }, storage, 0);
    await expect(readPendingClaim(storage, PENDING_CLAIM_TTL_MS + 1)).resolves.toBeNull();
    expect(data.has(PENDING_CLAIM_KEY)).toBe(false);

    data.set(PENDING_CLAIM_KEY, '{"type":"join","token":"x"}');
    await expect(readPendingClaim(storage)).resolves.toBeNull();
    expect(data.has(PENDING_CLAIM_KEY)).toBe(false);
  });

  it('keeps the web intent in sessionStorage so it survives a reload of the tab', async () => {
    const values = new Map<string, string>();
    const fake = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => void values.set(k, v),
      removeItem: (k: string) => void values.delete(k),
    };
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', { value: fake, configurable: true });
    try {
      const storage = getPendingIntentStorage('web');
      await savePendingClaim({ token: TOKEN, playerName: 'Riley' }, storage);
      expect(values.has(PENDING_CLAIM_KEY)).toBe(true);
      await expect(readPendingClaim(getPendingIntentStorage('web'))).resolves.toMatchObject({
        token: TOKEN,
      });
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
      else delete (window as { sessionStorage?: unknown }).sessionStorage;
    }
  });
});

describe('Google exchange payload', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('forwards claimToken on POST /auth/google/code only when a claim is in progress', async () => {
    const fetchFn = jest.fn<Promise<Response>, [string, RequestInit]>(async () =>
      jsonResponse(200, makeSession()),
    );
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    const base = { code: 'c', codeVerifier: 'v', redirectUri: 'http://localhost:8083' };

    await exchangeGoogleCode({ ...base, claimToken: TOKEN });
    await exchangeGoogleCode(base);

    expect(JSON.parse(fetchFn.mock.calls[0]![1].body as string)).toStrictEqual({
      ...base,
      claimToken: TOKEN,
    });
    expect(JSON.parse(fetchFn.mock.calls[1]![1].body as string)).toStrictEqual(base);
    // The claim token never travels in the URL.
    expect(fetchFn.mock.calls[0]![0]).not.toContain(TOKEN);
  });

  it('derives the web redirect from EXPO_PUBLIC_WEB_URL (default http://localhost:8083)', () => {
    expect(GOOGLE_WEB_REDIRECT_URI).toBe('http://localhost:8083');
    expect(googleRedirectUri('web')).toBe(GOOGLE_WEB_REDIRECT_URI);
  });
});

describe('ClaimScreen', () => {
  it('previews the player publicly with the new-account restriction, without consuming', async () => {
    mockedSession.mockReturnValue(sessionValue());
    await renderWithClient(<ClaimScreen token={TOKEN} />);

    expect(await screen.findByText('Riley Guest')).toBeTruthy();
    expect(screen.getByText('@guest-riley')).toBeTruthy();
    expect(screen.getAllByText('UNCLAIMED').length).toBeGreaterThan(0);
    expect(screen.getByTestId('claim-games-count')).toHaveTextContent('1 game played');
    expect(screen.getByText('Added by Alex Martin')).toBeTruthy();
    expect(screen.getByText('Only a new account can claim')).toBeTruthy();
    expect(screen.getByText(NEW_ACCOUNT_ONLY_TEXT)).toBeTruthy();
    expect(screen.getByTestId('game-row-g1')).toBeTruthy();
    expect(getClaimPreview).toHaveBeenCalledWith(TOKEN);
    expect(promptAsync).not.toHaveBeenCalled();
  });

  it('shows an unusable-link state without any player history for a 404 CLAIM_INVALID', async () => {
    mockedSession.mockReturnValue(sessionValue());
    getClaimPreview.mockRejectedValue(new ApiError(404, 'CLAIM_INVALID', 'invalid'));
    await renderWithClient(<ClaimScreen token="unknown" />);

    expect(await screen.findByText(CLAIM_UNUSABLE_TITLE)).toBeTruthy();
    expect(screen.getByText(CLAIM_UNUSABLE_TEXT)).toBeTruthy();
    expect(screen.queryByText('Riley Guest')).toBeNull();
    expect(screen.queryByLabelText('Claim with Google')).toBeNull();
    expect(getClaimPreview).toHaveBeenCalledTimes(1);
  });

  it('stores a pending claim, sends claimToken with the code exchange and clears it on success', async () => {
    const loginWithGoogleCode = jest.fn(async () => undefined);
    mockedSession.mockReturnValue(sessionValue({ loginWithGoogleCode }));
    const view = await renderWithClient(<ClaimScreen token={TOKEN} />);

    await fireEvent.press(await screen.findByLabelText('Claim with Google'));
    expect(promptAsync).toHaveBeenCalledTimes(1);
    await waitFor(async () =>
      expect(await readPendingClaim()).toMatchObject({ token: TOKEN, playerName: 'Riley Guest' }),
    );
    // OAuth request config never carries the claim token.
    expect(JSON.stringify(mockedUseAuthRequest.mock.lastCall?.[0])).not.toContain(TOKEN);

    googleReturns(success);
    mockedSession.mockReturnValue(
      sessionValue({
        loginWithGoogleCode,
        session: makeSession({ user: { ...placeholder, accountType: 'REGISTERED' } }),
      }),
    );
    await view.rerender(
      <QueryClientProvider client={client}>
        <ClaimScreen token={TOKEN} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(loginWithGoogleCode).toHaveBeenCalledTimes(1));
    expect(loginWithGoogleCode).toHaveBeenCalledWith({
      code: 'auth-code',
      codeVerifier: 'v'.repeat(43),
      redirectUri: 'com.elo.sharkulator:/oauthredirect',
      claimToken: TOKEN,
    });
    expect(await screen.findByTestId('redirect')).toHaveTextContent('/feed');
    await expect(readPendingClaim()).resolves.toBeNull();
  });

  it('shows the new-account restriction when an existing account is rejected, keeping the claim', async () => {
    const loginWithGoogleCode = jest.fn(async () => {
      throw new ApiError(400, 'CLAIM_REQUIRES_NEW_ACCOUNT', 'existing');
    });
    mockedSession.mockReturnValue(sessionValue({ loginWithGoogleCode }));
    const view = await renderWithClient(<ClaimScreen token={TOKEN} />);
    await fireEvent.press(await screen.findByLabelText('Claim with Google'));

    googleReturns(success);
    await view.rerender(
      <QueryClientProvider client={client}>
        <ClaimScreen token={TOKEN} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(EXISTING_ACCOUNT_TEXT)).toBeTruthy();
    expect(screen.queryByTestId('redirect')).toBeNull();
    await expect(readPendingClaim()).resolves.toMatchObject({ token: TOKEN });
    expect(screen.getByLabelText('Try again')).toBeTruthy();
  });

  it('drops the pending claim when the link turned out to be unusable at exchange time', async () => {
    const loginWithGoogleCode = jest.fn(async () => {
      throw new ApiError(400, 'CLAIM_INVALID', 'used');
    });
    mockedSession.mockReturnValue(sessionValue({ loginWithGoogleCode }));
    const view = await renderWithClient(<ClaimScreen token={TOKEN} />);
    await fireEvent.press(await screen.findByLabelText('Claim with Google'));
    googleReturns(success);
    await view.rerender(
      <QueryClientProvider client={client}>
        <ClaimScreen token={TOKEN} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(CLAIM_UNUSABLE_TEXT)).toBeTruthy();
    await waitFor(async () => expect(await readPendingClaim()).toBeNull());
  });

  it('keeps the claim after a cancelled sign-in and lets the user retry', async () => {
    const loginWithGoogleCode = jest.fn(async () => undefined);
    mockedSession.mockReturnValue(sessionValue({ loginWithGoogleCode }));
    const view = await renderWithClient(<ClaimScreen token={TOKEN} />);
    await fireEvent.press(await screen.findByLabelText('Claim with Google'));

    googleReturns({ type: 'dismiss' });
    await view.rerender(
      <QueryClientProvider client={client}>
        <ClaimScreen token={TOKEN} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('Claim with Google')).toBeEnabled());
    expect(loginWithGoogleCode).not.toHaveBeenCalled();
    await expect(readPendingClaim()).resolves.toMatchObject({ token: TOKEN });

    await fireEvent.press(screen.getByLabelText('Claim with Google'));
    expect(promptAsync).toHaveBeenCalledTimes(2);
  });

  it('offers to open the claim link in the installed app alongside continuing on web', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    mockedSession.mockReturnValue(sessionValue());
    await renderWithClient(<ClaimScreen token={TOKEN} />);

    const link = await screen.findByTestId('open-in-app-link');
    expect(link).toHaveTextContent('Open in app');
    expect(link.props.href).toBe(`com.elo.sharkulator:///invite/claim/${TOKEN}`);
    // Same tab, so the browser hands the custom scheme to the app instead of opening a blank tab.
    expect(link.props.target).toBe('_self');
    expect(screen.getByLabelText('Claim with Google')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Continue on web'));
    expect(screen.queryByTestId('open-in-app')).toBeNull();
    expect(screen.getByLabelText('Claim with Google')).toBeTruthy();
  });

  it('does not offer Open in app inside the native app', async () => {
    mockedSession.mockReturnValue(sessionValue());
    await renderWithClient(<ClaimScreen token={TOKEN} />);
    expect(await screen.findByLabelText('Claim with Google')).toBeTruthy();
    expect(screen.queryByTestId('open-in-app')).toBeNull();
  });

  it('asks a signed-in user to sign out instead of claiming with their account', async () => {
    const logout = jest.fn(async () => undefined);
    mockedSession.mockReturnValue(
      sessionValue({ session: makeSession(), user: makeSession().user, logout }),
    );
    await renderWithClient(<ClaimScreen token={TOKEN} />);

    expect(await screen.findByTestId('claim-signed-in')).toHaveTextContent(/@dev-alex/);
    expect(screen.queryByLabelText('Claim with Google')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Sign out'));
    expect(logout).toHaveBeenCalled();
  });
});

describe('LoginScreen with a pending claim', () => {
  it('resumes the claim after an app restart and forwards claimToken on the exchange', async () => {
    await savePendingClaim({ token: TOKEN, playerName: 'Riley Guest' });
    const loginWithGoogleCode = jest.fn(async () => undefined);
    mockedSession.mockReturnValue(sessionValue({ loginWithGoogleCode }));
    const view = await render(<LoginScreen devSignInEnabled={false} />);

    expect(await screen.findByTestId('pending-claim')).toHaveTextContent(/Riley Guest/);
    expect(screen.getByLabelText('Claim with Google')).toBeTruthy();

    googleReturns(success);
    await view.rerender(<LoginScreen devSignInEnabled={false} />);
    await waitFor(() =>
      expect(loginWithGoogleCode).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'auth-code', claimToken: TOKEN }),
      ),
    );
    await expect(readPendingClaim()).resolves.toBeNull();
  });

  it('signs in normally, without a claim token, once the claim is cancelled', async () => {
    await savePendingClaim({ token: TOKEN, playerName: 'Riley Guest' });
    const loginWithGoogleCode = jest.fn(async () => undefined);
    mockedSession.mockReturnValue(sessionValue({ loginWithGoogleCode }));
    const view = await render(<LoginScreen devSignInEnabled={false} />);

    await fireEvent.press(await screen.findByLabelText('Cancel claim'));
    expect(screen.queryByTestId('pending-claim')).toBeNull();
    expect(screen.getByLabelText('Continue with Google')).toBeTruthy();
    await waitFor(async () => expect(await readPendingClaim()).toBeNull());

    googleReturns(success);
    await view.rerender(<LoginScreen devSignInEnabled={false} />);
    await waitFor(() => expect(loginWithGoogleCode).toHaveBeenCalledTimes(1));
    expect(loginWithGoogleCode.mock.calls[0]).toEqual([
      expect.not.objectContaining({ claimToken: expect.anything() }),
    ]);
  });

  it('can go back to the invitation page', async () => {
    await savePendingClaim({ token: TOKEN, playerName: 'Riley Guest' });
    mockedSession.mockReturnValue(sessionValue());
    await render(<LoginScreen devSignInEnabled={false} />);
    await fireEvent.press(await screen.findByLabelText('View invitation'));
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/invite/claim/[token]',
      params: { token: TOKEN },
    });
  });
});

describe('General app invitation after a cancelled claim', () => {
  it('signs in normally, never sending the stale claim token', async () => {
    const loginWithGoogleCode = jest.fn(async () => undefined);
    mockedSession.mockReturnValue(sessionValue({ loginWithGoogleCode }));

    // A claim sign-in that was cancelled at Google keeps its claim pending.
    const claimView = await renderWithClient(<ClaimScreen token={TOKEN} />);
    await fireEvent.press(await screen.findByLabelText('Claim with Google'));
    googleReturns({ type: 'dismiss' });
    await claimView.rerender(
      <QueryClientProvider client={client}>
        <ClaimScreen token={TOKEN} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('Claim with Google')).toBeEnabled());
    await expect(readPendingClaim()).resolves.toMatchObject({ token: TOKEN });
    await claimView.unmount();

    // The visitor then follows someone's general app invitation.
    getAppInvitePreview.mockResolvedValue({ invitedBy: creator });
    const inviteView = await renderWithClient(<AppInviteLanding token="app-invite-token" />);
    await fireEvent.press(await screen.findByLabelText('Sign in to get started'));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    const destination = jest.mocked(router.push).mock.calls[0]![0];
    expect(destination).toEqual({ pathname: '/login', params: { mode: 'signin' } });
    await expect(readPendingClaim()).resolves.toBeNull();
    await inviteView.unmount();

    // The login route it opened exchanges the Google code as an ordinary sign-in.
    mockedParams.mockReturnValue((destination as { params: Record<string, string> }).params);
    const loginView = await render(<LoginRoute />);
    expect(await screen.findByLabelText('Continue with Google')).toBeTruthy();
    expect(screen.queryByTestId('pending-claim')).toBeNull();
    googleReturns(success);
    await loginView.rerender(<LoginRoute />);
    await waitFor(() => expect(loginWithGoogleCode).toHaveBeenCalledTimes(1));
    expect(loginWithGoogleCode.mock.calls[0]).toStrictEqual([
      {
        code: 'auth-code',
        codeVerifier: 'v'.repeat(43),
        redirectUri: 'com.elo.sharkulator:/oauthredirect',
      },
    ]);
  });

  it('ignores a pending claim on the ordinary sign-in even if it could not be cleared', async () => {
    await savePendingClaim({ token: TOKEN, playerName: 'Riley Guest' });
    const loginWithGoogleCode = jest.fn(async () => undefined);
    mockedSession.mockReturnValue(sessionValue({ loginWithGoogleCode }));
    mockedParams.mockReturnValue({ mode: 'signin' });
    const view = await render(<LoginRoute />);

    expect(await screen.findByLabelText('Continue with Google')).toBeTruthy();
    expect(screen.queryByTestId('pending-claim')).toBeNull();
    googleReturns(success);
    await view.rerender(<LoginRoute />);
    await waitFor(() => expect(loginWithGoogleCode).toHaveBeenCalledTimes(1));
    expect(loginWithGoogleCode.mock.calls[0]).toEqual([
      expect.not.objectContaining({ claimToken: expect.anything() }),
    ]);
  });
});

describe('LoginScreen with a screen kept for after sign-in', () => {
  const GAME_PATH = '/games/dbc565ce-84b7-45ce-98b4-844909516cab';

  it('keeps the destination through an ordinary Google code exchange', async () => {
    await savePendingReturn(GAME_PATH);
    const loginWithGoogleCode = jest.fn(async () => undefined);
    mockedSession.mockReturnValue(sessionValue({ loginWithGoogleCode }));
    const view = await render(<LoginScreen devSignInEnabled={false} />);

    await fireEvent.press(await screen.findByLabelText('Continue with Google'));
    expect(promptAsync).toHaveBeenCalledTimes(1);
    googleReturns(success);
    await view.rerender(<LoginScreen devSignInEnabled={false} />);
    await waitFor(() => expect(loginWithGoogleCode).toHaveBeenCalledTimes(1));
    expect(loginWithGoogleCode.mock.calls[0]).toEqual([
      expect.not.objectContaining({ claimToken: expect.anything() }),
    ]);
    expect(mockSecureStore.has(PENDING_RETURN_KEY)).toBe(true);
  });

  it('drops the destination when the sign-in claims a player instead', async () => {
    await savePendingReturn(GAME_PATH);
    await savePendingClaim({ token: TOKEN, playerName: 'Riley Guest' });
    const loginWithGoogleCode = jest.fn(async () => undefined);
    mockedSession.mockReturnValue(sessionValue({ loginWithGoogleCode }));
    const view = await render(<LoginScreen devSignInEnabled={false} />);

    await fireEvent.press(await screen.findByLabelText('Claim with Google'));
    await waitFor(() => expect(mockSecureStore.has(PENDING_RETURN_KEY)).toBe(false));
    googleReturns(success);
    await view.rerender(<LoginScreen devSignInEnabled={false} />);
    await waitFor(() =>
      expect(loginWithGoogleCode).toHaveBeenCalledWith(
        expect.objectContaining({ claimToken: TOKEN }),
      ),
    );
  });
});

describe('LoginScreen before the pending claim has been read', () => {
  const defaultGetItem = async (key: string) => mockSecureStore.get(key) ?? null;
  let restoreSessionStorage: (() => void) | null = null;

  afterEach(() => {
    jest.mocked(SecureStore.getItemAsync).mockImplementation(defaultGetItem);
    restoreSessionStorage?.();
    restoreSessionStorage = null;
  });

  function useWebSessionStorage() {
    const values = new Map<string, string>();
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => values.get(k) ?? null,
        setItem: (k: string, v: string) => void values.set(k, v),
        removeItem: (k: string) => void values.delete(k),
      },
    });
    restoreSessionStorage = () => {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
      else delete (window as { sessionStorage?: unknown }).sessionStorage;
    };
  }

  /** Holds the native pending-claim read until the returned gate is resolved. */
  function slowNativeClaimRead() {
    const gate = deferred<void>();
    jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key: string) => {
      if (key === PENDING_CLAIM_KEY) await gate.promise;
      return defaultGetItem(key);
    });
    return gate;
  }

  it.each(['web', 'ios'] as const)(
    'sends claimToken when the Google result is already there on mount (%s)',
    async (os) => {
      jest.replaceProperty(Platform, 'OS', os);
      if (os === 'web') useWebSessionStorage();
      await savePendingClaim({ token: TOKEN, playerName: 'Riley Guest' });
      const loginWithGoogleCode = jest.fn(async () => undefined);
      mockedSession.mockReturnValue(sessionValue({ loginWithGoogleCode }));
      googleReturns(success);

      await render(<LoginScreen devSignInEnabled={false} />);

      await waitFor(() => expect(loginWithGoogleCode).toHaveBeenCalledTimes(1));
      expect(loginWithGoogleCode).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'auth-code', claimToken: TOKEN }),
      );
      await waitFor(async () => expect(await readPendingClaim()).toBeNull());
    },
  );

  it('waits for a slow native read before exchanging and keeps sign-in disabled meanwhile', async () => {
    await savePendingClaim({ token: TOKEN, playerName: 'Riley Guest' });
    const gate = slowNativeClaimRead();
    const loginWithGoogleCode = jest.fn(async () => undefined);
    mockedSession.mockReturnValue(sessionValue({ loginWithGoogleCode }));
    const view = await render(<LoginScreen devSignInEnabled={false} />);

    const button = screen.getByRole('button', { name: 'Continue with Google' });
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(promptAsync).not.toHaveBeenCalled();

    // A Google result that lands while the read is still pending must not be exchanged yet.
    googleReturns(success);
    await view.rerender(<LoginScreen devSignInEnabled={false} />);
    await act(async () => undefined);
    expect(loginWithGoogleCode).not.toHaveBeenCalled();

    await act(async () => gate.resolve());
    await waitFor(() => expect(loginWithGoogleCode).toHaveBeenCalledTimes(1));
    expect(loginWithGoogleCode).toHaveBeenCalledWith({
      code: 'auth-code',
      codeVerifier: 'v'.repeat(43),
      redirectUri: 'com.elo.sharkulator:/oauthredirect',
      claimToken: TOKEN,
    });
    await waitFor(async () => expect(await readPendingClaim()).toBeNull());
  });

  it('enables claiming once the slow read completes', async () => {
    await savePendingClaim({ token: TOKEN, playerName: 'Riley Guest' });
    const gate = slowNativeClaimRead();
    mockedSession.mockReturnValue(sessionValue());
    await render(<LoginScreen devSignInEnabled={false} />);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();

    await act(async () => gate.resolve());
    expect(await screen.findByTestId('pending-claim')).toHaveTextContent(/Riley Guest/);
    const button = screen.getByRole('button', { name: 'Claim with Google' });
    expect(button).toBeEnabled();
    await fireEvent.press(button);
    expect(promptAsync).toHaveBeenCalledTimes(1);
  });

  it('signs in normally once a slow read finds no pending claim', async () => {
    const gate = slowNativeClaimRead();
    const loginWithGoogleCode = jest.fn(async () => undefined);
    mockedSession.mockReturnValue(sessionValue({ loginWithGoogleCode }));
    googleReturns(success);
    await render(<LoginScreen devSignInEnabled={false} />);
    await act(async () => undefined);
    expect(loginWithGoogleCode).not.toHaveBeenCalled();

    await act(async () => gate.resolve());
    await waitFor(() => expect(loginWithGoogleCode).toHaveBeenCalledTimes(1));
    expect(loginWithGoogleCode.mock.calls[0]).toStrictEqual([
      {
        code: 'auth-code',
        codeVerifier: 'v'.repeat(43),
        redirectUri: 'com.elo.sharkulator:/oauthredirect',
      },
    ]);
  });
});

// Silences "not wrapped in act" noise from the async storage read in usePendingClaim.
afterEach(async () => {
  await act(async () => undefined);
  jest.restoreAllMocks();
});
