import { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { Colors, Radius, Spacing, Typography } from '@/theme';

export type AlertKind = 'error' | 'success' | 'info';

export interface DropdownAlertMessage {
  id: number;
  kind: AlertKind;
  title: string;
  message: string;
}

interface AlertState {
  current: DropdownAlertMessage | null;
  show(kind: AlertKind, title: string, message: string): void;
  dismiss(id?: number): void;
}

let nextId = 1;

export const useAlertStore = create<AlertState>((set) => ({
  current: null,
  show: (kind, title, message) => set({ current: { id: nextId++, kind, title, message } }),
  dismiss: (id) => set((state) => (id && state.current?.id !== id ? state : { current: null })),
}));

export function showAlert(kind: AlertKind, title: string, message: string) {
  useAlertStore.getState().show(kind, title, message);
}

/** Errors stay long enough to read; confirmations get out of the way of the header sooner. */
export const AUTO_DISMISS_MS: Record<AlertKind, number> = {
  error: 5000,
  success: 3000,
  info: 3000,
};

const ANIMATION_MS = 180;
const useNativeDriver = Platform.OS !== 'web';

const BACKGROUNDS: Record<AlertKind, string> = {
  error: Colors.error,
  success: Colors.success,
  info: Colors.surfaceRaised,
};

/**
 * In-app replacement for the legacy react-native-dropdownalert banner. React Native's
 * `Alert.alert` is a no-op on web, so failures would otherwise be invisible there.
 */
export function DropdownAlert() {
  const current = useAlertStore((s) => s.current);
  const dismiss = useAlertStore((s) => s.dismiss);
  const insets = useSafeAreaInsets();
  // The last message stays rendered while it slides out after the store has cleared it.
  const [shown, setShown] = useState(current);
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (current) {
      setShown(current);
      Animated.timing(progress, {
        toValue: 1,
        duration: ANIMATION_MS,
        useNativeDriver,
      }).start();
      return;
    }
    Animated.timing(progress, { toValue: 0, duration: ANIMATION_MS, useNativeDriver }).start(
      ({ finished }) => {
        if (finished) setShown(null);
      },
    );
  }, [current, progress]);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => dismiss(current.id), AUTO_DISMISS_MS[current.kind]);
    return () => clearTimeout(timer);
  }, [current, dismiss]);

  const message = current ?? shown;
  if (!message) return null;
  return (
    <Animated.View
      pointerEvents={current ? 'auto' : 'none'}
      style={[
        styles.banner,
        {
          top: insets.top + Spacing.sm,
          backgroundColor: BACKGROUNDS[message.kind],
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
          ],
        },
      ]}
    >
      <Pressable
        accessibilityRole="alert"
        testID={current ? 'dropdown-alert' : undefined}
        onPress={() => dismiss(message.id)}
        style={styles.content}
      >
        <Text style={styles.title}>{message.title}</Text>
        <Text style={styles.message}>{message.message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: Spacing.sm,
    right: Spacing.sm,
    zIndex: 1000,
    borderRadius: Radius.md,
  },
  content: { padding: Spacing.md, gap: Spacing.xs },
  title: { ...Typography.body, fontWeight: '700', color: Colors.errorText },
  message: { ...Typography.body, color: Colors.errorText },
});
