import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '@/theme';

export interface ButtonProps {
  title: string;
  onPress(): void;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: ViewStyle;
  testID?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  style,
  testID,
}: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? styles.primary : styles.secondary,
        inactive && styles.inactive,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={Colors.text} /> : icon}
      <Text style={styles.label}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  primary: { backgroundColor: Colors.accent },
  secondary: {
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inactive: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  label: { ...Typography.body, fontWeight: '700' },
});
