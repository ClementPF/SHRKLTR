import type { QueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

import { createNotificationReceivedHandler } from './notification-handler';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function useNotificationListeners(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
): void {
  useEffect(() => {
    const handler = createNotificationReceivedHandler(queryClient);
    const received = Notifications.addNotificationReceivedListener(handler);
    const opened = Notifications.addNotificationResponseReceivedListener(handler);
    return () => {
      received.remove();
      opened.remove();
    };
  }, [queryClient]);
}
