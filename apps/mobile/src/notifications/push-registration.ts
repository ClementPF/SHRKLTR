import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { registerPushDevice, unregisterPushDevice } from '@/api/endpoints';
import type { PushPlatform } from '@/api/types';

import { getOrCreateInstallationId, readInstallationId } from './installation-id';

function easProjectId(): string | undefined {
  const fromConfig = Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined;
  return fromConfig?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

function pushPlatform(): PushPlatform {
  if (Platform.OS === 'ios') return 'IOS';
  if (Platform.OS === 'android') return 'ANDROID';
  return 'UNKNOWN';
}

let warnedMissingProject = false;

/**
 * Asks for notification permission, obtains this installation's current Expo push token and
 * registers it with the backend. Resolves to the token, or null when push is unavailable
 * (web, permission denied, or no EAS project ID configured).
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
  if (!projectId) {
    // Expo push tokens need an EAS project; without one the app works, just without push.
    if (!warnedMissingProject) {
      warnedMissingProject = true;
      console.warn('Push disabled: no EAS projectId in the app config.');
    }
    return null;
  }

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  const installationId = await getOrCreateInstallationId();
  await registerPushDevice({ installationId, expoToken: data, platform: pushPlatform() });
  return data;
}

/** Stops pushes to this installation only; other devices of the account stay registered. */
export async function unregisterPushNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  const installationId = await readInstallationId();
  if (installationId) await unregisterPushDevice(installationId);
}

/** Calls `onChange` when the OS rotates this device's push token. Returns an unsubscribe. */
export function watchPushTokenChanges(onChange: () => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const subscription = Notifications.addPushTokenListener(() => onChange());
  return () => subscription.remove();
}
