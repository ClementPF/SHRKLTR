import { renderHook, waitFor } from '@testing-library/react-native';
import * as AuthSession from 'expo-auth-session';
import { CodeChallengeMethod, ResponseType, type AuthSessionResult } from 'expo-auth-session';
import { Platform } from 'react-native';

import { exchangeGoogleCode } from '@/api/endpoints';
import {
  GOOGLE_DISCOVERY,
  GOOGLE_WEB_REDIRECT_URI,
  googleAuthRequestConfig,
  googleRedirectUri,
  interpretGoogleResult,
  useGoogleSignIn,
} from '@/auth/google';

import { jsonResponse, makeSession } from '../test-utils/session';

jest.mock('expo-auth-session', () => ({
  ...jest.requireActual<typeof import('expo-auth-session')>('expo-auth-session'),
  useAuthRequest: jest.fn(),
  exchangeCodeAsync: jest.fn(),
}));

const mockedUseAuthRequest = jest.mocked(AuthSession.useAuthRequest);

const GOOGLE_TOKEN_HOST = 'oauth2.googleapis.com';

describe('Google auth request', () => {
  it('uses the authorization-code flow with PKCE S256 and OpenID scopes', () => {
    const config = googleAuthRequestConfig('client-123', GOOGLE_WEB_REDIRECT_URI);
    expect(config).toEqual({
      clientId: 'client-123',
      redirectUri: 'http://localhost:8083',
      scopes: ['openid', 'email', 'profile'],
      responseType: ResponseType.Code,
      usePKCE: true,
      codeChallengeMethod: CodeChallengeMethod.S256,
    });
  });

  it('redirects back to the origin serving the web app', () => {
    expect(googleRedirectUri('web', 'https://app.example.com')).toBe('https://app.example.com');
    expect(googleRedirectUri('web', 'http://localhost:8083')).toBe('http://localhost:8083');
  });

  it('falls back to EXPO_PUBLIC_WEB_URL (default http://localhost:8083) when the origin is unknown', () => {
    expect(GOOGLE_WEB_REDIRECT_URI).toBe('http://localhost:8083');
    expect(googleRedirectUri('web', undefined)).toBe('http://localhost:8083');
    expect(googleRedirectUri('web', 'null')).toBe('http://localhost:8083');
  });

  describe('with a configured EXPO_PUBLIC_WEB_URL', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
      jest.resetModules();
    });

    // EXPO_PUBLIC_* values are read at module load, so load a fresh module graph.
    function loadGoogle(): typeof import('@/auth/google') {
      let mod: typeof import('@/auth/google') | undefined;
      jest.isolateModules(() => {
        mod = jest.requireActual<typeof import('@/auth/google')>('@/auth/google');
      });
      return mod!;
    }

    it('falls back to the configured web origin, not localhost', () => {
      process.env.EXPO_PUBLIC_WEB_URL = 'https://app.example.com/';
      const google = loadGoogle();
      expect(google.GOOGLE_WEB_REDIRECT_URI).toBe('https://app.example.com');
      expect(google.googleRedirectUri('web', undefined)).toBe('https://app.example.com');
      expect(google.googleRedirectUri('web', 'https://app.example.com')).toBe(
        'https://app.example.com',
      );
    });
  });

  it("targets Google's authorization endpoint and exposes no token endpoint", () => {
    expect(GOOGLE_DISCOVERY).toEqual({
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    });
    expect(GOOGLE_DISCOVERY.tokenEndpoint).toBeUndefined();
  });
});

describe('interpretGoogleResult', () => {
  it('extracts the authorization code from a success result', () => {
    const result = { type: 'success', params: { code: 'abc' } } as unknown as AuthSessionResult;
    expect(interpretGoogleResult(result)).toEqual({ kind: 'code', code: 'abc' });
  });

  it('reports provider errors', () => {
    const result = {
      type: 'error',
      params: {},
      error: { description: 'access_denied', message: 'x' },
    } as unknown as AuthSessionResult;
    expect(interpretGoogleResult(result)).toEqual({ kind: 'error', message: 'access_denied' });
  });

  it('treats a success without a code as an error', () => {
    const result = { type: 'success', params: {} } as unknown as AuthSessionResult;
    expect(interpretGoogleResult(result).kind).toBe('error');
  });

  it('treats dismiss/cancel as a cancellation, not an error', () => {
    expect(interpretGoogleResult({ type: 'dismiss' })).toEqual({ kind: 'cancelled' });
    expect(interpretGoogleResult({ type: 'cancel' })).toEqual({ kind: 'cancelled' });
  });
});

