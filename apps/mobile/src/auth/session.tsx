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
import {
  registerForPushNotifications,
  unregisterPushNotifications,
  watchPushTokenChanges,
} from '@/notifications/push-registration';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { requestDevSession } from './devSession';
import {
  startPushSession,
  type PushSession,
  type RegisterPush,
  type WatchPushToken,
} from './push-session';
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

const UNREGISTER_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export interface SessionProviderProps {
  children: ReactNode;
  /** Owns session cleanup (storage, query cache, auth-lost) for sign-out and expiry. */
  store?: SessionStore;
  refreshTokens?: () => Promise<string | null>;
  /** Registers this installation; called on sign-in and with the new token on each rotation. */
  registerPush?: RegisterPush;
  /**
   * Stops pushes to this installation; attempted on logout after in-flight registrations land,
   * never blocks it beyond a short timeout.
   */
  unregisterPush?: () => Promise<void>;
  /** Subscribes to push token rotation while signed in. */
  watchPushToken?: WatchPushToken;
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
  refreshTokens = api.refresh,
  registerPush = registerForPushNotifications,
  unregisterPush = unregisterPushNotifications,
  watchPushToken = watchPushTokenChanges,
  fetchCurrentUser = getMe,
  fallback,
}: SessionProviderProps) {
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(store.get());
  const pushSession = useRef<PushSession | null>(null);

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

  // Every installed session (not token refreshes) gets its own push session, so signing back in,
  // even as the same user, registers again after a logout stopped the previous one.
  const pushKey = session ? `${session.user.id}:${store.generation()}` : null;
  useEffect(() => {
    if (!pushKey) return;
    const push = startPushSession(registerPush, watchPushToken);
    pushSession.current = push;
    return () => {
      void push.stop();
      if (pushSession.current === push) pushSession.current = null;
    };
  }, [pushKey, registerPush, watchPushToken]);

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
    // Stops rotation handling and pending registrations now, so nothing can re-register this
    // installation after the final unregister below.
    const pushStopped = pushSession.current?.stop() ?? Promise.resolve();
    if (refreshToken) {
      // Runs after registration writes already on the wire, and needs the still-valid session.
      // Once the session is replaced or cleared, the installation is no longer ours to remove.
      const finalUnregister = pushStopped.then(() =>
        store.generation() === generation ? unregisterPush() : undefined,
      );
      // Failures and slow networks must not keep the user signed in.
      await withTimeout(finalUnregister, UNREGISTER_TIMEOUT_MS).catch(() => undefined);
      // Local sign-out must succeed even if the server cannot be reached.
      await logoutSession(refreshToken).catch(() => undefined);
    }
    // Skipped by the store if a login completed meanwhile; the store also clears the cache.
    await store.clear(generation);
  }, [store, unregisterPush]);

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
