import {
  CodeChallengeMethod,
  exchangeCodeAsync,
  makeRedirectUri,
  ResponseType,
  useAuthRequest,
  type AuthRequestConfig,
  type AuthSessionResult,
  type DiscoveryDocument,
} from 'expo-auth-session';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { GOOGLE_CLIENT_ID } from '@/api/config';

export const GOOGLE_DISCOVERY: DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

export const GOOGLE_SCOPES = ['openid', 'email', 'profile'];

/** Must match the authorized redirect URI registered for the Google web client. */
export const GOOGLE_WEB_REDIRECT_URI = 'http://localhost:8081';
export const GOOGLE_NATIVE_REDIRECT_URI = 'com.elo.sharkulator:/oauthredirect';

export function googleRedirectUri(os: string = Platform.OS): string {
  return os === 'web'
    ? GOOGLE_WEB_REDIRECT_URI
    : makeRedirectUri({ native: GOOGLE_NATIVE_REDIRECT_URI });
}

export function googleAuthRequestConfig(clientId: string, redirectUri: string): AuthRequestConfig {
  return {
    clientId,
    redirectUri,
    scopes: GOOGLE_SCOPES,
    responseType: ResponseType.Code,
    usePKCE: true,
    codeChallengeMethod: CodeChallengeMethod.S256,
  };
}

export type GoogleResultOutcome =
  { kind: 'code'; code: string } | { kind: 'error'; message: string } | { kind: 'cancelled' };

export function interpretGoogleResult(result: AuthSessionResult): GoogleResultOutcome {
  switch (result.type) {
    case 'success': {
      const code = result.params.code;
      return code
        ? { kind: 'code', code }
        : { kind: 'error', message: 'Google did not return an authorization code.' };
    }
    case 'error':
      return {
        kind: 'error',
        message:
          result.error?.description ?? result.error?.message ?? 'Google sign-in failed. Try again.',
      };
    default:
      return { kind: 'cancelled' };
  }
}

export interface GoogleCodeExchange {
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}

/** Trades the authorization code (plus PKCE verifier) for Google's ID token. */
export async function exchangeGoogleCode(
  { code, codeVerifier, clientId, redirectUri }: GoogleCodeExchange,
  exchange: typeof exchangeCodeAsync = exchangeCodeAsync,
): Promise<string> {
  const tokens = await exchange(
    { clientId, code, redirectUri, extraParams: { code_verifier: codeVerifier } },
    GOOGLE_DISCOVERY,
  );
  if (!tokens.idToken) throw new Error('Google did not return an ID token.');
  return tokens.idToken;
}

export type GoogleSignInStatus = 'idle' | 'pending' | 'error';

export interface GoogleSignIn {
  /** False until the PKCE request has been generated or when no client ID is configured. */
  ready: boolean;
  configured: boolean;
  status: GoogleSignInStatus;
  error: string | null;
  signIn(): Promise<void>;
}

function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Google sign-in failed. Try again.';
}

/** Runs the Google authorization-code + PKCE flow and hands the ID token to `onIdToken`. */
export function useGoogleSignIn(onIdToken: (idToken: string) => Promise<void>): GoogleSignIn {
  const clientId = GOOGLE_CLIENT_ID;
  const redirectUri = useMemo(() => googleRedirectUri(), []);
  const config = useMemo(
    () => googleAuthRequestConfig(clientId, redirectUri),
    [clientId, redirectUri],
  );
  const [request, response, promptAsync] = useAuthRequest(config, GOOGLE_DISCOVERY);
  const [status, setStatus] = useState<GoogleSignInStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const handled = useRef<AuthSessionResult | null>(null);

  useEffect(() => {
    if (!response || handled.current === response) return;
    handled.current = response;
    const outcome = interpretGoogleResult(response);
    if (outcome.kind === 'cancelled') {
      setStatus('idle');
      return;
    }
    if (outcome.kind === 'error') {
      setError(outcome.message);
      setStatus('error');
      return;
    }
    const codeVerifier = request?.codeVerifier;
    if (!codeVerifier) {
      setError('The sign-in request expired. Try again.');
      setStatus('error');
      return;
    }
    exchangeGoogleCode({ code: outcome.code, codeVerifier, clientId, redirectUri })
      .then(onIdToken)
      .then(() => setStatus('idle'))
      .catch((err: unknown) => {
        setError(messageOf(err));
        setStatus('error');
      });
  }, [response, request, clientId, redirectUri, onIdToken]);

  const signIn = useCallback(async () => {
    setError(null);
    setStatus('pending');
    try {
      await promptAsync();
    } catch (err) {
      setError(messageOf(err));
      setStatus('error');
    }
  }, [promptAsync]);

  return {
    ready: request !== null && clientId.length > 0,
    configured: clientId.length > 0,
    status,
    error,
    signIn,
  };
}
