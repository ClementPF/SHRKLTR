import { CodeChallengeMethod, ResponseType, type AuthSessionResult } from 'expo-auth-session';

import {
  exchangeGoogleCode,
  GOOGLE_DISCOVERY,
  GOOGLE_WEB_REDIRECT_URI,
  googleAuthRequestConfig,
  googleRedirectUri,
  interpretGoogleResult,
} from '@/auth/google';

describe('Google auth request', () => {
  it('uses the authorization-code flow with PKCE S256 and OpenID scopes', () => {
    const config = googleAuthRequestConfig('client-123', GOOGLE_WEB_REDIRECT_URI);
    expect(config).toEqual({
      clientId: 'client-123',
      redirectUri: 'http://localhost:8081',
      scopes: ['openid', 'email', 'profile'],
      responseType: ResponseType.Code,
      usePKCE: true,
      codeChallengeMethod: CodeChallengeMethod.S256,
    });
  });

  it('redirects back to http://localhost:8081 on web', () => {
    expect(googleRedirectUri('web')).toBe('http://localhost:8081');
  });

  it('targets Google authorization and token endpoints', () => {
    expect(GOOGLE_DISCOVERY.authorizationEndpoint).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(GOOGLE_DISCOVERY.tokenEndpoint).toBe('https://oauth2.googleapis.com/token');
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

describe('exchangeGoogleCode', () => {
  const input = {
    code: 'auth-code',
    codeVerifier: 'verifier-xyz',
    clientId: 'client-123',
    redirectUri: 'http://localhost:8081',
  };

  it('exchanges the code with the PKCE verifier and returns the ID token', async () => {
    const exchange = jest.fn(async () => ({ idToken: 'google-id-token' }));

    await expect(
      exchangeGoogleCode(input, exchange as unknown as Parameters<typeof exchangeGoogleCode>[1]),
    ).resolves.toBe('google-id-token');

    expect(exchange).toHaveBeenCalledWith(
      {
        clientId: 'client-123',
        code: 'auth-code',
        redirectUri: 'http://localhost:8081',
        extraParams: { code_verifier: 'verifier-xyz' },
      },
      GOOGLE_DISCOVERY,
    );
  });

  it('fails when Google returns no ID token', async () => {
    const exchange = jest.fn(async () => ({ accessToken: 'only-access' }));
    await expect(
      exchangeGoogleCode(input, exchange as unknown as Parameters<typeof exchangeGoogleCode>[1]),
    ).rejects.toThrow('ID token');
  });
});
