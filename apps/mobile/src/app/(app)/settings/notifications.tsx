import { Stack } from 'expo-router';

import { NotificationSettingsScreen } from '@/features/notifications/notification-settings-screen';

export default function NotificationSettingsRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Notifications',
        }}
      />
      <NotificationSettingsScreen />
    </>
  );
}
