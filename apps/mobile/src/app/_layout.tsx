import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, ThemeProvider, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';

import { SessionProvider, useSession } from '@/auth/session';
import { usePendingReturnCapture, usePendingReturnResume } from '@/features/auth/pending-return';
import { usePendingJoinResume } from '@/features/groups/pending-join';
import { queryClient } from '@/lib/query-client';
import { useNotificationListeners } from '@/notifications/use-notification-listeners';
import { NavigationTheme } from '@/theme/navigation';

// Google redirects its web popup back to the app root; this closes it and hands the result
// to the opener. No-op everywhere else.
WebBrowser.maybeCompleteAuthSession();

function RootNavigator() {
  const { session } = useSession();
  // Rendered only after the session hydrated; taps wait for a signed-in, mounted navigator.
  const navigationReady = !!useRootNavigationState()?.key;
  const signedInReady = !!session && navigationReady;
  const accountKey = session?.user.id ?? null;
  useNotificationListeners(queryClient, signedInReady);
  usePendingJoinResume(signedInReady, accountKey);
  usePendingReturnCapture(!!session);
  usePendingReturnResume(signedInReady, accountKey);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      {/* Public capability links: reachable signed in or out. */}
      <Stack.Screen name="invite/claim/[token]" />
      <Stack.Screen name="invite/app/[token]" />
      <Stack.Screen name="join/index" />
      <Stack.Screen name="join/[token]" />
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)/login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={NavigationTheme}>
        <StatusBar style="light" />
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
