import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';

import { SessionProvider, useSession } from '@/auth/session';
import { queryClient } from '@/lib/query-client';
import { useNotificationListeners } from '@/notifications/use-notification-listeners';
import { NavigationTheme } from '@/theme/navigation';

// Google redirects its web popup back to the app root; this closes it and hands the result
// to the opener. No-op everywhere else.
WebBrowser.maybeCompleteAuthSession();

function RootNavigator() {
  const { session } = useSession();
  useNotificationListeners(queryClient);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      {/* Public capability links: reachable signed in or out. */}
      <Stack.Screen name="invite/claim/[token]" />
      <Stack.Screen name="invite/app/[token]" />
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
