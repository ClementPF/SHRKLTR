import { act, renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { markNotificationRead } from '@/api/endpoints';
import { DEFAULT_ACTION } from '@/notifications/tap-router';
import { useNotificationListeners } from '@/notifications/use-notification-listeners';
import { useNotificationListeners as useWebListeners } from '@/notifications/use-notification-listeners.web';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponse: jest.fn(),
  clearLastNotificationResponse: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/api/endpoints', () => ({ markNotificationRead: jest.fn(async () => undefined) }));

const notifications = jest.mocked(Notifications);
const GAME_ID = '11111111-1111-4111-8111-111111111111';
const NOTIFICATION_ID = '33333333-3333-4333-8333-333333333333';

function response(identifier: string): Notifications.NotificationResponse {
  return {
    actionIdentifier: DEFAULT_ACTION,
    notification: {
      request: {
        identifier,
        content: {
          data: { notificationId: NOTIFICATION_ID, target: { type: 'game', gameId: GAME_ID } },
        },
      },
    },
  } as unknown as Notifications.NotificationResponse;
}

const gameHref = { pathname: '/games/[id]', params: { id: GAME_ID } };

describe('useNotificationListeners', () => {
  const received = { remove: jest.fn() };
  const opened = { remove: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.addNotificationReceivedListener.mockReturnValue(received);
    notifications.addNotificationResponseReceivedListener.mockReturnValue(opened);
    notifications.getLastNotificationResponse.mockReturnValue(null);
  });

  it('refreshes data on a foreground push without navigating, and unsubscribes on unmount', async () => {
    const queryClient = { invalidateQueries: jest.fn(async () => undefined) };
    const { unmount } = await renderHook(() => useNotificationListeners(queryClient, true));

    const onReceived = notifications.addNotificationReceivedListener.mock.calls[0]![0];
    onReceived(response('fg').notification);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['notifications'] });
    expect(router.push).not.toHaveBeenCalled();
    expect(markNotificationRead).not.toHaveBeenCalled();

    await unmount();
    expect(received.remove).toHaveBeenCalled();
    expect(opened.remove).toHaveBeenCalled();
  });

  it('routes a tap to the game, marks it read and clears the last response', async () => {
    const queryClient = { invalidateQueries: jest.fn(async () => undefined) };
    await renderHook(() => useNotificationListeners(queryClient, true));

    const onOpened = notifications.addNotificationResponseReceivedListener.mock.calls[0]![0];
    await act(async () => onOpened(response('tap-1')));

    expect(router.push).toHaveBeenCalledWith(gameHref);
    expect(markNotificationRead).toHaveBeenCalledWith(NOTIFICATION_ID);
    expect(notifications.clearLastNotificationResponse).toHaveBeenCalled();
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['notifications'] });
  });

  it('opens the cold-start tap only after hydration makes the app ready, exactly once', async () => {
    const launch = response('launch');
    notifications.getLastNotificationResponse.mockReturnValue(launch);
    const queryClient = { invalidateQueries: jest.fn(async () => undefined) };

    const view = await renderHook(
      ({ ready }: { ready: boolean }) => useNotificationListeners(queryClient, ready),
      {
        initialProps: { ready: false },
      },
    );
    expect(router.push).not.toHaveBeenCalled();

    // The same response also reaches the listener (e.g. delivered after mount).
    const onOpened = notifications.addNotificationResponseReceivedListener.mock.calls[0]![0];
    onOpened(launch);

    await view.rerender({ ready: true });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(gameHref);

    await view.rerender({ ready: false });
    await view.rerender({ ready: true });
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on web', () => {
    expect(useWebListeners()).toBeUndefined();
  });
});
