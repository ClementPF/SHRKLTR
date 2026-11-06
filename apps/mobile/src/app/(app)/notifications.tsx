import { Stack } from 'expo-router';

import { InboxScreen } from '@/features/notifications/inbox-screen';
import { notificationKeys } from '@/features/notifications/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';

export default function NotificationsRoute() {
  useInvalidateOnFocus([notificationKeys.all]);
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Notifications',
        }}
      />
      <InboxScreen />
    </>
  );
}
