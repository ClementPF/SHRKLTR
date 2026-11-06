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
  useSession: () => ({ session: mockSession }),
}));
jest.mock('@/features/groups/pending-join', () => ({ usePendingJoinResume: jest.fn() }));
jest.mock('@/features/auth/pending-return', () => ({
  usePendingReturnCapture: jest.fn(),
  usePendingReturnResume: jest.fn(),
}));
jest.mock('@/theme/navigation', () => ({ NavigationTheme: {} }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-router', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
  const Stack = Object.assign(Passthrough, { Screen: () => null, Protected: Passthrough });
  return { Stack, ThemeProvider: Passthrough, useRootNavigationState: () => mockNavigationState };
});

let mockSession: object | null = null;
let mockNavigationState: { key?: string } | undefined;

describe('root layout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = null;
    mockNavigationState = undefined;
  });

  it('wires the notification listeners to the app-wide query client, not ready while signed out', async () => {
    mockNavigationState = { key: 'root' };
    await render(<RootLayout />);
    expect(useNotificationListeners).toHaveBeenLastCalledWith(queryClient, false);
  });

  it('routes notification taps only once signed in with a mounted navigator', async () => {
    mockSession = { user: { id: 'u1' } };
    await render(<RootLayout />);
    expect(useNotificationListeners).toHaveBeenLastCalledWith(queryClient, false);

    mockNavigationState = { key: 'root' };
    await render(<RootLayout />);
    expect(useNotificationListeners).toHaveBeenLastCalledWith(queryClient, true);
  });
});
