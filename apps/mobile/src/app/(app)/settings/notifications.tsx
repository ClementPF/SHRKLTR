import { Stack } from 'expo-router';

import { NotificationSettingsScreen } from '@/features/notifications/notification-settings-screen';
import { Colors } from '@/theme';

export default function NotificationSettingsRoute() {
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
      <NotificationSettingsScreen />
    </>
  );
}
