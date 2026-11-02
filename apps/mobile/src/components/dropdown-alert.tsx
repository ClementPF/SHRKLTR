import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
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

const AUTO_DISMISS_MS = 5000;

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

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => dismiss(current.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [current, dismiss]);

  if (!current) return null;
  return (
    <Pressable
      accessibilityRole="alert"
      testID="dropdown-alert"
      onPress={() => dismiss(current.id)}
      style={[
        styles.banner,
        { top: insets.top + Spacing.sm, backgroundColor: BACKGROUNDS[current.kind] },
      ]}
    >
      <Text style={styles.title}>{current.title}</Text>
      <Text style={styles.message}>{current.message}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: Spacing.sm,
    right: Spacing.sm,
    zIndex: 1000,
    padding: Spacing.md,
    borderRadius: Radius.md,
    gap: Spacing.xs,
  },
  title: { ...Typography.body, fontWeight: '700', color: Colors.errorText },
  message: { ...Typography.body, color: Colors.errorText },
});
