import { Stack } from 'expo-router';

import { InboxScreen } from '@/features/notifications/inbox-screen';
import { notificationKeys } from '@/features/notifications/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';
import { Colors } from '@/theme';

export default function NotificationsRoute() {
  useInvalidateOnFocus([notificationKeys.all]);
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Notifications',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
        }}
      />
      <InboxScreen />
    </>
  );
}