describe('exchangeGoogleCode (backend exchange)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('POSTs exactly {code, codeVerifier, redirectUri} to /auth/google/code without a Bearer', async () => {
    const session = makeSession();
    const fetchFn = jest.fn<Promise<Response>, [string, RequestInit]>(async () =>
      jsonResponse(200, session),
    );
    globalThis.fetch = fetchFn as unknown as typeof fetch;

    await expect(
      exchangeGoogleCode({
        code: 'auth-code',
        codeVerifier: 'verifier-xyz',
        redirectUri: 'http://localhost:8083',
      }),
    ).resolves.toEqual(session);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(new URL(url).pathname).toBe('/auth/google/code');
    expect(url).not.toContain(GOOGLE_TOKEN_HOST);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toStrictEqual({
      code: 'auth-code',
      codeVerifier: 'verifier-xyz',
      redirectUri: 'http://localhost:8083',
    });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('drops any extra fields so the body shape stays exact', async () => {
    const fetchFn = jest.fn<Promise<Response>, [string, RequestInit]>(async () =>
      jsonResponse(200, makeSession()),
    );
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    const input = {
      code: 'c',
      codeVerifier: 'v',
      redirectUri: 'http://localhost:8083',
      clientSecret: 'nope',
    };

    await exchangeGoogleCode(input);

    expect(Object.keys(JSON.parse(fetchFn.mock.calls[0]![1].body as string)).sort()).toEqual([
      'code',
      'codeVerifier',
      'redirectUri',
    ]);
  });
});

describe('useGoogleSignIn (web)', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web');
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    jest.restoreAllMocks();
  });

  function mockAuthRequest(response: AuthSessionResult | null) {
    const request = { codeVerifier: 'verifier-from-pkce' } as AuthSession.AuthRequest;
    mockedUseAuthRequest.mockReturnValue([request, response, jest.fn()]);
  }

  it('hands the code, PKCE verifier and redirect URI to the backend exchange', async () => {
    const fetchFn = jest.fn();
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    mockAuthRequest({
      type: 'success',
      params: { code: 'auth-code' },
    } as unknown as AuthSessionResult);
    const onCode = jest.fn(async () => undefined);

    await renderHook(() => useGoogleSignIn(onCode));

    await waitFor(() => expect(onCode).toHaveBeenCalledTimes(1));
    expect(onCode).toHaveBeenCalledWith({
      code: 'auth-code',
      codeVerifier: 'verifier-from-pkce',
      redirectUri: 'http://localhost:8083',
    });
    expect(mockedUseAuthRequest).toHaveBeenCalledWith(
      expect.objectContaining({ usePKCE: true, responseType: ResponseType.Code }),
      GOOGLE_DISCOVERY,
    );
    expect(AuthSession.exchangeCodeAsync).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('surfaces a backend exchange failure as an error state', async () => {
    mockAuthRequest({
      type: 'success',
      params: { code: 'auth-code' },
    } as unknown as AuthSessionResult);
    const onCode = jest.fn(async () => {
      throw new Error('Google sign-in could not be verified.');
    });

    const { result } = await renderHook(() => useGoogleSignIn(onCode));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Google sign-in could not be verified.');
  });
});

// The mobile tsconfig has no Node types; declare the small slice of fs this scan needs.
declare const __dirname: string;
interface DirEntry {
  name: string;
  isDirectory(): boolean;
}
const fs = jest.requireActual<{
  readdirSync(dir: string, options: { withFileTypes: true }): DirEntry[];
  readFileSync(file: string, encoding: 'utf8'): string;
}>('fs');

describe('mobile source', () => {
  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
    });
  }

  it("never calls exchangeCodeAsync, Google's token endpoint, or references a client secret", () => {
    const offenders = sourceFiles(`${__dirname}/../src`).filter((file) =>
      /exchangeCodeAsync|oauth2\.googleapis\.com|tokenEndpoint|client_?secret/i.test(
        fs.readFileSync(file, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
