import type { QueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { api } from '@/api/client';
import { exchangeGoogleCode, getMe, logoutSession } from '@/api/endpoints';
import type { GoogleCodeExchangeRequest, User } from '@/api/types';
import { queryClient as defaultQueryClient } from '@/lib/query-client';
import { registerForPushNotifications } from '@/notifications/push-registration';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { requestDevSession } from './devSession';
import { sessionStore, type SessionStore } from './session-store';
import type { StoredSession } from './storage';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionContextValue {
  status: SessionStatus;
  session: StoredSession | null;
  user: User | null;
  /** Sends a Google authorization code (+ PKCE verifier) to the backend for a session. */
  loginWithGoogleCode(exchange: GoogleCodeExchangeRequest): Promise<void>;
  /** Non-production only: signs in as a seeded user through /auth/dev-token. */
  loginWithDevUser(username: string): Promise<void>;
  logout(): Promise<void>;
  /** Rotates tokens; resolves false when the session was lost. */
  refresh(): Promise<boolean>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  children: ReactNode;
  store?: SessionStore;
  queryClient?: Pick<QueryClient, 'clear'>;
  refreshTokens?: () => Promise<string | null>;
  registerPush?: () => Promise<string | null>;
  /**
   * Checks a restored session against the server (GET /users/me). The API client refreshes an
   * expired access token, or clears the session when the refresh token is no longer accepted.
   */
  fetchCurrentUser?: () => Promise<User>;
  /** Rendered while stored tokens hydrate, so the app never shows a blank screen. */
  fallback?: ReactNode;
}

export function SessionLoading() {
  return (
    <View style={styles.loading} accessibilityLabel="Loading session">
      <ActivityIndicator size="large" color={Colors.accent} />
      <Text style={Typography.bodySecondary}>Loading…</Text>
    </View>
  );
}

export function SessionProvider({
  children,
  store = sessionStore,
  queryClient = defaultQueryClient,
  refreshTokens = api.refresh,
  registerPush = registerForPushNotifications,
  fetchCurrentUser = getMe,
  fallback,
}: SessionProviderProps) {
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(store.get());
  const pushRegisteredFor = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = store.subscribe(setSession);
    let active = true;
    void (async () => {
      const restored = await store.hydrate();
      if (restored) {
        const generation = store.generation();
        try {
          await store.updateUser(await fetchCurrentUser(), generation);
        } catch {
          // A rejected refresh already cleared the session; any other failure (offline, server
          // error) keeps the stored session so the app still opens.
        }
      }
      if (!active) return;
      setSession(store.get());
      setHydrated(true);
    })();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [store, fetchCurrentUser]);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) {
      pushRegisteredFor.current = null;
      return;
    }
    if (pushRegisteredFor.current === userId) return;
    pushRegisteredFor.current = userId;
    registerPush().catch((err: unknown) => {
      console.warn('Push registration failed', err);
    });
  }, [userId, registerPush]);

  const loginWithGoogleCode = useCallback(
    async (exchange: GoogleCodeExchangeRequest) => {
      await store.set(await exchangeGoogleCode(exchange));
    },
    [store],
  );

  const loginWithDevUser = useCallback(
    async (username: string) => {
      await store.set(await requestDevSession(username));
    },
    [store],
  );

  const logout = useCallback(async () => {
    const generation = store.generation();
    const refreshToken = store.get()?.refreshToken;
    if (refreshToken) {
      // Local sign-out must succeed even if the server cannot be reached.
      await logoutSession(refreshToken).catch(() => undefined);
    }
    // A login that completed during sign-out owns the session and the cache from then on.
    if (await store.clear(generation)) queryClient.clear();
  }, [store, queryClient]);

  const refresh = useCallback(async () => (await refreshTokens()) !== null, [refreshTokens]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status: !hydrated ? 'loading' : session ? 'authenticated' : 'unauthenticated',
      session,
      user: session?.user ?? null,
      loginWithGoogleCode,
      loginWithDevUser,
      logout,
      refresh,
    }),
    [hydrated, session, loginWithGoogleCode, loginWithDevUser, logout, refresh],
  );

  return (
    <SessionContext.Provider value={value}>
      {hydrated ? children : (fallback ?? <SessionLoading />)}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}

const styles = StyleSheet.create({
  loading: {
    ...Palette.screen,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
});
