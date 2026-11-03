import { renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { useNotificationListeners } from '@/notifications/use-notification-listeners';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
}));

const notifications = jest.mocked(Notifications);

describe('useNotificationListeners', () => {
  it('invalidates queries when a push is received or opened, and unsubscribes on unmount', async () => {
    const received = { remove: jest.fn() };
    const opened = { remove: jest.fn() };
    notifications.addNotificationReceivedListener.mockReturnValue(received);
    notifications.addNotificationResponseReceivedListener.mockReturnValue(opened);
    const queryClient = { invalidateQueries: jest.fn(async () => undefined) };

    const { unmount } = await renderHook(() => useNotificationListeners(queryClient));

    const onReceived = notifications.addNotificationReceivedListener.mock.calls[0]![0];
    const onOpened = notifications.addNotificationResponseReceivedListener.mock.calls[0]![0];
    onReceived({} as Notifications.Notification);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    onOpened({} as Notifications.NotificationResponse);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);

    await unmount();
    expect(received.remove).toHaveBeenCalled();
    expect(opened.remove).toHaveBeenCalled();
  });
});
