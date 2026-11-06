import {
  CodeChallengeMethod,
  makeRedirectUri,
  ResponseType,
  useAuthRequest,
  type AuthRequestConfig,
  type AuthSessionResult,
  type DiscoveryDocument,
} from 'expo-auth-session';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { GOOGLE_CLIENT_ID, WEB_URL } from '@/api/config';
import type { GoogleCodeExchangeRequest } from '@/api/types';
import { APP_SCHEME } from '@/lib/app-links';

// Authorization endpoint only: the code is redeemed by the backend (POST /auth/google/code),
// which holds the client secret, so the app never talks to Google's token endpoint.
export const GOOGLE_DISCOVERY: DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
};

export const GOOGLE_SCOPES = ['openid', 'email', 'profile'];

/**
 * Web redirect URI when the serving origin is unknown: EXPO_PUBLIC_WEB_URL, so it is the deployed
 * web app's origin rather than a localhost default. It must be an authorized redirect URI of the
 * Google web client and be listed in the backend GOOGLE_REDIRECT_ALLOWLIST.
 */
export const GOOGLE_WEB_REDIRECT_URI = WEB_URL;
export const GOOGLE_NATIVE_REDIRECT_URI = `${APP_SCHEME}:/oauthredirect`;

function currentWebOrigin(): string | undefined {
  return typeof window !== 'undefined' ? window.location?.origin : undefined;
}

/**
 * On web, Google redirects back to the origin serving the app (the hosted app or the local dev
 * server), falling back to EXPO_PUBLIC_WEB_URL; each origin must be registered on the Google
 * client and in the backend's GOOGLE_REDIRECT_ALLOWLIST.
 */
export function googleRedirectUri(
  os: string = Platform.OS,
  webOrigin: string | undefined = currentWebOrigin(),
): string {
  if (os !== 'web') return makeRedirectUri({ native: GOOGLE_NATIVE_REDIRECT_URI });
  return webOrigin && webOrigin !== 'null' ? webOrigin : GOOGLE_WEB_REDIRECT_URI;
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

/**
 * Runs the Google authorization-code + PKCE request and hands the code, its PKCE verifier and
 * the redirect URI to `onCode`, which exchanges them through the backend.
 */
export function useGoogleSignIn(
  onCode: (exchange: GoogleCodeExchangeRequest) => Promise<void>,
): GoogleSignIn {
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
    onCode({ code: outcome.code, codeVerifier, redirectUri })
      .then(() => setStatus('idle'))
      .catch((err: unknown) => {
        setError(messageOf(err));
        setStatus('error');
      });
  }, [response, request, redirectUri, onCode]);

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
