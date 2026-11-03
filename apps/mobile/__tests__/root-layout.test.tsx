import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import RootLayout from '@/app/_layout';
import { queryClient } from '@/lib/query-client';
import { useNotificationListeners } from '@/notifications/use-notification-listeners';

jest.mock('@/notifications/use-notification-listeners', () => ({
  useNotificationListeners: jest.fn(),
}));
jest.mock('@/auth/session', () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({ session: null }),
}));
jest.mock('@/theme/navigation', () => ({ NavigationTheme: {} }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-router', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
  const Stack = Object.assign(Passthrough, { Screen: () => null, Protected: Passthrough });
  return { Stack, ThemeProvider: Passthrough };
});

describe('root layout', () => {
  it('wires the notification listeners to the app-wide query client', async () => {
    await render(<RootLayout />);
    expect(useNotificationListeners).toHaveBeenCalledWith(queryClient);
  });
});
