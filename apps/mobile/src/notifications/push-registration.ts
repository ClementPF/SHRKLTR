import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { registerPushDevice, unregisterPushDevice } from '@/api/endpoints';
import type { PushPlatform } from '@/api/types';

import { getOrCreateInstallationId, readInstallationId } from './installation-id';
import type { DevicePushToken, PushRegistrationOptions } from './push-types';

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

class RegistrationCancelled extends Error {}

/** Settles with `promise`, or rejects as soon as `signal` aborts, whichever comes first. */
function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new RegistrationCancelled());
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort);
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Asks for notification permission, obtains this installation's current Expo push token and
 * registers it with the backend. Resolves to the token, or null when push is unavailable
 * (web, permission denied, no EAS project ID) or the registration was cancelled first.
 */
export async function registerForPushNotifications({
  devicePushToken,
  signal,
}: PushRegistrationOptions = {}): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    if (Platform.OS === 'android') {
      await unlessAborted(
        Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.DEFAULT,
        }),
        signal,
      );
    }

    let { status } = await unlessAborted(Notifications.getPermissionsAsync(), signal);
    if (status !== 'granted') {
      ({ status } = await unlessAborted(Notifications.requestPermissionsAsync(), signal));
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

    const { data } = await unlessAborted(
      Notifications.getExpoPushTokenAsync(
        devicePushToken ? { projectId, devicePushToken } : { projectId },
      ),
      signal,
    );
    const installationId = await unlessAborted(getOrCreateInstallationId(), signal);
    // Checked synchronously right before the write: once aborted, no new write can start.
    if (signal?.aborted) return null;
    await registerPushDevice({ installationId, expoToken: data, platform: pushPlatform() });
    return data;
  } catch (err) {
    if (err instanceof RegistrationCancelled) return null;
    throw err;
  }
}

/** Stops pushes to this installation only; other devices of the account stay registered. */
export async function unregisterPushNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  const installationId = await readInstallationId();
  if (installationId) await unregisterPushDevice(installationId);
}

/**
 * Calls `onChange` with the new native token when the OS rotates it. Returns an unsubscribe.
 * Pass the token on as `devicePushToken`; never fetch the device token again inside `onChange`.
 */
export function watchPushTokenChanges(onChange: (token: DevicePushToken) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const subscription = Notifications.addPushTokenListener((token) => onChange(token));
  return () => subscription.remove();
}
