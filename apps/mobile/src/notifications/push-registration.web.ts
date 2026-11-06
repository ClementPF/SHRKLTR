/** Web has no Expo push support: registration, unregistration and token watching are no-ops. */
export async function registerForPushNotifications(): Promise<string | null> {
  return null;
}

export async function unregisterPushNotifications(): Promise<void> {}

export function watchPushTokenChanges(): () => void {
  return () => undefined;
}
