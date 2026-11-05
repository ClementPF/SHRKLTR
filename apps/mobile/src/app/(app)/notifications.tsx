import { Stack } from 'expo-router';

import { InboxScreen } from '@/features/notifications/inbox-screen';
import { Colors } from '@/theme';

export default function NotificationsRoute() {
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
