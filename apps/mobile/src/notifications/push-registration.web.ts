/** Web has no Expo push support: registration is intentionally a no-op. */
export async function registerForPushNotifications(): Promise<string | null> {
  return null;
}
