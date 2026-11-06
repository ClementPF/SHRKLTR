import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';

import * as endpoints from '@/api/endpoints';
import type { InboxNotification } from '@/api/types';
import NotificationsRoute from '@/app/(app)/notifications';

// Focus effects re-run when `refocus()` is called, like navigating Back to a mounted screen.
const mockFocusCallbacks = new Set<() => void>();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    Stack: { Screen: () => null },
    router: { push: jest.fn(), navigate: jest.fn(), back: jest.fn() },
    useFocusEffect: (effect: () => void) => {
      useEffect(() => {
        mockFocusCallbacks.add(effect);
        effect();
        return () => {
          mockFocusCallbacks.delete(effect);
        };
      }, [effect]);
    },
  };
});
jest.mock('@/api/endpoints');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const api = jest.mocked(endpoints);

const older: InboxNotification = {
  id: 'n-old',
  type: 'game_recorded',
  category: 'games',
  title: 'You lost in Office Babyfoot',
  body: 'dev-sam beat you (-16 Elo)',
  target: { type: 'game', gameId: '11111111-1111-4111-8111-111111111111' },
  actor: null,
  createdAt: '2026-11-05T10:00:00.000Z',
  readAt: null,
};
const arrived: InboxNotification = {
  ...older,
  id: 'n-arrived',
  title: 'You won in Lunch Darts',
  body: 'You beat dev-jordan (+16 Elo)',
  createdAt: '2026-11-05T12:00:00.000Z',
};

async function refocus() {
  await act(async () => {
    for (const effect of [...mockFocusCallbacks]) effect();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallbacks.clear();
});

describe('Notifications route', () => {
  it('shows a notification that arrived while away when the mounted inbox is focused again', async () => {
    let inbox = [older];
    api.listNotifications.mockImplementation(async () => inbox);
    api.getUnreadNotificationCount.mockImplementation(async () => ({ count: inbox.length }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const view = await render(
      <QueryClientProvider client={client}>
        <NotificationsRoute />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('notification-n-old')).toBeTruthy();
    // The first focus is the mount itself and must not fetch twice.
    expect(api.listNotifications).toHaveBeenCalledTimes(1);

    // The user opens another screen; a new notification is recorded meanwhile.
    inbox = [arrived, older];
    await refocus();

    expect(await screen.findByTestId('notification-n-arrived')).toBeTruthy();
    expect(screen.getByTestId('notification-n-old')).toBeTruthy();
    await waitFor(() => expect(api.listNotifications).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getUnreadNotificationCount).toHaveBeenCalledTimes(2));

    // Re-renders without a new focus do not refetch (no refetch loop).
    await view.rerender(
      <QueryClientProvider client={client}>
        <NotificationsRoute />
      </QueryClientProvider>,
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(api.listNotifications).toHaveBeenCalledTimes(2);
    expect(api.getUnreadNotificationCount).toHaveBeenCalledTimes(2);
  });
});
