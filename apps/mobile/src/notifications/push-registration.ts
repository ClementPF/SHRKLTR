import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { registerPushToken } from '@/api/endpoints';

function easProjectId(): string | undefined {
  const fromConfig = Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined;
  return Constants.easConfig?.projectId ?? fromConfig?.projectId;
}

/**
 * Asks for notification permission, obtains the Expo push token and stores it on the backend.
 * Resolves to the token, or null when permission is denied or the platform has no push support.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return null;

  const projectId = easProjectId();
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await registerPushToken(data);
  return data;
}
