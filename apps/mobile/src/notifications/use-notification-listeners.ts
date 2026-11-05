import type { QueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { markNotificationRead } from '@/api/endpoints';

import { createNotificationReceivedHandler } from './notification-handler';
import { createNotificationTapRouter } from './tap-router';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type Invalidator = Pick<QueryClient, 'invalidateQueries'>;

function createTapRouter(queryClient: Invalidator) {
  return createNotificationTapRouter({
    navigate: (href) => router.push(href),
    markRead: (notificationId) => {
      markNotificationRead(notificationId)
        .catch(() => undefined)
        .finally(() => void queryClient.invalidateQueries({ queryKey: ['notifications'] }));
    },
  });
}

/**
 * Foreground pushes refresh cached data; taps (including the one that launched the app) open
 * their validated target once `ready` (signed in with the navigator mounted).
 */
export function useNotificationListeners(queryClient: Invalidator, ready: boolean): void {
  const [tapRouter] = useState(() => createTapRouter(queryClient));

  useEffect(() => {
    const onTap = (response: Notifications.NotificationResponse) => {
      tapRouter.handle(response);
      Notifications.clearLastNotificationResponse();
    };
    const received = Notifications.addNotificationReceivedListener(
      createNotificationReceivedHandler(queryClient),
    );
    const opened = Notifications.addNotificationResponseReceivedListener(onTap);
    // Cold start: the tap that launched the app happened before this listener existed.
    const launch = Notifications.getLastNotificationResponse();
    if (launch) onTap(launch);
    return () => {
      received.remove();
      opened.remove();
    };
  }, [queryClient, tapRouter]);

  useEffect(() => {
    tapRouter.setReady(ready);
  }, [ready, tapRouter]);
}
