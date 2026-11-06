import type { DevicePushToken } from 'expo-notifications';

export type { DevicePushToken };

export interface PushRegistrationOptions {
  /**
   * The native token delivered by the token listener. Exchanging it directly avoids asking the
   * OS again, which on iOS fires the listener again and would loop.
   */
  devicePushToken?: DevicePushToken;
  /** Aborting stops the registration before it writes to the server. */
  signal?: AbortSignal;
}
