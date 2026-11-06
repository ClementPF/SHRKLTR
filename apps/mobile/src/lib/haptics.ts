import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Feedback is a nicety: a device without a haptic engine, or a refused call, must never break
// the action that triggered it. Web vibration is left off; desktop browsers have none.
function fire(effect: () => Promise<void> | undefined) {
  if (Platform.OS === 'web') return;
  try {
    void Promise.resolve(effect()).catch(() => undefined);
  } catch {
    // Ignored on purpose, see above.
  }
}

export const haptics = {
  tap: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
